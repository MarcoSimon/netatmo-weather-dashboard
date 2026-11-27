import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POWER, powerHint } from '../public/power.js';

test('a tablet on power gives no line, however low its battery', () => {
  assert.equal(powerHint({ plugged: true, level: 100 }), null);
  assert.equal(powerHint({ plugged: true, level: 5 }), null);
});

test('off power above the threshold gives no line, so a charge cycle stays quiet', () => {
  assert.equal(powerHint({ plugged: false, level: 75 }), null);
  assert.equal(powerHint({ plugged: false, level: POWER.levelLow + 1 }), null);
});

test('off power at or below the threshold names the battery level', () => {
  assert.equal(powerHint({ plugged: false, level: POWER.levelLow }), 'Tablet hängt nicht am Strom – Akku 40 %');
  assert.equal(powerHint({ plugged: false, level: 7 }), 'Tablet hängt nicht am Strom – Akku 7 %');
});

test('no kiosk browser, or a reading that is not a boolean and a number, gives no line', () => {
  assert.equal(powerHint(null), null);
  assert.equal(powerHint({ plugged: undefined, level: 20 }), null);
  assert.equal(powerHint({ plugged: 'false', level: 20 }), null);
  assert.equal(powerHint({ plugged: false, level: NaN }), null);
  assert.equal(powerHint({ plugged: false, level: '20' }), null);
});
