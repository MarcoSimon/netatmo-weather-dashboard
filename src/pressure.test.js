import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPLAUSIBLE_ABOVE,
  MATCH_S,
  QUICK_FROM,
  STEADY_BELOW,
  TENDENCY_S,
  pressureTendency,
} from '../public/pressure.js';

// The frontend's pure module lives in public/ so the browser can load it;
// its tests live here so the server never serves them.

const NOW = 100_000;
const at = (time_utc, pressure) => ({ time_utc, pressure });
const tendency = (then, now) => pressureTendency([at(NOW - TENDENCY_S, then), at(NOW - 300, now - 0.1), at(NOW, now)]);

test('the tendency compares the newest point with three hours earlier', () => {
  assert.deepEqual(tendency(1010, 1012.5), { delta: 2.5, level: 1, atUtc: NOW });
  assert.deepEqual(tendency(1012.5, 1010), { delta: -2.5, level: -1, atUtc: NOW });
});

test('the levels change exactly at their thresholds', () => {
  const level = (delta) => tendency(1000, 1000 + delta).level;
  assert.equal(level(0), 0);
  assert.equal(level(0.9), 0);
  assert.equal(level(-0.9), 0);
  assert.equal(level(STEADY_BELOW), 1, 'no floating-point slip at the boundary');
  assert.equal(level(-STEADY_BELOW), -1);
  assert.equal(level(3.4), 1);
  assert.equal(level(QUICK_FROM), 2);
  assert.equal(level(-QUICK_FROM), -2);
  assert.equal(level(IMPLAUSIBLE_ABOVE), 2);
});

test('a sensor fault gives no tendency rather than a dramatic one', () => {
  assert.equal(tendency(1021.9, 782), null);
  assert.equal(tendency(1000, 1000 + IMPLAUSIBLE_ABOVE + 0.1), null);
});

test('the reference is the point closest to three hours earlier', () => {
  const samples = [
    at(NOW - TENDENCY_S - 300, 1005),
    at(NOW - TENDENCY_S + 120, 1008),
    at(NOW - TENDENCY_S + 420, 1100),
    at(NOW, 1010),
  ];
  assert.equal(pressureTendency(samples).delta, 2);
});

test('without a point near three hours earlier there is no tendency', () => {
  assert.equal(pressureTendency([at(NOW - TENDENCY_S - MATCH_S - 1, 1000), at(NOW, 1010)]), null);
  assert.equal(pressureTendency([at(NOW - TENDENCY_S + MATCH_S + 1, 1000), at(NOW, 1010)]), null);
  assert.equal(pressureTendency([at(NOW - TENDENCY_S + MATCH_S, 1000), at(NOW, 1010)]).delta, 10);
  assert.equal(pressureTendency([at(NOW, 1010)]), null);
  assert.equal(pressureTendency([]), null);
});

test('points without pressure are skipped, the newest pressure point counts', () => {
  const samples = [
    at(NOW - 600 - TENDENCY_S - 600, 1000),
    { time_utc: NOW - 600 - TENDENCY_S + 300, temperature: 20 },
    at(NOW - 600 - TENDENCY_S, 1001),
    at(NOW - 600, 1003),
    { time_utc: NOW, temperature: 20, pressure: null },
  ];
  assert.deepEqual(pressureTendency(samples), { delta: 2, level: 1, atUtc: NOW - 600 });
});
