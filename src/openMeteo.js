/**
 * The forecast from Open-Meteo: the server's one outbound call. No API
 * key, no account; coordinates come from `.env`.
 *
 * The server fetches and the page reads, so the tablet never talks to the
 * internet. The forecast lives in memory only: it is not a measurement, and
 * the database stays what the poller wrote. A failed fetch keeps the last
 * forecast until it is too old to stand for the coming hours.
 *
 * Parsing is pure and unit-tested; the fetch is a thin shell around it, and
 * nothing here may ever block or fail a request to the API.
 */
import { log as defaultLog } from './log.js';

const API = 'https://api.open-meteo.com/v1/forecast';

export const FORECAST = {
  /** Open-Meteo's models update every one to six hours; hourly catches each. */
  refreshMs: 60 * 60 * 1000,
  /** After a failure, try again sooner than the next regular refresh. */
  retryMs: 10 * 60 * 1000,
  /** A forecast fetched longer ago than this is dropped rather than shown. */
  maxAgeS: 6 * 3600,
  timeoutMs: 10_000,
  days: 3,
};

const HOURLY = {
  temperature_2m: 'temperature',
  apparent_temperature: 'apparent_temperature',
  precipitation_probability: 'precipitation_probability',
  precipitation: 'precipitation',
  sunshine_duration: 'sunshine',
  weather_code: 'weather_code',
  wind_speed_10m: 'wind_speed',
  wind_gusts_10m: 'wind_gusts',
};

const DAILY = {
  temperature_2m_max: 'temperature_max',
  temperature_2m_min: 'temperature_min',
  precipitation_sum: 'precipitation_sum',
  precipitation_probability_max: 'precipitation_probability_max',
  sunshine_duration: 'sunshine',
  weather_code: 'weather_code',
  sunrise: 'sunrise_utc',
  sunset: 'sunset_utc',
};

/**
 * The request for a place. Times come back as unix seconds, like everything
 * else in this project; `timeZone` only decides where Open-Meteo's days begin,
 * so the daily values are the household's local days. It has to be the
 * tablet's zone too, or the page cannot find today's row.
 */
export function forecastUrl({ lat, lon }, timeZone) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: Object.keys(HOURLY).join(','),
    daily: Object.keys(DAILY).join(','),
    timezone: timeZone,
    timeformat: 'unixtime',
    forecast_days: String(FORECAST.days),
    wind_speed_unit: 'kmh',
  });
  return `${API}?${params}`;
}

/** Open-Meteo's column arrays → one object per hour or day, under our names. */
function rows(block, names, timeName) {
  if (!block || !Array.isArray(block.time)) throw new Error('forecast without a time axis');
  return block.time.map((time, i) => {
    const row = { [timeName]: time };
    for (const [from, to] of Object.entries(names)) {
      const value = block[from]?.[i];
      row[to] = typeof value === 'number' ? value : null;
    }
    return row;
  });
}

/**
 * A response body → `{ hourly, daily }`, each oldest first. `hourly[i].time_utc`
 * is the start of the hour; `daily[i].time_utc` is local midnight. A value
 * Open-Meteo leaves out is null.
 */
export function parseForecast(body) {
  return {
    hourly: rows(body?.hourly, HOURLY, 'time_utc'),
    daily: rows(body?.daily, DAILY, 'time_utc'),
  };
}

/**
 * The forecast as the server holds it. `current()` never waits and never
 * throws: it answers with the last good forecast and its fetch time, or null
 * when there is none or it is too old.
 *
 * @param {object} deps
 * @param {{ lat: number, lon: number }} deps.place
 * @param {string} deps.timeZone IANA zone whose midnights start the daily rows
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now] clock in milliseconds
 */
export function createForecast({ place, timeZone, fetchImpl = fetch, now = Date.now, log = defaultLog }) {
  let last = null;
  let timer = null;
  let stopped = false;

  async function refresh() {
    try {
      const response = await fetchImpl(forecastUrl(place, timeZone), { signal: AbortSignal.timeout(FORECAST.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      last = { fetched_utc: Math.floor(now() / 1000), ...parseForecast(await response.json()) };
      return true;
    } catch (error) {
      log.warn(`forecast failed, keeping the last one: ${error.message}`);
      return false;
    }
  }

  return {
    refresh,

    current() {
      if (!last || now() / 1000 - last.fetched_utc > FORECAST.maxAgeS) return null;
      return last;
    },

    /** Fetches now and then on its own schedule until `stop()`. */
    start() {
      stopped = false;
      const cycle = async () => {
        const ok = await refresh();
        // A stop() while the fetch was in flight must not start a new round.
        if (!stopped) timer = setTimeout(cycle, ok ? FORECAST.refreshMs : FORECAST.retryMs);
      };
      cycle();
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
