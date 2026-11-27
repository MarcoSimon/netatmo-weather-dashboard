import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshTokens, getStationsData, getMeasure, TokenChainBroken } from './netatmo.js';

const NOW = 1_757_400_000_000;
const CREDS = { clientId: 'id', clientSecret: 'secret' };
const TOKEN = { access_token: 'old-access', refresh_token: 'old-refresh' };

function respond(status, body, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : body;
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  });
}

test('a successful refresh returns the rotated pair with an absolute expiry', async () => {
  const fetchImpl = respond(200, {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 10800,
  });
  const token = await refreshTokens({ token: TOKEN, ...CREDS, now: NOW, fetchImpl });
  assert.deepEqual(token, {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_at: NOW + 10_800_000,
  });
});

test('the refresh is sent as form-encoded grant_type=refresh_token', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return (await respond(200, { access_token: 'a', refresh_token: 'r', expires_in: 1 })()) ;
  };
  await refreshTokens({ token: TOKEN, ...CREDS, now: NOW, fetchImpl });
  assert.match(seen.url, /\/oauth2\/token$/);
  assert.equal(seen.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(seen.init.body.get('grant_type'), 'refresh_token');
  assert.equal(seen.init.body.get('refresh_token'), 'old-refresh');
  assert.equal(seen.init.body.get('client_id'), 'id');
});

test('a rejected refresh token is unrecoverable, not a transient failure', async () => {
  for (const status of [400, 401, 403]) {
    await assert.rejects(
      () => refreshTokens({ token: TOKEN, ...CREDS, now: NOW, fetchImpl: respond(status, { error: 'invalid_grant' }) }),
      TokenChainBroken,
      `HTTP ${status} should break the chain`,
    );
  }
});

test('a server-side failure stays retryable', async () => {
  await assert.rejects(
    () => refreshTokens({ token: TOKEN, ...CREDS, now: NOW, fetchImpl: respond(503, { error: 'busy' }) }),
    (error) => error instanceof Error && !(error instanceof TokenChainBroken) && /HTTP 503/.test(error.message),
  );
});

test('a 200 without a usable pair is an error rather than a half-written token', async () => {
  await assert.rejects(
    () => refreshTokens({ token: TOKEN, ...CREDS, now: NOW, fetchImpl: respond(200, { access_token: 'a' }) }),
    /no usable pair/,
  );
});

test('the nested API error shape is unwrapped into the message', async () => {
  await assert.rejects(
    () => getStationsData({ accessToken: 'a', fetchImpl: respond(403, { error: { code: 13, message: 'Application deactivated' } }) }),
    /Application deactivated/,
  );
});

test('a non-JSON error body does not mask the status code', async () => {
  await assert.rejects(
    () => getStationsData({ accessToken: 'a', fetchImpl: respond(502, '<html>bad gateway</html>', { json: false }) }),
    /HTTP 502/,
  );
});

test('getstationsdata sends the access token as a bearer', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return (await respond(200, { status: 'ok', body: { devices: [] } })());
  };
  await getStationsData({ accessToken: 'the-token', fetchImpl });
  assert.match(seen.url, /\/api\/getstationsdata$/);
  assert.equal(seen.init.headers.Authorization, 'Bearer the-token');
});

function capture() {
  const seen = {};
  const fetchImpl = async (url, init) => {
    Object.assign(seen, { url: new URL(url), init });
    return (await respond(200, { status: 'ok', body: [] })());
  };
  return { seen, fetchImpl };
}

test('getmeasure asks for full resolution, unoptimized, from the given point', async () => {
  const { seen, fetchImpl } = capture();
  await getMeasure({
    accessToken: 'the-token',
    deviceId: '70:ee:50:00:00:01',
    moduleId: '02:00:00:00:00:02',
    types: ['temperature', 'humidity'],
    dateBegin: 1757441531,
    fetchImpl,
  });
  assert.equal(seen.url.pathname, '/api/getmeasure');
  assert.deepEqual(Object.fromEntries(seen.url.searchParams), {
    device_id: '70:ee:50:00:00:01',
    module_id: '02:00:00:00:00:02',
    scale: 'max',
    type: 'temperature,humidity',
    date_begin: '1757441531',
    optimize: 'false',
  });
  assert.equal(seen.init.headers.Authorization, 'Bearer the-token');
});

test('the base unit is addressed by its device id alone', async () => {
  const { seen, fetchImpl } = capture();
  const id = '70:ee:50:00:00:01';
  await getMeasure({ accessToken: 'a', deviceId: id, moduleId: id, types: ['co2'], dateBegin: 0, fetchImpl });
  assert.equal(seen.url.searchParams.has('module_id'), false);
});

test('a failed getmeasure carries the status and the API message', async () => {
  await assert.rejects(
    () => getMeasure({
      accessToken: 'a', deviceId: 'd', types: ['temperature'], dateBegin: 0,
      fetchImpl: respond(503, { error: { code: 1, message: 'Service temporarily unavailable' } }),
    }),
    /getmeasure failed with HTTP 503: Service temporarily unavailable/,
  );
});
