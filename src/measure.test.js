import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesFor, parseMeasure, COLUMNS } from './measure.js';

const BASE = seriesFor(['Temperature', 'CO2', 'Humidity', 'Noise', 'Pressure']);

test('a module\'s data types map to getmeasure types in the order given', () => {
  assert.deepEqual(
    BASE.map((s) => s.type),
    ['temperature', 'co2', 'humidity', 'noise', 'pressure'],
  );
});

test('wind expands to four series, each with its own column', () => {
  assert.deepEqual(
    seriesFor(['Wind']).map((s) => s.column),
    ['wind_strength', 'wind_angle', 'gust_strength', 'gust_angle'],
  );
});

test('an unknown data type is skipped rather than requested', () => {
  // getmeasure answers an unknown type with an empty body, which would look
  // exactly like "no data" for the whole module.
  assert.deepEqual(seriesFor(['Temperature', 'AbsolutePressure']).map((s) => s.type), ['temperature']);
});

test('every column is distinct', () => {
  assert.equal(new Set(COLUMNS).size, COLUMNS.length);
});

test('a page is parsed into rows sorted by time', () => {
  // Shaped after a real response, keys deliberately out of order.
  const rows = parseMeasure(
    {
      status: 'ok',
      body: {
        1757441531: [24.5, 525, 55, 36, 1013.7],
        1757441228: [24.5, 530, 55, 37, 1013.8],
      },
    },
    BASE,
  );
  assert.deepEqual(rows, [
    { timeUtc: 1757441228, values: [24.5, 530, 55, 37, 1013.8] },
    { timeUtc: 1757441531, values: [24.5, 525, 55, 36, 1013.7] },
  ]);
});

test('a single null value survives as null', () => {
  const series = seriesFor(['Temperature', 'CO2', 'Humidity']);
  const [row] = parseMeasure({ body: { 1757362754: [22.5, null, 61] } }, series);
  assert.deepEqual(row.values, [22.5, null, 61]);
});

test('an empty range comes back as an array and means no rows', () => {
  assert.deepEqual(parseMeasure({ status: 'ok', body: [] }, BASE), []);
});

test('the optimized format is refused rather than misread', () => {
  assert.throws(
    () => parseMeasure({ body: [{ beg_time: 1, step_time: 300, value: [[1]] }] }, BASE),
    /optimize=false/,
  );
});

test('a point with the wrong number of values is an error', () => {
  assert.throws(() => parseMeasure({ body: { 1: [20, 50] } }, BASE), /2 values for 5 types/);
});

test('a response without a body is an error', () => {
  assert.throws(() => parseMeasure({ status: 'ok' }, BASE), /no body/);
});
