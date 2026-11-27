// "Night" and "morning" are local; pin the zone before any Date is made.
process.env.TZ = 'Europe/Berlin';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { nightWindow, nightLowShows, clockTime } = await import('../public/night.js');
const { chartContent } = await import('../public/chart.js');

/** Unix seconds of a local wall-clock time in Berlin. */
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;
const point = (time_utc, temperature) => ({ time_utc, temperature });

test('the night is there only in the morning, from 05:00 until 10:00 at the latest', () => {
  assert.equal(nightWindow(local(2025, 9, 12, 4, 59)), null);
  assert.notEqual(nightWindow(local(2025, 9, 12, 5, 0)), null);
  assert.notEqual(nightWindow(local(2025, 9, 12, 9, 59)), null);
  assert.equal(nightWindow(local(2025, 9, 12, 10, 0)), null);
  assert.equal(nightWindow(local(2025, 9, 12, 11, 2)), null, 'not at 11:02, where it once still was');
  assert.equal(nightWindow(local(2025, 9, 12, 22, 0)), null);
});

test('the night runs from 18:00 the evening before until 09:00, or now if earlier', () => {
  assert.deepEqual(nightWindow(local(2025, 9, 12, 7, 30)), {
    fromUtc: local(2025, 9, 11, 18),
    toUtc: local(2025, 9, 12, 7, 30),
    endsUtc: local(2025, 9, 12, 9),
  });
  assert.deepEqual(nightWindow(local(2025, 9, 12, 9, 30)), {
    fromUtc: local(2025, 9, 11, 18),
    toUtc: local(2025, 9, 12, 9),
    endsUtc: local(2025, 9, 12, 9),
  });
});

test('the low shows until 09:00, and at least an hour after it was reached', () => {
  const at = (h, min) => local(2025, 9, 12, h, min);
  const shows = (lowAt, now) => nightLowShows(nightWindow(now), lowAt, now);
  // An early low: until 09:00, not a minute longer.
  assert.equal(shows(at(6, 40), at(8, 59)), true);
  assert.equal(shows(at(6, 40), at(9, 0)), false);
  // A low between 07:00 and 08:00 still shows until 09:00, not an hour after it.
  assert.equal(shows(at(7, 5), at(8, 30)), true);
  assert.equal(shows(at(7, 59), at(8, 59)), true);
  // A late low: an hour after it.
  assert.equal(shows(at(8, 40), at(9, 39)), true);
  assert.equal(shows(at(8, 40), at(9, 40)), false);
  assert.equal(shows(at(9, 0), at(9, 59)), true, 'a night still cooling at its end');
});

test('a DST night is an hour shorter in spring and longer in autumn', () => {
  const spring = nightWindow(local(2026, 3, 29, 9, 30));
  assert.equal((spring.toUtc - spring.fromUtc) / 3600, 14);
  const autumn = nightWindow(local(2026, 10, 25, 9, 30));
  assert.equal((autumn.toUtc - autumn.fromUtc) / 3600, 16);
});

test('the time of the low reads like a clock, without a leading zero', () => {
  assert.equal(clockTime(local(2025, 9, 12, 6, 40)), '6:40');
  assert.equal(clockTime(local(2025, 9, 12, 23, 5)), '23:05');
});

// 2025-09-12 as a real wall saw it: yesterday morning was colder than last night.
const day = [
  point(local(2025, 9, 11, 7, 40), 9.8), // yesterday's sunrise, inside the 24 hours
  point(local(2025, 9, 11, 15), 21.5),
  point(local(2025, 9, 11, 23), 14.2),
  point(local(2025, 9, 12, 6, 40), 11.6), // last night's low
  point(local(2025, 9, 12, 7, 5), 12.0),
];

test('on a morning the chart carries the night low, not yesterday morning', () => {
  const now = local(2025, 9, 12, 7, 20);
  const chart = chartContent(day, now, 'temperature', nightWindow(now));
  assert.deepEqual(chart.night, { min: '11,6 °C', at: '6:40' });
  assert.equal(chart.min, '9,8 °C', 'the 24-hour low stays available for the tap');
  assert.equal(chart.maxDot, '', 'only the night low is marked');
  const dayChart = chartContent(day, now);
  assert.notEqual(chart.minDot, dayChart.minDot, 'the dot moves to the night low');
});

test('the chart drops the night once its low no longer shows, and never takes it back', () => {
  // Cooling until 08:20: before 09:00 the low is the running one and shows.
  const cooling = [...day, point(local(2025, 9, 12, 8, 20), 10.9), point(local(2025, 9, 12, 8, 50), 11.3)];
  const chartAt = (h, min) => chartContent(cooling, local(2025, 9, 12, h, min), 'temperature', nightWindow(local(2025, 9, 12, h, min)));
  assert.deepEqual(chartAt(7, 20).night, { min: '11,6 °C', at: '6:40' });
  assert.deepEqual(chartAt(8, 30).night, { min: '10,9 °C', at: '8:20' });
  assert.deepEqual(chartAt(9, 19).night, { min: '10,9 °C', at: '8:20' });
  const after = chartAt(9, 20);
  assert.equal(after.night, null);
  assert.notEqual(after.maxDot, '', 'the 24-hour high is marked again');
  // The fixture's own low at 06:40 leaves at 09:00.
  const now = local(2025, 9, 12, 9, 0);
  assert.equal(chartContent(day, now, 'temperature', nightWindow(now)).night, null);
});

test('without a night, or a night without points, the chart is the 24-hour one', () => {
  const now = local(2025, 9, 12, 7, 20);
  assert.equal(chartContent(day, now).night, null);
  const empty = chartContent([point(local(2025, 9, 11, 12), 20)], now, 'temperature', nightWindow(now));
  assert.equal(empty.night, null);
  assert.notEqual(empty.maxDot, '');
});
