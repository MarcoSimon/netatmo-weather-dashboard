/**
 * Configuration comes from the environment, loaded by `node --env-file=.env`
 * (see the npm scripts) — no dotenv dependency involved.
 */
import { EVENING } from '../public/evening.js';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in the credentials\n` +
        `of your Netatmo app (README, "Setting it up").`,
    );
  }
  return value;
}

export function loadConfig() {
  return {
    clientId: required('NETATMO_CLIENT_ID'),
    clientSecret: required('NETATMO_CLIENT_SECRET'),
    tokenFile: process.env.TOKEN_FILE || './token.json',
    databaseFile: process.env.DATABASE_FILE || './data/weather.sqlite',
    intervalMs: Number(process.env.POLL_INTERVAL_MS || 10 * 60 * 1000),
    // Undefined means the module default. Setting this absurdly high forces a
    // refresh on every cycle, which turns "does the chain survive 16 rotations
    // over two days" into a test that runs in minutes.
    skewMs: process.env.TOKEN_SKEW_MS ? Number(process.env.TOKEN_SKEW_MS) : undefined,
  };
}

/**
 * The server's configuration. It deliberately asks for no Netatmo credentials
 * and no token file: the server only reads SQLite.
 */
export function loadServerConfig() {
  const port = Number(process.env.SERVER_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SERVER_PORT must be a port number, got "${process.env.SERVER_PORT}"`);
  }
  return {
    databaseFile: process.env.DATABASE_FILE || './data/weather.sqlite',
    port,
    // All interfaces: the tablet reaches the server over the LAN.
    host: process.env.SERVER_HOST || '0.0.0.0',
    forecastPlace: forecastPlace(process.env.FORECAST_LAT, process.env.FORECAST_LON),
    settings: installSettings(process.env),
  };
}

/**
 * What differs from one house to the next: the time zone of the
 * forecast's days, and when the page turns to its evening and its night.
 * Read once at start and served at `/api/settings`, so the page and the server
 * read from one place — the one a settings page on the wall would write
 * over. The defaults are `EVENING` in `public/evening.js`, so an unset value
 * behaves exactly as before; a malformed one stops the start with its name.
 *
 * Times are `HH:MM` in `.env` and minutes after local midnight from here on.
 */
export function installSettings(env) {
  const timeZone = env.TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error(`TIME_ZONE must be an IANA zone like Europe/Berlin, got "${timeZone}"`);
  }
  const settings = {
    timeZone,
    sunsetOffsetMin: offsetMinutes('EVENING_SUNSET_OFFSET_MIN', env.EVENING_SUNSET_OFFSET_MIN, EVENING.sunsetOffsetMin),
    fallbackAt: {
      summer: clockMinutes('EVENING_FALLBACK_SUMMER', env.EVENING_FALLBACK_SUMMER, EVENING.fallbackAt.summer),
      winter: clockMinutes('EVENING_FALLBACK_WINTER', env.EVENING_FALLBACK_WINTER, EVENING.fallbackAt.winter),
    },
    nightFrom: clockMinutes('NIGHT_FROM', env.NIGHT_FROM, EVENING.nightFrom),
    dayFrom: clockMinutes('DAY_FROM', env.DAY_FROM, EVENING.dayFrom),
  };
  if (settings.nightFrom === settings.dayFrom) {
    throw new Error('NIGHT_FROM and DAY_FROM must differ: a night needs a start and an end');
  }
  return settings;
}

/** `HH:MM` → minutes after midnight; unset means the default. */
function clockMinutes(name, raw, fallback) {
  if (!raw) return fallback;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) throw new Error(`${name} must be a time of day as HH:MM, got "${raw}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Whole minutes relative to sunset, negative for before it. Four hours either
 * way is far past any room's need and catches a value typed in seconds.
 */
function offsetMinutes(name, raw, fallback) {
  if (!raw) return fallback;
  const minutes = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(minutes) || Math.abs(minutes) > 240) {
    throw new Error(`${name} must be whole minutes from -240 to 240, got "${raw}"`);
  }
  return minutes;
}

/**
 * The place of the Open-Meteo forecast, or null when neither coordinate
 * is set — the dashboard then runs without a forecast. Two decimals are
 * enough: Open-Meteo's grid cells are kilometres wide.
 */
export function forecastPlace(rawLat, rawLon) {
  if (!rawLat && !rawLon) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!rawLat || !rawLon || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`FORECAST_LAT and FORECAST_LON must both be decimal degrees, got "${rawLat}" and "${rawLon}"`);
  }
  return { lat, lon };
}
