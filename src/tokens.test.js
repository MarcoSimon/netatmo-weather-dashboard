import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpired, withExpiry, assertUsable, EXPIRY_SKEW_MS } from './tokens.js';

const NOW = 1_757_400_000_000;

test('a freshly pasted token pair counts as expired', () => {
  assert.equal(isExpired({ access_token: 'a', refresh_token: 'r' }, NOW), true);
});

test('a token well inside its lifetime is not expired', () => {
  assert.equal(isExpired({ expires_at: NOW + 3 * 60 * 60 * 1000 }, NOW), false);
});

test('a token inside the skew window counts as expired', () => {
  assert.equal(isExpired({ expires_at: NOW + EXPIRY_SKEW_MS - 1 }, NOW), true);
});

test('a token exactly at the skew boundary counts as expired', () => {
  assert.equal(isExpired({ expires_at: NOW + EXPIRY_SKEW_MS }, NOW), true);
});

test('a caller-supplied skew overrides the default', () => {
  const token = { expires_at: NOW + 60 * 60 * 1000 };
  assert.equal(isExpired(token, NOW), false, 'not due under the default skew');
  assert.equal(isExpired(token, NOW, 2 * 60 * 60 * 1000), true, 'due under a wider skew');
});

test('withExpiry converts expires_in seconds to an absolute timestamp', () => {
  const token = withExpiry(
    { access_token: 'a2', refresh_token: 'r2', expires_in: 10800 },
    NOW,
  );
  assert.deepEqual(token, {
    access_token: 'a2',
    refresh_token: 'r2',
    expires_at: NOW + 10_800_000,
  });
});

test('assertUsable rejects a pair without a refresh token', () => {
  assert.throws(
    () => assertUsable({ access_token: 'a' }, 'token.json'),
    /token\.json is missing a non-empty "refresh_token"/,
  );
});

test('assertUsable rejects an empty refresh token', () => {
  assert.throws(
    () => assertUsable({ access_token: 'a', refresh_token: '' }, 'token.json'),
    /refresh_token/,
  );
});

test('assertUsable rejects a non-object', () => {
  assert.throws(() => assertUsable(null, 'token.json'), /JSON object/);
});

test('assertUsable returns the token it was given', () => {
  const token = { access_token: 'a', refresh_token: 'r' };
  assert.equal(assertUsable(token, 'token.json'), token);
});
