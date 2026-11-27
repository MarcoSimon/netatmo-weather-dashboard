import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from './store.js';
import { BASELINE_S, co2Baseline, openReader, toLatest, toSeries } from './reader.js';
import { COLUMNS } from './measure.js';

const module = (id, type, name) => ({ id, deviceId: '70:ee:50:00:00:01', type, name });

// A read-only connection cannot share `:memory:` with the writer, so these
// run against a real file, written by the poller's own store.
async function databaseFile() {
  return join(await mkdtemp(join(tmpdir(), 'reader-')), 'weather.sqlite');
}

const row = (values) => ({
  time_utc: 100,
  ...Object.fromEntries(COLUMNS.map((c) => [c, null])),
  ...values,
});

test('the newest point carries only the quantities that have a value', () => {
  assert.deepEqual(toLatest(row({ temperature: 5.5, humidity: 90 })), {
    time_utc: 100,
    values: { temperature: 5.5, humidity: 90 },
  });
});

test('a module without points has no newest point', () => {
  assert.equal(toLatest(undefined), null);
});

test('a series keeps every quantity measured in the window, and its single gaps', () => {
  const series = toSeries([
    row({ time_utc: 100, temperature: 21, co2: 600 }),
    row({ time_utc: 400, temperature: 21.2, co2: null }),
  ]);
  assert.deepEqual(series, {
    columns: ['temperature', 'co2'],
    samples: [
      { time_utc: 100, temperature: 21, co2: 600 },
      { time_utc: 400, temperature: 21.2, co2: null },
    ],
  });
});

test('an empty window is an empty series', () => {
  assert.deepEqual(toSeries([]), { columns: [], samples: [] });
});

test('modules are listed in id order, each with its newest point', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const base = store.upsertModule(module('70:ee:50:00:00:01', 'base', 'Wohnzimmer'), 1);
  const outdoor = store.upsertModule(module('02:00:00:00:00:02', 'outdoor', 'Außen'), 1);
  store.insertSamples(outdoor, ['temperature', 'humidity'], [
    { timeUtc: 100, values: [5.5, 90] },
    { timeUtc: 400, values: [5.1, 91] },
  ]);
  const reader = openReader(file);

  assert.deepEqual(reader.modules(), [
    { id: base, type: 'base', name: 'Wohnzimmer', latest: null, status: null },
    {
      id: outdoor,
      type: 'outdoor',
      name: 'Außen',
      latest: { time_utc: 400, values: { temperature: 5.1, humidity: 91 } },
      status: null,
    },
  ]);
  reader.close();
  store.close();
});

test('each module carries its newest status, battery and signal where it has them', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const base = store.upsertModule(module('70:ee:50:00:00:01', 'base', 'Wohnzimmer'), 1);
  const outdoor = store.upsertModule(module('02:00:00:00:00:02', 'outdoor', 'Außen'), 1);
  const status = (values) => ({ batteryPercent: null, batteryVp: null, rfStatus: null, wifiStatus: null, firmware: 1, ...values });
  store.insertStatus(base, 100, status({ reachable: true, wifiStatus: 30 }));
  store.insertStatus(outdoor, 100, status({ reachable: true, batteryPercent: 83, batteryVp: 5690, rfStatus: 68 }));
  store.insertStatus(outdoor, 700, status({ reachable: false, batteryPercent: 82, batteryVp: 5680, rfStatus: 91 }));
  const reader = openReader(file);

  assert.deepEqual(reader.modules().map((m) => m.status), [
    { time_utc: 100, reachable: true, battery_percent: null, rf_status: null, wifi_status: 30 },
    { time_utc: 700, reachable: false, battery_percent: 82, rf_status: 91, wifi_status: null },
  ]);
  reader.close();
  store.close();
});

test('a series is bounded on both ends, inclusive', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const id = store.upsertModule(module('02:00:00:00:00:02', 'outdoor', 'Außen'), 1);
  store.insertSamples(id, ['temperature'], [100, 400, 700, 1000].map((t) => ({ timeUtc: t, values: [t / 100] })));
  const reader = openReader(file);

  const series = reader.series(id, 400, 700);
  assert.deepEqual(series.samples.map((s) => s.time_utc), [400, 700]);
  assert.deepEqual({ id: series.id, name: series.name, columns: series.columns }, {
    id,
    name: 'Außen',
    columns: ['temperature'],
  });
  assert.equal(reader.series(id + 1, 0, 1000), null);
  reader.close();
  store.close();
});

test('the newest point leaves out values outside their bounds', () => {
  assert.deepEqual(toLatest(row({ temperature: 21, co2: 5000, pressure: 782 })), {
    time_utc: 100,
    values: { temperature: 21 },
  });
});

test('a series drops faulty values, also at its edges, and keeps the rest of the row', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const id = store.upsertModule(module('70:ee:50:00:00:01', 'base', 'Wohnzimmer'), 1);
  // Two hours at 900 ppm with a spike at 3000 s and one at 1800 s.
  const co2 = (t) => (t === 3000 || t === 1800 ? 4373 : 900);
  store.insertSamples(id, ['temperature', 'co2', 'pressure'], Array.from({ length: 25 }, (_, i) => {
    const t = i * 300;
    return { timeUtc: t, values: [21, co2(t), t === 6000 ? 782 : 1013] };
  }));
  const reader = openReader(file);

  const series = reader.series(id, 1800, 6000);
  assert.deepEqual(series.samples.map((s) => s.time_utc), Array.from({ length: 15 }, (_, i) => 1800 + i * 300),
    'only the window goes out');
  const nulls = (column) => series.samples.filter((s) => s[column] === null).map((s) => s.time_utc);
  assert.deepEqual(nulls('co2'), [1800, 3000], 'the spike on the first point is judged from beyond the window');
  assert.deepEqual(nulls('pressure'), [6000]);
  assert.deepEqual(nulls('temperature'), []);
  reader.close();
  store.close();
});

test('the CO₂ baseline is the 2nd percentile, and needs enough values', () => {
  const values = Array.from({ length: 1000 }, (_, i) => 400 + i);
  assert.equal(co2Baseline(values), 420);
  assert.equal(co2Baseline(values.slice(0, 499)), null);
  assert.equal(co2Baseline([]), null);
});

test('a series carries the room\'s CO₂ baseline from the week before its end', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const room = store.upsertModule(module('70:ee:50:00:00:01', 'base', 'Wohnzimmer'), 1);
  const outdoor = store.upsertModule(module('02:00:00:00:00:02', 'outdoor', 'Außen'), 1);
  const end = BASELINE_S * 2;
  // A week of points at 600 ppm with every tenth at 410; before the week, 300.
  store.insertSamples(room, ['temperature', 'co2'], Array.from({ length: 2016 }, (_, i) => ({
    timeUtc: end - i * 300,
    values: [21, i % 10 === 0 ? 410 : 600],
  })).concat([{ timeUtc: end - BASELINE_S - 300, values: [21, 300] }]));
  store.insertSamples(outdoor, ['temperature'], [{ timeUtc: end, values: [5] }]);
  const reader = openReader(file);

  assert.equal(reader.series(room, end - 3600, end).co2_baseline, 410);
  assert.equal(reader.series(outdoor, end - 3600, end).co2_baseline, null, 'no CO₂, no baseline');
  assert.equal(reader.series(room, end - BASELINE_S - 3600, end - BASELINE_S + 3600).co2_baseline, null,
    'too few values before the window\'s end');
  reader.close();
  store.close();
});

test('the reader sees what the poller writes while both are open', async () => {
  const file = await databaseFile();
  const store = openStore(file);
  const id = store.upsertModule(module('02:00:00:00:00:02', 'outdoor', 'Außen'), 1);
  const reader = openReader(file);
  assert.equal(reader.modules()[0].latest, null);

  store.insertSamples(id, ['temperature'], [{ timeUtc: 100, values: [5] }]);
  assert.equal(reader.modules()[0].latest.time_utc, 100);
  reader.close();
  store.close();
});

test('the reader opens a database the poller has closed', async () => {
  const file = await databaseFile();
  openStore(file).close();
  const reader = openReader(file);
  assert.deepEqual(reader.modules(), []);
  reader.close();
});

test('a missing database is refused instead of created', async () => {
  const file = await databaseFile();
  assert.throws(() => openReader(file), /has the poller run yet/);
  assert.equal(existsSync(file), false);
});

test('a database with another schema version is refused', async () => {
  const file = await databaseFile();
  openStore(file).close();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 99');
  db.close();
  assert.throws(() => openReader(file), /schema v99 does not match/);
});
