import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDS, CONTEXT_S, SPIKE, dropImplausible, isPlausible, spikes } from './plausible.js';

const STEP = 300;
/** Points five minutes apart from the given values. */
const series = (values) => values.map((v, i) => ({ t: i * STEP, v }));
const indexes = (found) => [...found].sort((a, b) => a - b);

test('values outside their bounds are not measurements', () => {
  assert.equal(isPlausible('pressure', 782), false, 'the 2023-09-13 plateau');
  assert.equal(isPlausible('pressure', 939.9), false);
  assert.equal(isPlausible('pressure', 940), true);
  assert.equal(isPlausible('pressure', 1060), true);
  assert.equal(isPlausible('pressure', 1060.1), false);
  assert.equal(isPlausible('co2', 5000), false, 'a sensor at its ceiling');
  assert.equal(isPlausible('co2', 4999), true);
  assert.equal(isPlausible('co2', -1), false);
  assert.equal(isPlausible('humidity', 100), true, 'fog is real');
  assert.equal(isPlausible('humidity', 100.5), false);
  assert.equal(isPlausible('temperature', -40), true);
  assert.equal(isPlausible('temperature', 65.1), false);
});

test('quantities without bounds always pass', () => {
  assert.equal(isPlausible('noise', 999), true);
  assert.equal(isPlausible('rain', 80), true);
  assert.equal(isPlausible('wind_strength', 250), true);
  assert.equal(BOUNDS.rain, undefined);
});

test('a single spike is found, its neighbours are not', () => {
  // Wohnzimmer 2023-04-04: 1013 → 4373 → 1767 within a room around 900 ppm.
  const values = [880, 870, 890, 900, 910, 1013, 4373, 1767, 930, 900, 890, 880, 870, 860];
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.co2)), [6, 7]);
});

test('a spike of three points is found', () => {
  // Arbeitszimmer 2023-03-24: three points at the sensor's ceiling and just below it.
  const values = [1300, 1310, 1290, 1311, 1320, 5000, 4983, 3849, 1330, 1310, 1300, 1290, 1280];
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.co2)), [5, 6, 7]);
});

test('the floor keeps small steps in a quiet neighbourhood', () => {
  // All neighbours equal: the deviation is 0, and 1.4 °C is still below the floor.
  const values = [20, 20, 20, 20, 20, 20, 21.4, 20, 20, 20, 20, 20, 20];
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.temperature)), []);
  values[6] = 21.6;
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.temperature)), [6]);
});

test('a real, steady change is not a spike', () => {
  // Airing: CO₂ falls by 700 ppm in half an hour, then stays low.
  const airing = [1500, 1500, 1490, 1500, 1400, 1250, 1100, 950, 850, 800, 800, 790, 800, 800];
  assert.deepEqual(indexes(spikes(series(airing), SPIKE.floors.co2)), []);
  // A sunny morning outside: 6 °C in an hour.
  const morning = Array.from({ length: 14 }, (_, i) => 10 + i * 0.5);
  assert.deepEqual(indexes(spikes(series(morning), SPIKE.floors.temperature)), []);
});

test('a step with more points on one side is not a spike', () => {
  // Wohnzimmer 2023-01-30, a window opened at 13:00: extra points a minute
  // apart before the step, five-minute points after it.
  const minute = 60;
  const points = [
    ...[1151, 1156, 1153, 1156, 1180, 1158].map((v, i) => ({ t: i * minute, v })),
    { t: 660, v: 1181 }, { t: 960, v: 1191 }, { t: 1080, v: 1204 }, { t: 1380, v: 984 },
    { t: 1680, v: 722 },
    ...[638, 601, 650, 664, 749, 764].map((v, i) => ({ t: 1980 + i * 300, v })),
  ];
  assert.deepEqual(indexes(spikes(points, SPIKE.floors.co2)), []);
});

test('the tail of a slowly decaying jump is not caught — a known limit', () => {
  // Arbeitszimmer 2023-03-24 as stored, minutes after 11:33: a point missing at 12:08,
  // the 5,000 at 12:12 already dropped by its bound.
  const stored = [[0, 1042], [5, 1069], [10, 1103], [15, 1079], [21, 1102], [26, 1107], [30, 1094],
    [43, 4983], [48, 3849], [53, 2737], [58, 2249], [63, 1647], [68, 1311], [74, 1195]];
  const points = stored.map(([minute, v]) => ({ t: minute * 60, v }));
  assert.deepEqual(indexes(spikes(points, SPIKE.floors.co2)), []);
  // With the neighbourhood complete, the jump itself does stand out.
  assert.deepEqual(indexes(spikes(series(stored.map(([, v]) => v)), SPIKE.floors.co2)), [7, 8]);
});

test('a point is only judged with enough neighbours on both sides', () => {
  const values = [900, 900, 900, 900, 900, 900, 4000];
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.co2)), [], 'the newest point waits');
  values.push(900, 900);
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.co2)), [], 'two after it are not enough');
  values.push(900);
  assert.deepEqual(indexes(spikes(series(values), SPIKE.floors.co2)), [6], 'three are');
  assert.deepEqual(indexes(spikes(series([900, 900, 900, 4000, 900, 900, 900]), SPIKE.floors.co2)), [3]);
  assert.deepEqual(indexes(spikes(series([900, 900, 4000, 900, 900, 900]), SPIKE.floors.co2)), [],
    'the oldest points wait too, which is why the reader looks beyond its window');
});

test('the neighbourhood is half an hour on each side, not a number of points', () => {
  // A gap: the points before 4000 lie more than half an hour back.
  const points = [
    { t: 0, v: 900 }, { t: 300, v: 900 }, { t: 600, v: 900 },
    { t: 5000, v: 900 }, { t: 5300, v: 4000 }, { t: 5600, v: 900 }, { t: 5900, v: 900 }, { t: 6200, v: 900 },
  ];
  assert.deepEqual(indexes(spikes(points, SPIKE.floors.co2)), [], 'only one neighbour within the window before it');
  assert.equal(CONTEXT_S, SPIKE.windowS);
});

const row = (time_utc, values) => ({ time_utc, temperature: null, co2: null, pressure: null, rain: null, ...values });

test('faulty values become null, the rest of the row stays', () => {
  const rows = Array.from({ length: 13 }, (_, i) => row(i * STEP, { temperature: 21, co2: 800, pressure: 1013 }));
  rows[6] = row(6 * STEP, { temperature: 21, co2: 4373, pressure: 1013 });
  rows[2] = row(2 * STEP, { temperature: 21, co2: 800, pressure: 782 });
  const clean = dropImplausible(rows, ['temperature', 'co2', 'pressure', 'rain']);
  assert.deepEqual(clean[6], row(6 * STEP, { temperature: 21, co2: null, pressure: 1013 }));
  assert.deepEqual(clean[2], row(2 * STEP, { temperature: 21, co2: 800, pressure: null }));
  assert.equal(clean.filter((r) => r.co2 === null).length, 1);
  assert.equal(rows[6].co2, 4373, 'the input is left alone');
});

test('an out-of-bounds value does not skew its neighbours\' spike test', () => {
  // Four points at the ceiling would pull the median of the ones around them.
  const co2 = [800, 810, 5000, 5000, 5000, 5000, 820, 800, 790, 800, 810, 800, 800];
  const rows = co2.map((v, i) => row(i * STEP, { co2: v }));
  const clean = dropImplausible(rows, ['co2']);
  assert.deepEqual(clean.map((r) => r.co2), [800, 810, null, null, null, null, 820, 800, 790, 800, 810, 800, 800]);
});

test('existing nulls stay null and are not neighbours', () => {
  const rows = [900, null, 900, 900, 4000, 900, 900, null, 900].map((v, i) => row(i * STEP, { co2: v }));
  const clean = dropImplausible(rows, ['co2']);
  assert.deepEqual(clean.map((r) => r.co2), [900, null, 900, 900, null, 900, 900, null, 900]);
});

test('rain is never judged as a spike', () => {
  const rows = [0, 0, 0, 0, 0, 0, 12.5, 0, 0, 0, 0, 0, 0].map((v, i) => row(i * STEP, { rain: v }));
  assert.deepEqual(dropImplausible(rows, ['rain']).map((r) => r.rain), [0, 0, 0, 0, 0, 0, 12.5, 0, 0, 0, 0, 0, 0]);
});
