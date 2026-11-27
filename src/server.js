/**
 * The HTTP side: a JSON API over what the poller stored, and the frontend's
 * static files. Plain `node:http`, LAN only, no TLS.
 *
 * The measurements answered here come from SQLite, the forecast from memory
 * (`src/openMeteo.js`). This module never calls Netatmo
 * and never touches `token.json` — the poller is the single writer of the
 * rotating refresh token, and it runs as a separate process so that nothing
 * the server does can take that file down with it.
 *
 * Timestamps leave as unix seconds in UTC; local time is the frontend's job.
 */
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { log } from './log.js';

/**
 * The default window of a series: the page shows the last 24 hours, and the
 * endpoint takes `?hours=` for anything else.
 */
export const DEFAULT_HOURS = 24;
/** A week at five-minute resolution is ~2,000 points per module; longer ranges would need aggregating. */
export const MAX_HOURS = 7 * 24;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./reader.js').openReader>} deps.reader
 * @param {string} deps.publicDir  root of the static files
 * @param {{ current: () => object | null }} [deps.forecast] the forecast held in memory, if configured
 * @param {object} [deps.settings] the install-time settings from `.env` (`installSettings` in `config.js`)
 * @param {() => number} [deps.now] clock in milliseconds, injectable for tests
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createHandler({ reader, publicDir, forecast = null, settings = null, now = Date.now }) {
  const root = resolve(publicDir);

  function api(path, query) {
    const nowUtc = Math.floor(now() / 1000);
    if (path === '/api/modules') {
      return { now_utc: nowUtc, modules: reader.modules() };
    }
    if (path === '/api/forecast') {
      // Null without coordinates, before the first fetch, and once it is too old.
      return { now_utc: nowUtc, forecast: forecast?.current() ?? null };
    }
    if (path === '/api/settings') {
      // Null only in a handler built without them; the page then keeps its defaults.
      return { now_utc: nowUtc, settings: settings && settingsJson(settings) };
    }
    const match = /^\/api\/modules\/(\d+)\/series$/.exec(path);
    if (match) {
      const hours = parseHours(query.get('hours'));
      const fromUtc = nowUtc - hours * 3600;
      const series = reader.series(Number(match[1]), fromUtc, nowUtc);
      if (!series) throw new HttpError(404, `no module ${match[1]}`);
      return { now_utc: nowUtc, from_utc: fromUtc, to_utc: nowUtc, ...series };
    }
    throw new HttpError(404, `no endpoint ${path}`);
  }

  async function staticFile(path) {
    const file = resolve(join(root, path === '/' ? 'index.html' : path));
    // `resolve` has already collapsed any `..`; whatever lands outside the
    // root was an attempt to leave it.
    if (!file.startsWith(root + sep)) throw new HttpError(404, `not found: ${path}`);
    try {
      return { body: await readFile(file), type: CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new HttpError(404, `not found: ${path}`);
      throw error;
    }
  }

  return async function handle(req, res) {
    const head = req.method === 'HEAD';
    const send = (status, type, body, cache) => {
      res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': body.length,
        // The page reloads itself hourly and must pick up a new version; the
        // data is never worth caching.
        'Cache-Control': cache,
      });
      res.end(head ? undefined : body);
    };
    const sendJson = (status, value) =>
      send(status, CONTENT_TYPES['.json'], Buffer.from(JSON.stringify(value)), 'no-store');

    try {
      if (req.method !== 'GET' && !head) {
        res.setHeader('Allow', 'GET, HEAD');
        throw new HttpError(405, `method ${req.method} not allowed`);
      }
      const url = new URL(req.url, 'http://localhost');
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, 'malformed path');
      }
      if (path.includes('\0')) throw new HttpError(400, 'malformed path');
      if (path === '/api' || path.startsWith('/api/')) {
        sendJson(200, api(path, url.searchParams));
      } else {
        const { body, type } = await staticFile(path);
        send(200, type, body, 'no-cache');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(error.status, { error: error.message });
      } else {
        log.error(`${req.method} ${req.url} failed: ${error.stack ?? error.message}`);
        sendJson(500, { error: 'internal error' });
      }
    }
  };
}

/** The install-time settings under the API's snake_case names, times in minutes after local midnight. */
function settingsJson({ timeZone, sunsetOffsetMin, fallbackAt, nightFrom, dayFrom }) {
  return {
    time_zone: timeZone,
    sunset_offset_min: sunsetOffsetMin,
    fallback_at: { summer: fallbackAt.summer, winter: fallbackAt.winter },
    night_from: nightFrom,
    day_from: dayFrom,
  };
}

/** `?hours=` → a whole number of hours within [1, MAX_HOURS]; absent means the default. */
export function parseHours(raw) {
  if (raw === null) return DEFAULT_HOURS;
  const hours = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    throw new HttpError(400, `hours must be a whole number from 1 to ${MAX_HOURS}, got "${raw}"`);
  }
  return hours;
}
