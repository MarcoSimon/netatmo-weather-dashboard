import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, statusHint } from '../public/status.js';

// The defaults are the real, healthy rows of 2025-09-13 20:17.
const status = (values) => ({ time_utc: 1000, reachable: true, battery_percent: null, rf_status: null, wifi_status: null, ...values });
const outdoor = (values, latestUtc = 1000) => ({
  type: 'outdoor',
  latest: latestUtc === null ? null : { time_utc: latestUtc, values: {} },
  status: status({ battery_percent: 82, rf_status: 68, ...values }),
});
const base = (values) => ({ type: 'base', latest: { time_utc: 1000, values: {} }, status: status({ wifi_status: 30, ...values }) });

test('a healthy station gives no hint, fresh or stale', () => {
  for (const stale of [false, true]) {
    assert.equal(statusHint(outdoor(), stale), null);
    assert.equal(statusHint({ type: 'indoor', latest: null, status: status({ battery_percent: 100, rf_status: 73 }) }, stale), null);
    assert.equal(statusHint(base(), stale), null);
  }
});

test('a module without a status gives no hint', () => {
  assert.equal(statusHint({ type: 'outdoor', latest: null, status: null }, true), null);
});

test('a low battery shows whether or not the values are late', () => {
  assert.equal(statusHint(outdoor({ battery_percent: STATUS.batteryLow + 1 }), false), null);
  assert.equal(statusHint(outdoor({ battery_percent: STATUS.batteryLow }), false), 'Batterie 20\u00a0%');
  assert.equal(statusHint(outdoor({ battery_percent: 7 }), true), 'Batterie 7\u00a0%');
});

test('a module out of reach shows, until a point arrives after that status', () => {
  assert.equal(statusHint(outdoor({ reachable: false }), false), 'kein Funkkontakt');
  assert.equal(statusHint(outdoor({ reachable: false }, null), true), 'kein Funkkontakt');
  // Reconnected: getmeasure delivered a newer point while getstationsdata kept failing.
  assert.equal(statusHint(outdoor({ reachable: false }, 1300), true), null);
});

test('the base unit is never out of reach of itself', () => {
  assert.equal(statusHint(base({ reachable: false }), true), null);
});

test('a weak signal shows only when it explains late values', () => {
  const weakRadio = outdoor({ rf_status: STATUS.rfWeak });
  assert.equal(statusHint(weakRadio, false), null);
  assert.equal(statusHint(weakRadio, true), 'Funk schwach');
  assert.equal(statusHint(outdoor({ rf_status: STATUS.rfWeak - 1 }), true), null);
  const weakWifi = base({ wifi_status: STATUS.wifiWeak });
  assert.equal(statusHint(weakWifi, false), null);
  assert.equal(statusHint(weakWifi, true), 'WLAN schwach');
});

test('one hint at most, the cause before the symptom', () => {
  assert.equal(statusHint(outdoor({ reachable: false, rf_status: 95, battery_percent: 12 }), true), 'Batterie 12\u00a0%');
  assert.equal(statusHint(outdoor({ reachable: false, rf_status: 95 }), true), 'kein Funkkontakt');
});
