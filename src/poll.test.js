import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cycle, sleep, PAGES_PER_CYCLE } from './poll.js';
import { openStore } from './store.js';
import { PAGE_LIMIT } from './measure.js';

const STATION = {
  status: 'ok',
  body: { devices: [{ _id: 'x', type: 'NAMain', station_name: 'Test', reachable: true }] },
};

async function setup(token = { access_token: 'a1', refresh_token: 'r1' }) {
  const tokenFile = join(await mkdtemp(join(tmpdir(), 'poll-')), 'token.json');
  await writeFile(tokenFile, JSON.stringify(token));
  return { clientId: 'id', clientSecret: 'secret', tokenFile, intervalMs: 1000 };
}

/** A cycle's collaborators, with no network and no waiting. */
function deps(overrides) {
  return {
    store: openStore(':memory:'),
    fetchMeasure: async () => ({ status: 'ok', body: [] }),
    pause: async () => {},
    ...overrides,
  };
}

const rotated = (n) => async () => ({
  access_token: `a${n}`,
  refresh_token: `r${n}`,
  expires_at: Date.now() + 3 * 60 * 60 * 1000,
});

test('a rotated token survives a failure later in the same cycle', async () => {
  const config = await setup();
  const refreshedWith = [];
  const refresh = async ({ token }) => {
    refreshedWith.push(token.refresh_token);
    return rotated(2)();
  };

  // The 503 that actually happened on 2025-09-03 at 23:00 UTC: the refresh had
  // already succeeded and rotated the pair when getstationsdata failed.
  await assert.rejects(
    () => cycle(config, deps({ refresh, fetchStation: async () => { throw new Error('HTTP 503'); } })),
    /HTTP 503/,
  );

  const stored = JSON.parse(await readFile(config.tokenFile, 'utf8'));
  assert.equal(stored.refresh_token, 'r2', 'the rotated pair must be on disk');

  // The regression: the next cycle must not fall back to the superseded r1.
  await cycle(config, deps({ refresh, fetchStation: async () => STATION }));
  assert.deepEqual(refreshedWith, ['r1'], 'the second cycle must not refresh again');
});

test('a cycle with a valid token does not refresh', async () => {
  const config = await setup({
    access_token: 'a1',
    refresh_token: 'r1',
    expires_at: Date.now() + 2 * 60 * 60 * 1000,
  });
  let refreshes = 0;
  await cycle(config, deps({
    refresh: async () => { refreshes += 1; return rotated(2)(); },
    fetchStation: async () => STATION,
  }));
  assert.equal(refreshes, 0);
});

test('a pair without an expiry is refreshed on the first cycle', async () => {
  const config = await setup();
  let refreshes = 0;
  await cycle(config, deps({
    refresh: async () => { refreshes += 1; return rotated(2)(); },
    fetchStation: async () => STATION,
  }));
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(await readFile(config.tokenFile, 'utf8')).refresh_token, 'r2');
});

test('a failed refresh leaves the stored pair untouched', async () => {
  const config = await setup();
  await assert.rejects(
    () => cycle(config, deps({
      refresh: async () => { throw new Error('fetch failed'); },
      fetchStation: async () => STATION,
    })),
    /fetch failed/,
  );
  assert.equal(JSON.parse(await readFile(config.tokenFile, 'utf8')).refresh_token, 'r1');
});

const HOUSE = {
  status: 'ok',
  time_server: 1757441945,
  body: {
    devices: [{
      _id: 'base', type: 'NAMain', station_name: 'Haus', module_name: 'Wohnzimmer', reachable: true,
      data_type: ['Temperature', 'CO2', 'Humidity', 'Noise', 'Pressure'],
      modules: [
        { _id: 'out', type: 'NAModule1', module_name: 'Außen', reachable: true, battery_percent: 82, data_type: ['Temperature', 'Humidity'] },
        { _id: 'office', type: 'NAModule4', module_name: 'Arbeitszimmer', reachable: true, battery_percent: 100, data_type: ['Temperature', 'CO2', 'Humidity'] },
      ],
    }],
  },
};

/** One page of `count` points for whatever types were asked, from `dateBegin` on. */
function page(count, { dateBegin, types }) {
  const start = Math.max(dateBegin, 1_700_000_000);
  return {
    status: 'ok',
    body: Object.fromEntries(Array.from({ length: count }, (_, i) => [start + i * 300, types.map(() => 1)])),
  };
}

const validToken = { access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() + 2 * 60 * 60 * 1000 };

test('a cycle records every module, its status and its series', async () => {
  const config = await setup(validToken);
  const requests = [];
  const d = deps({
    fetchStation: async () => HOUSE,
    fetchMeasure: async (args) => { requests.push(args); return page(3, args); },
  });
  await cycle(config, d);

  const count = (sql) => d.store.db.prepare(sql).get().n;
  assert.equal(count('SELECT count(*) AS n FROM modules'), 3);
  assert.equal(count('SELECT count(*) AS n FROM module_status WHERE time_utc = 1757441945'), 3);
  assert.equal(count('SELECT count(*) AS n FROM samples'), 9);
  assert.deepEqual(
    requests.map((r) => [r.accessToken, r.deviceId, r.moduleId, r.types.join(','), r.dateBegin]),
    [
      ['a1', 'base', 'base', 'temperature,co2,humidity,noise,pressure', 0],
      ['a1', 'base', 'out', 'temperature,humidity', 0],
      ['a1', 'base', 'office', 'temperature,co2,humidity', 0],
    ],
  );
});

test('one module failing does not keep the others from catching up', async () => {
  const config = await setup(validToken);
  const d = deps({
    fetchStation: async () => HOUSE,
    fetchMeasure: async (args) => {
      if (args.moduleId === 'out') throw new Error('getmeasure failed with HTTP 503');
      return page(2, args);
    },
  });
  await cycle(config, d);
  const perModule = d.store.db.prepare(
    'SELECT m.netatmo_id AS id, count(s.time_utc) AS n FROM modules m LEFT JOIN samples s ON s.module_id = m.id GROUP BY m.id ORDER BY m.id',
  ).all().map((r) => [r.id, r.n]);
  assert.deepEqual(perModule, [['base', 2], ['out', 0], ['office', 2]]);
});

test('a failed getstationsdata still backfills the modules of the last good cycle', async () => {
  const config = await setup(validToken);
  const d = deps({ fetchStation: async () => HOUSE, fetchMeasure: async (args) => page(2, args) });
  const known = await cycle(config, d);
  assert.deepEqual(known.map((m) => m.id), ['base', 'out', 'office']);

  const requests = [];
  const again = await cycle(config, {
    ...d,
    known,
    fetchStation: async () => { throw new Error('getstationsdata failed with HTTP 503'); },
    fetchMeasure: async (args) => { requests.push(args); return page(1, { ...args, dateBegin: 1_800_000_000 }); },
  });

  const count = (sql) => d.store.db.prepare(sql).get().n;
  assert.equal(count('SELECT count(*) AS n FROM samples'), 9);
  // No status is invented for the cycle that had none.
  assert.equal(count('SELECT count(*) AS n FROM module_status'), 3);
  assert.equal(count('SELECT count(*) AS n FROM modules'), 3);
  assert.deepEqual(requests.map((r) => [r.deviceId, r.moduleId, r.types.join(',')]), [
    ['base', 'base', 'temperature,co2,humidity,noise,pressure'],
    ['base', 'out', 'temperature,humidity'],
    ['base', 'office', 'temperature,co2,humidity'],
  ]);
  assert.equal(again, known);
});

test('a failed getstationsdata without a known module list ends the cycle', async () => {
  const config = await setup(validToken);
  const d = deps({ fetchStation: async () => { throw new Error('getstationsdata failed with HTTP 503'); } });
  await assert.rejects(cycle(config, d), /HTTP 503/);
  assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM samples').get().n, 0);
});

test('the page budget is shared by all modules of a cycle', async () => {
  const config = await setup(validToken);
  const requests = [];
  const d = deps({
    fetchStation: async () => HOUSE,
    // The base unit's history never ends within one cycle.
    fetchMeasure: async (args) => { requests.push(args.moduleId); return page(PAGE_LIMIT, args); },
  });
  await cycle(config, d);
  assert.equal(requests.length, PAGES_PER_CYCLE);
  assert.deepEqual(new Set(requests), new Set(['base']));
});

test('a stop request ends the backfill instead of finishing the budget', async () => {
  const config = await setup(validToken);
  const stopping = new AbortController();
  let requests = 0;
  await cycle(config, deps({
    signal: stopping.signal,
    fetchStation: async () => HOUSE,
    fetchMeasure: async (args) => {
      requests += 1;
      if (requests === 3) stopping.abort();
      return page(PAGE_LIMIT, args);
    },
  }));
  assert.equal(requests, 3);
});

test('the wait runs to completion when nothing interrupts it', async () => {
  const started = Date.now();
  assert.equal(await sleep(20, new AbortController().signal), 'elapsed');
  assert.ok(Date.now() - started >= 15, 'should actually have waited');
});

test('the wait is given up as soon as the stop signal fires', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const waited = sleep(60_000, controller.signal);
  controller.abort();
  assert.equal(await waited, 'aborted');
  assert.ok(Date.now() - started < 1000, 'must not sit out the interval');
});

test('a wait on an already-aborted signal returns immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(await sleep(60_000, controller.signal), 'aborted');
});
