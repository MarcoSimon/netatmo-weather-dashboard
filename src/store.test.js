import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.js';
import { COLUMNS } from './measure.js';

const OUTDOOR = {
  id: '02:00:00:00:00:02',
  deviceId: '70:ee:50:00:00:01',
  type: 'outdoor',
  name: 'Außen',
  reachable: true,
  batteryPercent: 82,
  batteryVp: 5684,
  rfStatus: 72,
  wifiStatus: null,
  firmware: 53,
};

test('the samples table has exactly one column per known quantity', () => {
  const store = openStore(':memory:');
  const columns = store.db.prepare('SELECT name FROM pragma_table_info(\'samples\')').all().map((c) => c.name);
  assert.deepEqual(columns, ['module_id', 'time_utc', ...COLUMNS]);
});

test('a module keeps its row id when it is renamed', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  assert.equal(store.upsertModule({ ...OUTDOOR, name: 'Garten' }, 2000), id);
  const row = store.db.prepare('SELECT name, first_seen_utc FROM modules WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { name: 'Garten', first_seen_utc: 1000 });
});

test('a module without samples has no last sample time', () => {
  const store = openStore(':memory:');
  assert.equal(store.lastSampleTime(store.upsertModule(OUTDOOR, 1000)), null);
});

test('a page lands in the given columns and moves the last sample time', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  const added = store.insertSamples(id, ['temperature', 'humidity'], [
    { timeUtc: 100, values: [5.5, 90] },
    { timeUtc: 400, values: [5.1, null] },
  ]);
  assert.equal(added, 2);
  assert.equal(store.lastSampleTime(id), 400);
  const row = store.db.prepare('SELECT temperature, humidity, co2 FROM samples WHERE time_utc = 400').get();
  assert.deepEqual({ ...row }, { temperature: 5.1, humidity: null, co2: null });
});

test('a point stored twice is kept once and not counted again', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  store.insertSamples(id, ['temperature'], [{ timeUtc: 100, values: [5] }]);
  const added = store.insertSamples(id, ['temperature'], [
    { timeUtc: 100, values: [99] },
    { timeUtc: 400, values: [6] },
  ]);
  assert.equal(added, 1);
  assert.equal(store.db.prepare('SELECT temperature FROM samples WHERE time_utc = 100').get().temperature, 5);
});

test('a page that fails halfway leaves nothing of itself behind', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  assert.throws(() => store.insertSamples(id, ['temperature'], [
    { timeUtc: 100, values: [5] },
    { timeUtc: 400, values: ['not a number'] },
  ]));
  assert.equal(store.lastSampleTime(id), null);
});

test('a column name that is not ours is refused before it reaches SQL', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  assert.throws(() => store.insertSamples(id, ['temperature) --'], []), /unknown sample column/);
});

test('a status snapshot is stored with reachable as 0/1', () => {
  const store = openStore(':memory:');
  const id = store.upsertModule(OUTDOOR, 1000);
  store.insertStatus(id, 1000, { ...OUTDOOR, reachable: false });
  const row = store.db.prepare('SELECT * FROM module_status').get();
  assert.deepEqual({ ...row }, {
    module_id: id, time_utc: 1000, reachable: 0, battery_percent: 82,
    battery_vp: 5684, rf_status: 72, wifi_status: null, firmware: 53,
  });
});

test('the file and its directory are created, and reopening keeps the data', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'store-')), 'nested', 'weather.sqlite');
  const first = openStore(path);
  const id = first.upsertModule(OUTDOOR, 1000);
  first.insertSamples(id, ['temperature'], [{ timeUtc: 100, values: [5] }]);
  first.close();

  const second = openStore(path);
  assert.equal(second.lastSampleTime(second.upsertModule(OUTDOOR, 2000)), 100);
  assert.equal(second.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  second.close();
});

test('a database from newer code is refused rather than written to', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'store-')), 'weather.sqlite');
  const store = openStore(path);
  store.db.exec('PRAGMA user_version = 99');
  store.close();
  assert.throws(() => openStore(path), /schema v99 is newer/);
});
