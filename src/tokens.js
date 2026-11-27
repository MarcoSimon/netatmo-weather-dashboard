/**
 * Pure token logic. No IO, no clock of its own — the caller passes `now` so
 * every branch is reachable from a test.
 */

/** Refresh this long before the access token actually expires. */
export const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * A token pair straight from the developer portal's token generator has no
 * expiry recorded, so it counts as expired: the first cycle refreshes it and
 * establishes `expires_at` from there on. That also exercises the rotation on
 * the very first run, which is exactly what phase 0 is meant to prove.
 */
export function isExpired(token, now, skewMs = EXPIRY_SKEW_MS) {
  if (typeof token?.expires_at !== 'number') return true;
  return token.expires_at - skewMs <= now;
}

/** Netatmo returns `expires_in` in seconds, relative to the response. */
export function withExpiry(response, now) {
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: now + response.expires_in * 1000,
  };
}

/**
 * Guards against a truncated or hand-edited token file. A missing
 * `refresh_token` is unrecoverable, so it must fail loudly rather than send a
 * request that would look like an ordinary auth error.
 */
export function assertUsable(token, source) {
  if (!token || typeof token !== 'object') {
    throw new Error(`${source} does not contain a JSON object`);
  }
  for (const field of ['access_token', 'refresh_token']) {
    if (typeof token[field] !== 'string' || token[field] === '') {
      throw new Error(`${source} is missing a non-empty "${field}"`);
    }
  }
  return token;
}
