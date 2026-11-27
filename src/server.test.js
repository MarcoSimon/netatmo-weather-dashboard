import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, parseHours, DEFAULT_HOURS, MAX_HOURS } from './server.js';

const NOW_UTC = 1_789_560_000;

const MODULES = [
  { id: 1, type: 'base', name: 'Wohnzimmer', latest: { time_utc: NOW_UTC - 300, values: { temperature: 21 } } },
];

// A stand-in for the reader that records what it was asked for. The reader's
// own queries are tested against a real database in reader.test.js.
const calls = [];
const reader = {
  modules: () => MODULES,
  series(moduleId, fromUtc, toUtc) {
    calls.push({ moduleId, fromUtc, toUtc });
    if (moduleId !== 1) return null;
    return { id: 1, type: 'base', name: 'Wohnzimmer', columns: ['temperature'], samples: [] };
  },
};

let server;
let base;
let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'server-'));
  const publicDir = join(root, 'public');
  await mkdir(join(publicDir, 'css'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<h1>Wetter</h1>');
  await writeFile(join(publicDir, 'css', 'app.css'), 'body{}');
  await writeFile(join(root, 'token.json'), '{"refresh_token":"secret"}');

  server = createServer(createHandler({ reader, publicDir, now: () => NOW_UTC * 1000 }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((done) => server.close(done)));

test('the module list carries the server time, for the age of each value', async () => {
  const response = await fetch(`${base}/api/modules`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { now_utc: NOW_UTC, modules: MODULES });
});

test('the forecast is null while the server has none', async () => {
  const body = await (await fetch(`${base}/api/forecast`)).json();
  assert.deepEqual(body, { now_utc: NOW_UTC, forecast: null });
});

test('the forecast comes from memory, as the server holds it', async () => {
  const held = { fetched_utc: NOW_UTC - 600, hourly: [], daily: [] };
  const other = createServer(createHandler({ reader, publicDir: root, forecast: { current: () => held }, now: () => NOW_UTC * 1000 }));
  await new Promise((done) => other.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${other.address().port}/api/forecast`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { now_utc: NOW_UTC, forecast: held });
  } finally {
    await new Promise((done) => other.close(done));
  }
});

test('the settings are null in a handler built without them', async () => {
  const body = await (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual(body, { now_utc: NOW_UTC, settings: null });
});

test('the install-time settings are served as the server read them', async () => {
  const settings = { timeZone: 'Europe/Berlin', sunsetOffsetMin: -15, fallbackAt: { summer: 1230, winter: 1020 }, nightFrom: 1320, dayFrom: 360 };
  const other = createServer(createHandler({ reader, publicDir: root, settings, now: () => NOW_UTC * 1000 }));
  await new Promise((done) => other.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${other.address().port}/api/settings`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      now_utc: NOW_UTC,
      settings: { time_zone: 'Europe/Berlin', sunset_offset_min: -15, fallback_at: { summer: 1230, winter: 1020 }, night_from: 1320, day_from: 360 },
    });
  } finally {
    await new Promise((done) => other.close(done));
  }
});

test('a series defaults to the last 24 hours up to now', async () => {
  calls.length = 0;
  const body = await (await fetch(`${base}/api/modules/1/series`)).json();
  assert.deepEqual(calls, [{ moduleId: 1, fromUtc: NOW_UTC - 24 * 3600, toUtc: NOW_UTC }]);
  assert.deepEqual(body, {
    now_utc: NOW_UTC,
    from_utc: NOW_UTC - 24 * 3600,
    to_utc: NOW_UTC,
    id: 1,
    type: 'base',
    name: 'Wohnzimmer',
    columns: ['temperature'],
    samples: [],
  });
});

test('a series window can be chosen in hours', async () => {
  calls.length = 0;
  await fetch(`${base}/api/modules/1/series?hours=72`);
  assert.equal(calls[0].fromUtc, NOW_UTC - 72 * 3600);
});

test('an unusable window is a 400', async () => {
  const response = await fetch(`${base}/api/modules/1/series?hours=abc`);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /hours must be/);
});

test('an unknown module and an unknown endpoint are 404s', async () => {
  assert.equal((await fetch(`${base}/api/modules/7/series`)).status, 404);
  assert.equal((await fetch(`${base}/api/modules/x/series`)).status, 404);
  assert.equal((await fetch(`${base}/api/token`)).status, 404);
});

test('the root serves index.html, revalidated on every load', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(await response.text(), '<h1>Wetter</h1>');
});

test('static files get their content type', async () => {
  const response = await fetch(`${base}/css/app.css`);
  assert.match(response.headers.get('content-type'), /^text\/css/);
  assert.equal(await response.text(), 'body{}');
});

test('HEAD answers with headers only', async () => {
  const response = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '15');
  assert.equal(await response.text(), '');
});

test('missing files and directories are 404s', async () => {
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
  assert.equal((await fetch(`${base}/css`)).status, 404);
});

test('nothing outside the public directory is served', async () => {
  // fetch() normalises a literal `..`, so the traversal has to be encoded.
  for (const path of ['/%2e%2e/token.json', '/css/%2e%2e%2f%2e%2e/token.json', '/..%2ftoken.json']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /secret/, path);
  }
});

test('a malformed path is a 400', async () => {
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/index.html%00.css`)).status, 400);
});

test('only GET and HEAD are allowed', async () => {
  const response = await fetch(`${base}/api/modules`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('hours are whole numbers within the limits', () => {
  assert.equal(parseHours(null), DEFAULT_HOURS);
  assert.equal(parseHours('1'), 1);
  assert.equal(parseHours(String(MAX_HOURS)), MAX_HOURS);
  for (const raw of ['', ' ', '0', '-1', '1.5', String(MAX_HOURS + 1), '1e1x']) {
    assert.throws(() => parseHours(raw), /hours must be/, JSON.stringify(raw));
  }
});
