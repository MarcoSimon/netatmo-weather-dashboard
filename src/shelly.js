/**
 * The Shelly plug's local RPC API and the kiosk browser's REST API, as the
 * charge loop's tools on the host use them (`npm run charge:deploy`,
 * `npm run charge:log`). The loop itself runs on the plug (`shelly/charge.js`)
 * and needs neither.
 *
 * With authentication on, the plug answers every RPC with 401 until the
 * request carries HTTP digest authentication (RFC 7616, SHA-256, user
 * `admin`). `node:crypto` covers that, so the client stays a `fetch`.
 */
import { createHash, randomBytes } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The parameters of a `WWW-Authenticate: Digest …` header, or null. */
export function parseChallenge(header) {
  if (!header || !/^Digest\s/i.test(header)) return null;
  const params = {};
  for (const [, key, quoted, bare] of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[key.toLowerCase()] = quoted ?? bare;
  }
  return params;
}

/** The `Authorization` header answering a digest challenge with qop=auth. */
export function digestAuthorization({ challenge, method, uri, username, password, cnonce, nc = 1 }) {
  const algorithm = challenge.algorithm ?? 'SHA-256';
  if (algorithm.toUpperCase() !== 'SHA-256') throw new Error(`unsupported digest algorithm ${algorithm}`);
  const count = nc.toString(16).padStart(8, '0');
  const ha1 = sha256(`${username}:${challenge.realm}:${password}`);
  const ha2 = sha256(`${method}:${uri}`);
  const response = sha256(`${ha1}:${challenge.nonce}:${count}:${cnonce}:auth:${ha2}`);
  const fields = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    `response="${response}"`,
    'qop=auth',
    `nc=${count}`,
    `cnonce="${cnonce}"`,
  ];
  if (challenge.opaque !== undefined) fields.push(`opaque="${challenge.opaque}"`);
  return `Digest ${fields.join(', ')}`;
}

/**
 * Calls one RPC method on the plug and returns its result. A JSON-RPC frame
 * posted to `/rpc`, so parameters of any size and shape travel as JSON — a
 * script's code included, which a URL would not hold.
 */
export async function shellyCall({ host, password, method, params = {}, fetchImpl = fetch }) {
  const url = `http://${host}/rpc`;
  const body = JSON.stringify({ id: 1, method, params });
  const post = (headers) =>
    fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

  let response = await post({});
  if (response.status === 401) {
    const challenge = parseChallenge(response.headers.get('www-authenticate'));
    await response.arrayBuffer();
    if (!challenge || password === undefined) throw new Error(`${method}: the plug asks for authentication`);
    const authorization = digestAuthorization({
      challenge, method: 'POST', uri: '/rpc', username: 'admin', password, cnonce: randomBytes(16).toString('hex'),
    });
    response = await post({ Authorization: authorization });
  }
  if (response.status === 401) throw new Error(`${method}: the plug rejected the password`);
  const text = await response.text();
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new Error(`${method}: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }
  if (answer.error) throw new Error(`${method}: ${answer.error.message ?? JSON.stringify(answer.error)}`);
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  return answer.result;
}

/** The kiosk browser's deviceInfo URL, password included and encoded. */
export function fullyDeviceInfoUrl({ host, password }) {
  const query = new URLSearchParams({ cmd: 'deviceInfo', type: 'json', password });
  return `http://${host}:2323/?${query}`;
}

/** The tablet's own report: battery level, whether it is plugged in, and more. */
export async function fullyDeviceInfo({ host, password, fetchImpl = fetch }) {
  const response = await fetchImpl(fullyDeviceInfoUrl({ host, password }), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`kiosk browser: HTTP ${response.status}`);
  const info = await response.json();
  // A wrong password is answered with 200 and this body, not with a 401.
  if (info?.status === 'Error') throw new Error(`kiosk browser: ${info.statustext ?? 'error'}`);
  return info;
}

/** The four settings the charge tools need from `.env`, or an error naming the missing ones. */
export function loadChargeConfig(env = process.env) {
  const names = ['SHELLY_HOST', 'SHELLY_PASSWORD', 'FULLY_HOST', 'FULLY_PASSWORD'];
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`missing in .env: ${missing.join(', ')}`);
  return {
    shelly: { host: env.SHELLY_HOST, password: env.SHELLY_PASSWORD },
    fully: { host: env.FULLY_HOST, password: env.FULLY_PASSWORD },
  };
}
