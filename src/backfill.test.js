import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillModule } from './backfill.js';
import { openStore } from './store.js';
import { PAGE_LIMIT, seriesFor } from './measure.js';

const SERIES = seriesFor(['Temperature', 'Humidity']);
const START = 1_665_698_378; // the station's real first point
const STEP = 300;

/**
 * Netatmo as the backfill sees it: the first PAGE_LIMIT points at or after
 * `dateBegin`, keyed by timestamp, and `[]` for an empty range.
 */
function netatmo(count) {
  const times = Array.from({ length: count }, (_, i) => START + i * STEP);
  const requests = [];
  const fetchPage = async ({ types, dateBegin }) => {
    requests.push(dateBegin);
    assert.deepEqual(types, ['temperature', 'humidity']);
    const page = times.filter((t) => t >= dateBegin).slice(0, PAGE_LIMIT);
    if (page.length === 0) return { status: 'ok', body: [] };
    return { status: 'ok', body: Object.fromEntries(page.map((t) => [t, [20, 50]])) };
  };
  return { times, requests, fetchPage };
}

function setup() {
  const store = openStore(':memory:');
  const moduleId = store.upsertModule(
    { id: '02:00:00:00:00:02', deviceId: '70:ee:50:00:00:01', type: 'outdoor', name: 'Außen' },
    START,
  );
  const count = () => store.db.prepare('SELECT count(*) AS n FROM samples').get().n;
  return { store, moduleId, count };
}

const run = (args) => backfillModule({ series: SERIES, budget: 100, pause: async () => {}, ...args });

test('an empty store imports the whole history, page by page', async () => {
  const { store, moduleId, count } = setup();
  const remote = netatmo(2 * PAGE_LIMIT + 452);
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage });

  assert.deepEqual(result, { pages: 3, added: remote.times.length, last: remote.times.at(-1), caughtUp: true });
  assert.equal(count(), remote.times.length);
  // From the very beginning, then each page right after the previous one.
  assert.deepEqual(remote.requests, [0, remote.times[PAGE_LIMIT - 1] + 1, remote.times[2 * PAGE_LIMIT - 1] + 1]);
});

test('after an outage it resumes right after the newest stored point', async () => {
  const { store, moduleId, count } = setup();
  const remote = netatmo(500);
  await run({ store, moduleId, fetchPage: netatmo(356).fetchPage }); // stored before the outage
  // Twelve hours off: 144 new points at five-minute resolution.
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage });

  assert.deepEqual(remote.requests, [remote.times[355] + 1]);
  assert.equal(result.added, 144);
  assert.equal(count(), 500);
});

test('the next cycle on an up-to-date module costs one request', async () => {
  const { store, moduleId } = setup();
  const remote = netatmo(10);
  await run({ store, moduleId, fetchPage: remote.fetchPage });
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage });
  assert.deepEqual(result, { pages: 1, added: 0, last: remote.times.at(-1), caughtUp: true });
});

test('a used-up budget stops the import and says it is not done', async () => {
  const { store, moduleId, count } = setup();
  const remote = netatmo(5 * PAGE_LIMIT);
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage, budget: 2 });

  assert.deepEqual(result, { pages: 2, added: 2 * PAGE_LIMIT, last: remote.times[2 * PAGE_LIMIT - 1], caughtUp: false });
  assert.equal(count(), 2 * PAGE_LIMIT);
});

test('a failed page keeps, and reports, every page committed before it', async () => {
  const { store, moduleId, count } = setup();
  const remote = netatmo(3 * PAGE_LIMIT);
  let calls = 0;
  const flaky = async (args) => {
    calls += 1;
    if (calls === 2) throw new Error('getmeasure failed with HTTP 503');
    return remote.fetchPage(args);
  };
  const failed = await run({ store, moduleId, fetchPage: flaky });
  assert.match(failed.error.message, /HTTP 503/);
  // The regression from the first real run: the progress must survive the error.
  assert.deepEqual(
    { pages: failed.pages, added: failed.added, last: failed.last, caughtUp: failed.caughtUp },
    { pages: 2, added: PAGE_LIMIT, last: remote.times[PAGE_LIMIT - 1], caughtUp: false },
  );
  assert.equal(count(), PAGE_LIMIT);

  // And the next run continues from there rather than from the start.
  await run({ store, moduleId, fetchPage: remote.fetchPage });
  assert.equal(remote.requests.at(-3), remote.times[PAGE_LIMIT - 1] + 1);
  assert.equal(count(), 3 * PAGE_LIMIT);
});

test('a stop during the pause sends no further request', async () => {
  const { store, moduleId } = setup();
  const remote = netatmo(5 * PAGE_LIMIT);
  const stopping = new AbortController();
  let pauses = 0;
  const pause = async () => {
    pauses += 1;
    if (pauses === 2) stopping.abort();
  };
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage, pause, signal: stopping.signal });
  assert.equal(remote.requests.length, 1);
  assert.equal(result.caughtUp, false);
});

test('a module with nothing we can ask for sends no request', async () => {
  const { store, moduleId } = setup();
  const remote = netatmo(10);
  const result = await run({ store, moduleId, fetchPage: remote.fetchPage, series: [] });
  assert.equal(remote.requests.length, 0);
  assert.equal(result.caughtUp, true);
});

test('the pause comes before every request', async () => {
  const { store, moduleId } = setup();
  const events = [];
  const remote = netatmo(PAGE_LIMIT + 1);
  await run({
    store,
    moduleId,
    pause: async () => events.push('pause'),
    fetchPage: async (args) => { events.push('fetch'); return remote.fetchPage(args); },
  });
  assert.deepEqual(events, ['pause', 'fetch', 'pause', 'fetch']);
});
