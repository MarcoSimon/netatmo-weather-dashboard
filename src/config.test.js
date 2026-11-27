import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSettings } from './config.js';
import { EVENING } from '../public/evening.js';

test('without any setting an install behaves like this wall, in the host\'s zone', () => {
  assert.deepEqual(installSettings({}), {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sunsetOffsetMin: -15,
    fallbackAt: { summer: 20 * 60 + 30, winter: 17 * 60 },
    nightFrom: 22 * 60,
    dayFrom: 6 * 60,
  });
  // The defaults have one home, the page's own.
  const { timeZone, ...rest } = installSettings({});
  assert.deepEqual(rest, EVENING);
});

test('another house sets its own zone, evening and night in .env', () => {
  assert.deepEqual(installSettings({
    TIME_ZONE: 'America/New_York',
    EVENING_SUNSET_OFFSET_MIN: '20',
    EVENING_FALLBACK_SUMMER: '21:15',
    EVENING_FALLBACK_WINTER: '7:45',
    NIGHT_FROM: '00:30',
    DAY_FROM: ' 05:45 ',
  }), {
    timeZone: 'America/New_York',
    sunsetOffsetMin: 20,
    fallbackAt: { summer: 21 * 60 + 15, winter: 7 * 60 + 45 },
    nightFrom: 30,
    dayFrom: 5 * 60 + 45,
  });
});

test('an empty value counts as unset, like every other entry in .env', () => {
  assert.equal(installSettings({ NIGHT_FROM: '', EVENING_SUNSET_OFFSET_MIN: '' }).nightFrom, 22 * 60);
  assert.equal(installSettings({ EVENING_SUNSET_OFFSET_MIN: '0' }).sunsetOffsetMin, 0);
});

test('a malformed setting stops the start and names itself', () => {
  assert.throws(() => installSettings({ TIME_ZONE: 'Berlin' }), /TIME_ZONE .* got "Berlin"/);
  assert.throws(() => installSettings({ NIGHT_FROM: '22' }), /NIGHT_FROM must be a time of day as HH:MM, got "22"/);
  assert.throws(() => installSettings({ DAY_FROM: '24:00' }), /DAY_FROM/);
  assert.throws(() => installSettings({ EVENING_FALLBACK_WINTER: '17:5' }), /EVENING_FALLBACK_WINTER/);
  assert.throws(() => installSettings({ EVENING_SUNSET_OFFSET_MIN: '-15.5' }), /EVENING_SUNSET_OFFSET_MIN must be whole minutes/);
  assert.throws(() => installSettings({ EVENING_SUNSET_OFFSET_MIN: '-900' }), /from -240 to 240/);
  assert.throws(() => installSettings({ NIGHT_FROM: '06:00' }), /NIGHT_FROM and DAY_FROM must differ/);
});
