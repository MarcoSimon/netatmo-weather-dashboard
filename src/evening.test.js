// Evening and night are local, and so is the daily row's midnight; pin the
// zone before any Date is made.
process.env.TZ = 'Europe/Berlin';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { EVENING, displayMode, eveningStart } = await import('../public/evening.js');

/** Unix seconds of a local wall-clock time in Berlin. */
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;

/**
 * A forecast as `/api/forecast` delivers it: daily rows keyed by local
 * midnight, with Berlin's sunset for that day.
 */
const forecastOf = (...days) => ({
  daily: days.map(([y, m, d, h, min]) => ({
    time_utc: local(y, m, d, 0),
    sunset_utc: local(y, m, d, h, min),
  })),
});

test('the evening starts a quarter of an hour before sunset', () => {
  const winter = forecastOf([2026, 12, 15, 15, 52]);
  assert.equal(eveningStart(local(2026, 12, 15, 12), winter), local(2026, 12, 15, 15, 37));
  assert.equal(displayMode(local(2026, 12, 15, 15, 36), winter), 'day');
  assert.equal(displayMode(local(2026, 12, 15, 15, 37), winter), 'evening');
});

test('the sunset is read from the row of the day it is asked for', () => {
  const both = forecastOf([2026, 12, 15, 15, 52], [2026, 12, 16, 15, 53]);
  assert.equal(displayMode(local(2026, 12, 16, 15, 37), both), 'day');
  assert.equal(displayMode(local(2026, 12, 16, 15, 38), both), 'evening');
});

test('night runs from 22:00 until 06:00, whatever the sun did', () => {
  const summer = forecastOf([2026, 6, 21, 21, 33], [2026, 6, 22, 21, 33]);
  assert.equal(displayMode(local(2026, 6, 21, 21, 59), summer), 'evening');
  assert.equal(displayMode(local(2026, 6, 21, 22, 0), summer), 'night');
  assert.equal(displayMode(local(2026, 6, 22, 3, 0), summer), 'night');
  assert.equal(displayMode(local(2026, 6, 22, 5, 59), summer), 'night');
  assert.equal(displayMode(local(2026, 6, 22, 6, 0), summer), 'day');
});

test('a sunset after bedtime leaves no evening at all', () => {
  // Not Berlin, but the rule must not depend on that: night wins over evening.
  // 22:30 minus the offset is still past bedtime, so no evening is left.
  const polar = forecastOf([2026, 6, 21, 22, 30]);
  assert.equal(displayMode(local(2026, 6, 21, 21, 59), polar), 'day');
  assert.equal(displayMode(local(2026, 6, 21, 22, 10), polar), 'night');
});

test('without a usable sunset the evening starts at the season\'s fallback', () => {
  const missing = [
    null,
    { daily: [] },
    // Tomorrow's row only: a forecast is there, but not for this day.
    forecastOf([2026, 12, 16, 15, 53]),
    // Open-Meteo left the sunset out.
    { daily: [{ time_utc: local(2026, 12, 15, 0), sunset_utc: null }] },
  ];
  for (const forecast of missing) {
    assert.equal(eveningStart(local(2026, 12, 15, 12), forecast), local(2026, 12, 15, 17));
    assert.equal(displayMode(local(2026, 12, 15, 16, 59), forecast), 'day');
    assert.equal(displayMode(local(2026, 12, 15, 17, 0), forecast), 'evening');
  }
  // Summer time has its own, three and a half hours later.
  assert.equal(eveningStart(local(2026, 7, 15, 12), null), local(2026, 7, 15, 20, 30));
  assert.equal(displayMode(local(2026, 7, 15, 20, 29), null), 'day');
  assert.equal(displayMode(local(2026, 7, 15, 20, 30), null), 'evening');
  // The two values are the ones the archive was rounded to, in minutes after midnight.
  assert.deepEqual(EVENING.fallbackAt, { summer: 20 * 60 + 30, winter: 17 * 60 });
});

test('the fallback follows the clocks, not the calendar', () => {
  // Summer time starts 2026-03-29 at 02:00 and ends 2026-10-25 at 03:00.
  assert.equal(eveningStart(local(2026, 3, 28, 12), null), local(2026, 3, 28, 17));
  assert.equal(eveningStart(local(2026, 3, 29, 12), null), local(2026, 3, 29, 20, 30));
  assert.equal(eveningStart(local(2026, 10, 24, 12), null), local(2026, 10, 24, 20, 30));
  assert.equal(eveningStart(local(2026, 10, 25, 12), null), local(2026, 10, 25, 17));
  // The morning of the switch itself is still on the old offset.
  assert.equal(eveningStart(local(2026, 3, 29, 1), null), local(2026, 3, 29, 17));
});

test('both DST days keep their anchors and find their own sunset', () => {
  // Spring: the clocks jump 02:00 → 03:00, inside the night.
  const spring = forecastOf([2026, 3, 29, 19, 46]);
  assert.equal(displayMode(local(2026, 3, 29, 5, 59), spring), 'night');
  assert.equal(displayMode(local(2026, 3, 29, 6, 0), spring), 'day');
  assert.equal(displayMode(local(2026, 3, 29, 19, 30), spring), 'day');
  assert.equal(displayMode(local(2026, 3, 29, 19, 31), spring), 'evening');
  // Autumn: 02:00 → 03:00 back again, so the day is 25 hours long.
  const autumn = forecastOf([2026, 10, 25, 16, 53]);
  assert.equal(displayMode(local(2026, 10, 25, 5, 59), autumn), 'night');
  assert.equal(displayMode(local(2026, 10, 25, 6, 0), autumn), 'day');
  assert.equal(displayMode(local(2026, 10, 25, 16, 37), autumn), 'day');
  assert.equal(displayMode(local(2026, 10, 25, 16, 38), autumn), 'evening');
  assert.equal(displayMode(local(2026, 10, 25, 22, 0), autumn), 'night');
});

/** Another house's habits: all five numbers differ from the defaults. */
const OTHER = {
  sunsetOffsetMin: 20,
  fallbackAt: { summer: 21 * 60 + 15, winter: 18 * 60 + 45 },
  nightFrom: 23 * 60 + 30,
  dayFrom: 5 * 60 + 45,
};

test('another install\'s offset, fallbacks and anchors replace the defaults', () => {
  const winter = forecastOf([2026, 12, 15, 15, 52]);
  assert.equal(eveningStart(local(2026, 12, 15, 12), winter, OTHER), local(2026, 12, 15, 16, 12));
  assert.equal(displayMode(local(2026, 12, 15, 16, 11), winter, OTHER), 'day');
  assert.equal(displayMode(local(2026, 12, 15, 16, 12), winter, OTHER), 'evening');
  assert.equal(displayMode(local(2026, 12, 15, 23, 29), winter, OTHER), 'evening');
  assert.equal(displayMode(local(2026, 12, 15, 23, 30), winter, OTHER), 'night');
  assert.equal(displayMode(local(2026, 12, 16, 5, 44), winter, OTHER), 'night');
  assert.equal(displayMode(local(2026, 12, 16, 5, 45), winter, OTHER), 'day');
  assert.equal(eveningStart(local(2026, 12, 15, 12), null, OTHER), local(2026, 12, 15, 18, 45));
  assert.equal(eveningStart(local(2026, 7, 15, 12), null, OTHER), local(2026, 7, 15, 21, 15));
});

test('a night that begins after midnight keeps the evening running across it', () => {
  const late = { ...EVENING, nightFrom: 30, dayFrom: 7 * 60 };
  const winter = forecastOf([2026, 12, 15, 15, 52], [2026, 12, 16, 15, 53]);
  assert.equal(displayMode(local(2026, 12, 15, 23, 59), winter, late), 'evening');
  assert.equal(displayMode(local(2026, 12, 16, 0, 0), winter, late), 'evening');
  assert.equal(displayMode(local(2026, 12, 16, 0, 29), winter, late), 'evening');
  assert.equal(displayMode(local(2026, 12, 16, 0, 30), winter, late), 'night');
  assert.equal(displayMode(local(2026, 12, 16, 6, 59), winter, late), 'night');
  assert.equal(displayMode(local(2026, 12, 16, 7, 0), winter, late), 'day');
  assert.equal(displayMode(local(2026, 12, 16, 15, 38), winter, late), 'evening');
});

test('in another zone the fallback follows that zone\'s clocks', (t) => {
  // The page runs in the tablet's zone, so another install is another TZ.
  // New York changes its clocks on 2026-03-08 and 2026-11-01, weeks apart
  // from Berlin, and those are the days the halves must switch on.
  process.env.TZ = 'America/New_York';
  t.after(() => { process.env.TZ = 'Europe/Berlin'; });
  assert.equal(eveningStart(local(2026, 3, 7, 12), null, OTHER), local(2026, 3, 7, 18, 45));
  assert.equal(eveningStart(local(2026, 3, 8, 12), null, OTHER), local(2026, 3, 8, 21, 15));
  assert.equal(eveningStart(local(2026, 10, 31, 12), null, OTHER), local(2026, 10, 31, 21, 15));
  assert.equal(eveningStart(local(2026, 11, 1, 12), null, OTHER), local(2026, 11, 1, 18, 45));
  // A sunset from a forecast asked for in that zone: its rows start at New York's midnight.
  const ny = forecastOf([2026, 12, 15, 16, 30]);
  assert.equal(displayMode(local(2026, 12, 15, 16, 49), ny, OTHER), 'day');
  assert.equal(displayMode(local(2026, 12, 15, 16, 50), ny, OTHER), 'evening');
  assert.equal(displayMode(local(2026, 12, 15, 23, 30), ny, OTHER), 'night');
});
