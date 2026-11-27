import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteHumidity, dewPoint, humidityAt, saturationPressure } from '../public/humidity.js';

// The frontend's pure module lives in public/ so the browser can load it;
// its tests live here so the server never serves them.

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not ${expected} ± ${tolerance}`);

test('saturation vapour pressure matches the tables', () => {
  near(saturationPressure(0), 6.11, 0.01, '0 °C');
  near(saturationPressure(20), 23.37, 0.05, '20 °C');
  near(saturationPressure(-10), 2.86, 0.02, '−10 °C over water');
});

test('saturated air holds the tabulated amount of water', () => {
  near(absoluteHumidity(20, 100), 17.3, 0.1, '20 °C');
  near(absoluteHumidity(0, 100), 4.85, 0.05, '0 °C');
  near(absoluteHumidity(30, 100), 30.4, 0.2, '30 °C');
  assert.equal(absoluteHumidity(20, 0), 0);
});

test('humid cold air is drier than moderate warm air — the trap', () => {
  const outside = absoluteHumidity(5, 90);
  const inside = absoluteHumidity(21, 55);
  near(outside, 6.1, 0.1, '90 % at 5 °C');
  near(inside, 10.0, 0.1, '55 % at 21 °C');
  assert.ok(outside < inside, 'airing dries the room although 90 % > 55 %');
});

test('the dew point matches the tables and equals the temperature when saturated', () => {
  near(dewPoint(20, 50), 9.3, 0.1, '20 °C, 50 %');
  near(dewPoint(25, 60), 16.7, 0.1, '25 °C, 60 %');
  near(dewPoint(-5, 80), -7.9, 0.1, '−5 °C, 80 %, over water');
  near(dewPoint(12.3, 100), 12.3, 1e-9, 'saturated');
});

test('air brought to another temperature keeps its vapour pressure', () => {
  // 90 % at 5 °C holds 8.72 × 0.9 = 7.85 hPa; at 21 °C that is 7.85 / 24.87.
  near(humidityAt(5, 90, 21), 31.6, 0.1, 'the trap in the room\'s terms');
  near(humidityAt(21, 55, 21), 55, 1e-9, 'the same temperature changes nothing');
  near(humidityAt(20, 50, dewPoint(20, 50)), 100, 1e-6, 'saturated at the dew point');
  near(humidityAt(20.6, 52, 21.6), 49, 0.2, 'Arbeitszimmer air in the Wohnzimmer');
});
