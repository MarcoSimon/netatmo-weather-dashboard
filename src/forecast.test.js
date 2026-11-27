// "Today", "night" and "tomorrow" are local; pin the zone before any Date is made.
process.env.TZ = 'Europe/Berlin';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { forecastContent, FORECAST_VIEW } = await import('../public/forecast.js');

/** Unix seconds of a local wall-clock time in Berlin. */
const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;

/**
 * Three local days from 2025-09-13 as Open-Meteo sends them: hourly rows from
 * midnight, temperatures from `temperature(hourOfDay, day)`, and per-hour
 * overrides keyed by the hour's unix time.
 */
function forecast({ temperature = (h) => 12 + 8 * Math.sin(((h - 9) / 24) * 2 * Math.PI), sunshine = (h) => (h >= 7 && h < 19 ? 3600 : 0), overrides = {}, daily = {} } = {}) {
  const hourly = [];
  for (let day = 0; day < 3; day++) {
    for (let h = 0; h < 24; h++) {
      const time_utc = local(2025, 9, 13 + day, h);
      hourly.push({
        time_utc,
        temperature: Math.round(temperature(h, day) * 10) / 10,
        apparent_temperature: Math.round(temperature(h, day) * 10) / 10,
        precipitation_probability: 0,
        precipitation: 0,
        sunshine: sunshine(h, day),
        weather_code: 1,
        wind_speed: 10,
        wind_gusts: 20,
        ...overrides[time_utc],
      });
    }
  }
  const days = [0, 1, 2].map((day) => ({
    time_utc: local(2025, 9, 13 + day, 0),
    temperature_max: 20,
    temperature_min: 10,
    precipitation_sum: 0,
    precipitation_probability_max: 5,
    sunshine: 12 * 3600,
    weather_code: 1,
    sunrise_utc: local(2025, 9, 13 + day, 7),
    sunset_utc: local(2025, 9, 13 + day, 19),
    ...daily[day],
  }));
  return { fetched_utc: local(2025, 9, 13, 7, 5), hourly, daily: days };
}

const rows = (content) => Object.fromEntries(content.rows);

test('no forecast, or none ahead, gives no label', () => {
  assert.equal(forecastContent(null, local(2025, 9, 13, 8)), undefined);
  assert.equal(forecastContent(forecast(), local(2025, 9, 16, 1)), undefined);
});

test('a morning answers today, the coming night and the rain — not tomorrow', () => {
  // As reported from a real wall: after getting up, the next day answers nothing.
  const content = forecastContent(forecast(), local(2025, 9, 13, 7, 10));
  assert.equal(content.label, 'Vorhersage');
  assert.equal(content.tone, 'forecast');
  assert.deepEqual(content.rows.map(([label]) => label), ['Heute', 'Sonne', 'Nacht', 'Regen']);
  assert.equal(rows(content).Heute, 'höchstens 20 °C');
  assert.equal(content.text, 'Open-Meteo, 07:05 Uhr');
});

test('in the small hours the night is still running; from 05:00 on, the coming one', () => {
  // The coldest hour of the running night is 08:00 on the 19th, of the coming one 03:00 on the 20th.
  const temperature = (h, day) => (h === 3 ? (day === 0 ? 4 : 7) : day === 0 && h === 8 ? 1 : 15);
  const night = (h, min = 0) => rows(forecastContent(forecast({ temperature }), local(2025, 9, 13, h, min))).Nacht;
  assert.equal(night(2, 30), 'tiefstens 1 °C');
  assert.equal(night(FORECAST_VIEW.nightTurnsAt - 1, 59), 'tiefstens 1 °C');
  // From 05:00 the running night's rest is over for the household, however cold it gets.
  assert.equal(night(FORECAST_VIEW.nightTurnsAt), 'tiefstens 7 °C');
  assert.equal(night(7, 10), 'tiefstens 7 °C');
  assert.equal(night(10), 'tiefstens 7 °C');
  // The coming night starts at 18:00, not now: a cool noon is not the night.
  const noonDip = (h, day) => (day === 0 && h === 12 ? 2 : h === 3 ? 7 : 15);
  assert.equal(rows(forecastContent(forecast({ temperature: noonDip }), local(2025, 9, 13, 11))).Nacht, 'tiefstens 7 °C');
});

test('at 18:00 today gives way to tomorrow', () => {
  const view = (h, min) => forecastContent(forecast({ daily: { 1: { temperature_min: 11.4, temperature_max: 18.6 } } }), local(2025, 9, 13, h, min));
  assert.deepEqual(view(FORECAST_VIEW.eveningFrom - 1, 59).rows.map(([label]) => label), ['Heute', 'Sonne', 'Nacht', 'Regen']);
  const evening = view(FORECAST_VIEW.eveningFrom, 5);
  assert.deepEqual(evening.rows.map(([label]) => label), ['Nacht', 'Regen', 'Morgen', 'Sonne']);
  assert.equal(rows(evening).Morgen, '11–19 °C');
});

test('after midnight, today is the day just begun and tomorrow waits for the evening', () => {
  const content = forecastContent(forecast(), local(2025, 9, 14, 0, 30));
  assert.deepEqual(content.rows.map(([label]) => label), ['Heute', 'Sonne', 'Nacht', 'Regen']);
});

test('today counts only the hours still ahead', () => {
  const hotMorning = (h, day) => (day === 0 && h === 9 ? 30 : 15);
  assert.equal(rows(forecastContent(forecast({ temperature: hotMorning }), local(2025, 9, 13, 9, 30))).Heute, 'höchstens 30 °C');
  assert.equal(rows(forecastContent(forecast({ temperature: hotMorning }), local(2025, 9, 13, 10))).Heute, 'höchstens 15 °C');
});

test('rain: likely, only possible, already falling, or dry for the next twelve hours', () => {
  const at = (h, p) => ({ [local(2025, 9, 13, h)]: { precipitation_probability: p } });
  const now = local(2025, 9, 13, 8, 20);
  const rain = (overrides) => rows(forecastContent(forecast({ overrides }), now)).Regen;
  // No hour: "trocken bis 0 Uhr" reads as rain at midnight, even with three dry days behind it.
  assert.equal(rain({}), 'trocken');
  assert.equal(rain({ ...at(15, 60), ...at(16, 75) }), 'ab 15 Uhr · 75 %');
  assert.equal(rain({ ...at(11, 40), ...at(15, 60) }), 'ab 15 Uhr · 60 %');
  assert.equal(rain({ ...at(11, 40) }), 'ab 11 Uhr · 40 %');
  assert.equal(rain({ ...at(8, 80) }), 'jetzt · 80 %');
  // Beyond twelve hours is tomorrow's business.
  assert.equal(rain({ ...at(20, 90) }), 'trocken');
});

test('the sunshine row counts what the day has left', () => {
  // The fixture's sun runs 07:00 to 19:00, so a morning still has all of it.
  const left = (h, min, options) => rows(forecastContent(forecast(options), local(2025, 9, 13, h, min))).Sonne;
  assert.equal(left(7, 10), 'noch 12,0 h');
  // The running hour counts whole, like the "Heute" row above it.
  assert.equal(left(14, 30), 'noch 5,0 h');
  // Open-Meteo gives part hours around sunrise and sunset; they add up as they are.
  assert.equal(left(16, 0, { sunshine: (h) => ({ 16: 3600, 17: 1800, 18: 900 })[h] ?? 0 }), 'noch 1,8 h');
  // A day that has nothing left says so rather than rounding to "noch 0,0 h".
  assert.equal(left(15, 0, { sunshine: () => 0 }), 'heute vorbei');
  // Nothing at all without the field, which Open-Meteo may leave out.
  const bare = forecastContent(forecast({ sunshine: () => null }), local(2025, 9, 13, 9));
  assert.equal(bare.rows.some(([label]) => label === 'Sonne'), false);
});

test('in the evening the sunshine row is tomorrow\'s whole day', () => {
  const evening = (day) => forecastContent(forecast({ daily: { 1: day } }), local(2025, 9, 13, 20));
  assert.equal(rows(evening({ sunshine: 9.5 * 3600 })).Sonne, '9,5 h');
  // It sits below tomorrow's own rows, not above them.
  assert.deepEqual(evening({ sunshine: 0 }).rows.map(([label]) => label), ['Nacht', 'Regen', 'Morgen', 'Sonne']);
  assert.equal(rows(evening({ sunshine: 0 })).Sonne, '0,0 h');
  assert.equal(evening({ sunshine: null }).rows.some(([label]) => label === 'Sonne'), false);
});

test('rain says how much, in a row of its own', () => {
  const at = (h, precipitation_probability, precipitation) =>
    ({ [local(2025, 9, 13, h)]: { precipitation_probability, precipitation } });
  const now = local(2025, 9, 13, 8, 20);
  // On the wall the amount does not fit beside the chance: every one-line cut
  // of "ab 15 Uhr · 75 % · 1,6 l/m²" wraps in the tile, measured at 1280x800.
  const wet = (overrides) => forecastContent(forecast({ overrides }), now).rows.filter(([label]) => ['Regen', 'Menge'].includes(label));
  assert.deepEqual(wet({ ...at(15, 60, 1.2), ...at(16, 75, 0.4) }), [['Regen', 'ab 15 Uhr · 75 %'], ['Menge', '1,6 l/m²']]);
  // Only from the hour the row names — earlier drizzle is not part of the answer.
  assert.deepEqual(wet({ ...at(9, 10, 5), ...at(15, 60, 1.2) }), [['Regen', 'ab 15 Uhr · 60 %'], ['Menge', '1,2 l/m²']]);
  // A chance with nothing measurable behind it gets no row at all.
  assert.deepEqual(wet({ ...at(15, 60, 0) }), [['Regen', 'ab 15 Uhr · 60 %']]);
  // Beyond the window the amount does not count either.
  assert.deepEqual(wet({ ...at(15, 60, 1), ...at(21, 90, 9) }), [['Regen', 'ab 15 Uhr · 60 %'], ['Menge', '1,0 l/m²']]);
  // A dry stretch has nothing to add.
  assert.deepEqual(wet({}), [['Regen', 'trocken']]);
});

test('tomorrow names its rain only when it is at least possible', () => {
  const now = local(2025, 9, 13, 20);
  const tomorrow = (p, day = {}) =>
    forecastContent(forecast({ daily: { 1: { precipitation_probability_max: p, ...day } } }), now)
      .rows.filter(([label, value]) => label === 'Morgen' || label === 'Menge' || value.startsWith('Regen'));
  assert.deepEqual(tomorrow(FORECAST_VIEW.rainMaybe - 1), [['Morgen', '10–20 °C']]);
  assert.equal(rows(forecastContent(forecast(), now)).Regen, 'trocken');
  assert.deepEqual(tomorrow(58), [['Morgen', '10–20 °C'], ['', 'Regen 58 %']]);
  // The amount comes from the daily sum, and only when there is one to name.
  assert.deepEqual(tomorrow(58, { precipitation_sum: 3 }),
    [['Morgen', '10–20 °C'], ['', 'Regen 58 %'], ['Menge', '3,0 l/m²']]);
});

test('wind and the felt temperature show only when they stand out', () => {
  const now = local(2025, 9, 13, 8, 20);
  const labels = (overrides) => forecastContent(forecast({ overrides }), now).rows.map(([label]) => label);
  assert.equal(labels({}).includes('Wind'), false);
  assert.equal(labels({}).includes('Gefühlt'), false);
  const gusty = { [local(2025, 9, 13, 14)]: { wind_gusts: 62.4 } };
  assert.equal(rows(forecastContent(forecast({ overrides: gusty }), now)).Wind, 'Böen bis 62 km/h');
  const cold = { [local(2025, 9, 13, 8)]: { temperature: 4, apparent_temperature: 0.6 } };
  assert.equal(rows(forecastContent(forecast({ overrides: cold }), now)).Gefühlt, '1 °C');
});

test('the days are local on the DST night too', () => {
  // 2026-10-25, clocks go back at 03:00: the day has 25 hours.
  const start = local(2026, 10, 25, 0);
  const hourly = Array.from({ length: 49 }, (_, i) => ({ time_utc: start + i * 3600, temperature: { 24: 30, 25: 31 }[i] ?? 10, precipitation_probability: 0 }));
  const daily = [{ time_utc: local(2026, 10, 26, 0), temperature_min: 1, temperature_max: 9, precipitation_probability_max: 0 }];
  const day = forecastContent({ fetched_utc: start, hourly, daily }, local(2026, 10, 25, 12));
  // Hour 24 after midnight is 23:00 local on the 25th, still today; hour 25 is tomorrow.
  assert.equal(rows(day).Heute, 'höchstens 30 °C');
  const evening = forecastContent({ fetched_utc: start, hourly, daily }, local(2026, 10, 25, 20));
  assert.equal(rows(evening).Morgen, '1–9 °C');
});
