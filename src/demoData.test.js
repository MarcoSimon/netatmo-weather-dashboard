// The scene and the forecast's days are local; pin the zone before any Date is made.
process.env.TZ = 'Europe/Berlin';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { DEMO, demoForecastBody, demoStation, sunTimes } = await import('./demoData.js');
const { parseForecast } = await import('./openMeteo.js');
const { co2Baseline } = await import('./reader.js');
const { airingRecommendation } = await import('../public/airing.js');
const { openWindow } = await import('../public/window.js');
const { pressureTendency } = await import('../public/pressure.js');
const { forecastContent } = await import('../public/forecast.js');

/** Unix seconds of a local wall-clock time in Berlin. */
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;

/** A module's rows as the API sends its series: one object per point. */
const samples = ({ columns, rows }) =>
  rows.map(({ timeUtc, values }) => Object.fromEntries([['time_utc', timeUtc], ...columns.map((c, i) => [c, values[i]])]));

// Three times of day, so the scene is shown to hold whenever the demo starts.
const MOMENTS = [local(2025, 9, 11, 15, 37), local(2025, 9, 12, 7, 3), local(2025, 9, 12, 22, 41)];

test('the same moment gives the same house', () => {
  assert.deepEqual(demoStation(MOMENTS[0]), demoStation(MOMENTS[0]));
  assert.deepEqual(demoForecastBody(MOMENTS[0]), demoForecastBody(MOMENTS[0]));
});

test('eight days of five-minute points, without a gap, up to the moment', () => {
  const now = MOMENTS[0];
  for (const module of demoStation(now)) {
    const times = module.rows.map((row) => row.timeUtc);
    assert.equal(times.at(-1), now - (now % DEMO.stepS));
    assert.equal(times.at(-1) - times[0], DEMO.days * 24 * 3600);
    assert.ok(times.every((t, i) => i === 0 || t - times[i - 1] === DEMO.stepS));
    assert.ok(module.rows.every((row) => row.values.length === module.columns.length));
  }
});

test('the values stay where a station would put them', () => {
  for (const { columns, rows } of demoStation(MOMENTS[0])) {
    const range = (column) => {
      const i = columns.indexOf(column);
      const values = rows.map((row) => row.values[i]);
      return [Math.min(...values), Math.max(...values)];
    };
    const [tLow, tHigh] = range('temperature');
    assert.ok(tLow > -5 && tHigh < 30, `temperature ${tLow}–${tHigh}`);
    const [hLow, hHigh] = range('humidity');
    assert.ok(hLow >= 30 && hHigh <= 100, `humidity ${hLow}–${hHigh}`);
    if (columns.includes('co2')) {
      const [cLow, cHigh] = range('co2');
      assert.ok(cLow >= 380 && cHigh < 2000, `co2 ${cLow}–${cHigh}`);
    }
  }
});

test('whenever it starts, the living room asks to be aired and the kitchen window is open', () => {
  for (const now of MOMENTS) {
    const [living, outdoor, kitchen] = demoStation(now).map(samples);
    const day = (series) => series.filter((p) => p.time_utc > now - 24 * 3600);
    assert.equal(airingRecommendation(day(living), day(outdoor))?.reason, 'co2', new Date(now * 1000).toString());
    const baseline = co2Baseline(kitchen.map((p) => p.co2).sort((a, b) => a - b));
    const guess = openWindow(day(kitchen), day(outdoor), baseline);
    assert.ok(guess, `no window guess at ${new Date(now * 1000)}`);
    assert.ok(now - guess.since <= DEMO.windowOpenS, 'the guess is the window just opened');
    assert.ok(pressureTendency(day(living)).level < 0, 'the pressure falls');
  }
});

test('whenever it starts, the curves have their key values to mark', () => {
  for (const now of MOMENTS) {
    const [living, outdoor, kitchen] = demoStation(now).map(samples);
    const week = (series, key) => series.filter((p) => p.time_utc > now - 7 * 24 * 3600).map((p) => p[key]);
    const day = (series, key) => series.filter((p) => p.time_utc > now - 24 * 3600).map((p) => p[key]);
    assert.ok(Math.min(...week(outdoor, 'temperature')) <= 0, 'a frost in the week');
    assert.ok(Math.min(...day(outdoor, 'temperature')) > 0, 'but not in the day: the scene is mild');
    assert.ok(Math.max(...day(living, 'co2')) >= 1000, 'the guests');
    assert.ok(Math.max(...day(kitchen, 'humidity')) >= 60, 'the cooking');
  }
});

test('the forecast passes the real parser and gives the page rows to show', () => {
  const now = MOMENTS[0];
  const forecast = { fetched_utc: now, ...parseForecast(demoForecastBody(now)) };
  assert.equal(forecast.daily.length, 3);
  assert.equal(forecast.daily[0].time_utc, local(2025, 9, 11, 0));
  assert.equal(forecast.hourly.length, 72);
  const rows = Object.fromEntries(forecastContent(forecast, now).rows);
  assert.ok(rows.Regen.startsWith('ab 19 Uhr'), rows.Regen);
  assert.ok(rows.Sonne.startsWith('noch'), rows.Sonne);
});

test('the sun rises and sets within a few minutes of the almanac', () => {
  // Berlin, 21 June 2025: 04:43 and 21:33 CEST; 21 December 2025: 08:15 and 15:54 CET.
  const minutesOff = (actual, expected) => Math.abs(actual - expected) / 60;
  const june = sunTimes(local(2025, 6, 21, 12), DEMO.place);
  assert.ok(minutesOff(june.sunrise, local(2025, 6, 21, 4, 43)) < 5);
  assert.ok(minutesOff(june.sunset, local(2025, 6, 21, 21, 33)) < 5);
  const december = sunTimes(local(2025, 12, 21, 12), DEMO.place);
  assert.ok(minutesOff(december.sunrise, local(2025, 12, 21, 8, 15)) < 5);
  assert.ok(minutesOff(december.sunset, local(2025, 12, 21, 15, 54)) < 5);
});
