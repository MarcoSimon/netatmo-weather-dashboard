import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORECAST, createForecast, forecastUrl, parseForecast } from './openMeteo.js';
import { forecastPlace } from './config.js';

// The first two hours and days of a real answer (Berlin, 2025-09-13).
const BODY = {
  latitude: 52.52,
  longitude: 13.419998,
  utc_offset_seconds: 7200,
  timezone: 'Europe/Berlin',
  hourly: {
    time: [1757714400, 1757718000],
    temperature_2m: [14.4, 13.9],
    apparent_temperature: [13.2, 12.5],
    precipitation_probability: [0, 0],
    precipitation: [0.0, 0.0],
    sunshine_duration: [3600, 1800],
    weather_code: [3, 1],
    wind_speed_10m: [6.6, 6.9],
    wind_gusts_10m: [14.4, 15.1],
  },
  daily: {
    time: [1757714400, 1757800800],
    temperature_2m_max: [21.0, 21.1],
    temperature_2m_min: [11.7, 14.3],
    precipitation_sum: [0.1, 3.0],
    precipitation_probability_max: [13, 58],
    sunshine_duration: [38160, 21600],
    weather_code: [61, 80],
    sunrise: [1757738820, 1757825320],
    sunset: [1757783532, 1757869792],
  },
};

test('the answer becomes one row per hour and per day, under our names', () => {
  const { hourly, daily } = parseForecast(BODY);
  assert.equal(hourly.length, 2);
  assert.deepEqual(hourly[0], {
    time_utc: 1757714400,
    temperature: 14.4,
    apparent_temperature: 13.2,
    precipitation_probability: 0,
    precipitation: 0,
    sunshine: 3600,
    weather_code: 3,
    wind_speed: 6.6,
    wind_gusts: 14.4,
  });
  assert.deepEqual(daily[1], {
    time_utc: 1757800800,
    temperature_max: 21.1,
    temperature_min: 14.3,
    precipitation_sum: 3.0,
    precipitation_probability_max: 58,
    sunshine: 21600,
    weather_code: 80,
    sunrise_utc: 1757825320,
    sunset_utc: 1757869792,
  });
});

test('a value Open-Meteo leaves out is null, and an answer without times is refused', () => {
  const body = structuredClone(BODY);
  body.hourly.precipitation_probability = [null, 5];
  delete body.hourly.wind_gusts_10m;
  const [first] = parseForecast(body).hourly;
  assert.equal(first.precipitation_probability, null);
  assert.equal(first.wind_gusts, null);
  assert.throws(() => parseForecast({ daily: BODY.daily }), /time axis/);
});

test('the request asks for local days and unix times at the configured place', () => {
  const url = new URL(forecastUrl({ lat: 52.52, lon: 13.41 }, 'Europe/Berlin'));
  assert.equal(url.searchParams.get('latitude'), '52.52');
  assert.equal(url.searchParams.get('longitude'), '13.41');
  assert.equal(url.searchParams.get('timezone'), 'Europe/Berlin');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('forecast_days'), String(FORECAST.days));
  assert.match(url.searchParams.get('hourly'), /temperature_2m,.*precipitation_probability/);
});

const silent = { warn() {} };
const answer = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });

test('the days begin at midnight in the configured zone', () => {
  const url = new URL(forecastUrl({ lat: 40.71, lon: -74.01 }, 'America/New_York'));
  assert.equal(url.searchParams.get('timezone'), 'America/New_York');
});

test('a fetched forecast is held with its fetch time', async () => {
  const asked = [];
  const fetchImpl = (url, options) => (asked.push(url), answer(200, BODY)(url, options));
  const forecast = createForecast({ place: { lat: 1, lon: 2 }, timeZone: 'Asia/Tokyo', fetchImpl, now: () => 5_000_000, log: silent });
  assert.equal(forecast.current(), null);
  assert.equal(await forecast.refresh(), true);
  assert.equal(new URL(asked[0]).searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(forecast.current().fetched_utc, 5_000);
  assert.equal(forecast.current().daily.length, 2);
});

test('a failed fetch keeps the last forecast and says so', async () => {
  const warnings = [];
  let fetchImpl = answer(200, BODY);
  const forecast = createForecast({
    place: { lat: 1, lon: 2 },
    fetchImpl: (...args) => fetchImpl(...args),
    now: () => 5_000_000,
    log: { warn: (message) => warnings.push(message) },
  });
  await forecast.refresh();
  fetchImpl = answer(503, {});
  assert.equal(await forecast.refresh(), false);
  fetchImpl = async () => { throw new Error('The operation was aborted due to timeout'); };
  assert.equal(await forecast.refresh(), false);
  assert.equal(forecast.current().fetched_utc, 5_000);
  assert.deepEqual(warnings, [
    'forecast failed, keeping the last one: HTTP 503',
    'forecast failed, keeping the last one: The operation was aborted due to timeout',
  ]);
});

test('a forecast too old to stand for the coming hours is dropped', async () => {
  let nowMs = 5_000_000;
  const forecast = createForecast({ place: { lat: 1, lon: 2 }, fetchImpl: answer(200, BODY), now: () => nowMs, log: silent });
  await forecast.refresh();
  nowMs += FORECAST.maxAgeS * 1000;
  assert.notEqual(forecast.current(), null);
  nowMs += 1000;
  assert.equal(forecast.current(), null);
});

test('without coordinates there is no forecast; half or nonsense coordinates are refused', () => {
  assert.equal(forecastPlace(undefined, undefined), null);
  assert.equal(forecastPlace('', ''), null);
  assert.deepEqual(forecastPlace('52.52', '13.41'), { lat: 52.52, lon: 13.41 });
  assert.throws(() => forecastPlace('52.52', ''), /FORECAST_LAT and FORECAST_LON/);
  assert.throws(() => forecastPlace('north', '13.41'), /decimal degrees/);
  assert.throws(() => forecastPlace('95', '13.41'), /decimal degrees/);
});
