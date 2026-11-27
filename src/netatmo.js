import { withExpiry } from './tokens.js';

const API = 'https://api.netatmo.com';

/**
 * Raised when the refresh token is no longer accepted. This is the one failure
 * the poller cannot retry its way out of: the chain is broken and only a fresh
 * pair from the developer portal restores it.
 */
export class TokenChainBroken extends Error {
  constructor(detail) {
    super(
      `The refresh token was rejected (${detail}). The chain is broken and\n` +
        `retrying cannot fix it. Generate a new pair on https://dev.netatmo.com/apps\n` +
        `(your app, scope read_station) and write it to the\n` +
        `token file.`,
    );
    this.name = 'TokenChainBroken';
  }
}

async function readError(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    // OAuth errors are flat (`error: "invalid_grant"`), API errors are nested
    // under `error.message` — both shapes occur against the same host.
    return body?.error?.message ?? body?.error_description ?? body?.error ?? text;
  } catch {
    return text.slice(0, 200);
  }
}

/**
 * Exchanges the stored refresh token for a new pair. Netatmo returns a *new*
 * refresh token here and retires the old one, so the result must be persisted
 * before the next call — that rotation is what phase 0 exists to verify.
 */
export async function refreshTokens({ token, clientId, clientSecret, now = Date.now(), fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new TokenChainBroken(`HTTP ${response.status}: ${detail}`);
    }
    throw new Error(`Token refresh failed with HTTP ${response.status}: ${detail}`);
  }

  const body = await response.json();
  if (!body.access_token || !body.refresh_token) {
    throw new Error('Token refresh returned no usable pair');
  }
  return withExpiry(body, now);
}

export async function getStationsData({ accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}/api/getstationsdata`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`getstationsdata failed with HTTP ${response.status}: ${await readError(response)}`);
  }
  return response.json();
}

/**
 * One page of a module's history at full resolution, oldest first, starting at
 * `dateBegin` (unix seconds). Netatmo caps a page at 1024 points and, for a
 * `dateBegin` before the first measurement, starts at the first one — so `0`
 * means "from the beginning".
 *
 * `optimize=false` keys every point by its own timestamp. The optimized format
 * reconstructs timestamps from a step width, which only saves bytes.
 */
export async function getMeasure({ accessToken, deviceId, moduleId, types, dateBegin, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    device_id: deviceId,
    scale: 'max',
    type: types.join(','),
    date_begin: String(dateBegin),
    optimize: 'false',
  });
  // The base unit's own measurements are addressed by the device alone.
  if (moduleId && moduleId !== deviceId) params.set('module_id', moduleId);

  const response = await fetchImpl(`${API}/api/getmeasure?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`getmeasure failed with HTTP ${response.status}: ${await readError(response)}`);
  }
  return response.json();
}
