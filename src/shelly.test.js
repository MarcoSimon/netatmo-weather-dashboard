import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestAuthorization, fullyDeviceInfo, fullyDeviceInfoUrl, loadChargeConfig, parseChallenge, shellyCall } from './shelly.js';

test('the digest response matches the SHA-256 example of RFC 7616', () => {
  const challenge = parseChallenge(
    'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, ' +
      'nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"',
  );
  const header = digestAuthorization({
    challenge,
    method: 'GET',
    uri: '/dir/index.html',
    username: 'Mufasa',
    password: 'Circle of Life',
    cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
  });
  assert.match(header, /response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"/);
  assert.match(header, /nc=00000001/);
  assert.match(header, /opaque="FQhe\/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"/);
});

test("the plug's own challenge parses, and no digest is no challenge", () => {
  assert.deepEqual(
    parseChallenge('Digest qop="auth", realm="shellyplugmg3-70af09f9bc70", nonce="1791051875", algorithm=SHA-256'),
    { qop: 'auth', realm: 'shellyplugmg3-70af09f9bc70', nonce: '1791051875', algorithm: 'SHA-256' },
  );
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge(null), null);
});

test('only SHA-256 is answered', () => {
  assert.throws(
    () => digestAuthorization({ challenge: { realm: 'r', nonce: 'n', algorithm: 'MD5' }, method: 'POST', uri: '/rpc', username: 'admin', password: 'x', cnonce: 'c' }),
    /unsupported digest algorithm MD5/,
  );
});

function fakePlug(answers) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const { status, body = '', headers = {} } = answers.shift();
    return new Response(body, { status, headers });
  };
  return { requests, fetchImpl };
}

const CHALLENGE = { 'WWW-Authenticate': 'Digest qop="auth", realm="plug", nonce="42", algorithm=SHA-256' };

test('a call posts a JSON-RPC frame and answers the challenge once', async () => {
  const { requests, fetchImpl } = fakePlug([
    { status: 401, headers: CHALLENGE },
    { status: 200, body: '{"id":1,"src":"plug","result":{"output":true,"apower":10.2}}' },
  ]);
  const result = await shellyCall({ host: '192.0.2.77', password: 'pw', method: 'Switch.GetStatus', params: { id: 0 }, fetchImpl });
  assert.deepEqual(result, { output: true, apower: 10.2 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'http://192.0.2.77/rpc');
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body), { id: 1, method: 'Switch.GetStatus', params: { id: 0 } });
  assert.match(requests[1].init.headers.Authorization, /^Digest username="admin", realm="plug", nonce="42", uri="\/rpc"/);
});

test('a plug without authentication is called once', async () => {
  const { requests, fetchImpl } = fakePlug([{ status: 200, body: '{"id":1,"result":{"scripts":[]}}' }]);
  assert.deepEqual(await shellyCall({ host: 'h', method: 'Script.List', fetchImpl }), { scripts: [] });
  assert.equal(requests.length, 1);
});

test('a wrong password and an RPC error say which call failed', async () => {
  let plug = fakePlug([{ status: 401, headers: CHALLENGE }, { status: 401, headers: CHALLENGE }]);
  await assert.rejects(shellyCall({ host: 'h', password: 'x', method: 'Script.List', fetchImpl: plug.fetchImpl }), /Script.List: the plug rejected the password/);
  plug = fakePlug([{ status: 200, body: '{"id":1,"error":{"code":-105,"message":"Argument \'id\', value 9 not found!"}}' }]);
  await assert.rejects(shellyCall({ host: 'h', method: 'Script.Start', params: { id: 9 }, fetchImpl: plug.fetchImpl }), /Script.Start: Argument 'id', value 9 not found!/);
  plug = fakePlug([{ status: 401, headers: CHALLENGE }]);
  await assert.rejects(shellyCall({ host: 'h', method: 'Script.List', fetchImpl: plug.fetchImpl }), /asks for authentication/);
});

test("the kiosk browser's URL carries its password encoded", () => {
  assert.equal(
    fullyDeviceInfoUrl({ host: '192.0.2.27', password: 'a&b c=d' }),
    'http://192.0.2.27:2323/?cmd=deviceInfo&type=json&password=a%26b+c%3Dd',
  );
});

test("the kiosk browser's wrong-password answer is an error, though it comes with 200", async () => {
  const fetchImpl = async () => new Response('{"status":"Error","statustext":"Please login"}', { status: 200 });
  await assert.rejects(fullyDeviceInfo({ host: 'h', password: 'x', fetchImpl }), /kiosk browser: Please login/);
  const ok = async () => new Response('{"batteryLevel":62,"isPlugged":true}', { status: 200 });
  assert.equal((await fullyDeviceInfo({ host: 'h', password: 'x', fetchImpl: ok })).batteryLevel, 62);
});

test('the charge settings name every one missing from .env', () => {
  assert.throws(() => loadChargeConfig({ SHELLY_HOST: 'h' }), /missing in \.env: SHELLY_PASSWORD, FULLY_HOST, FULLY_PASSWORD/);
  assert.deepEqual(loadChargeConfig({ SHELLY_HOST: 's', SHELLY_PASSWORD: 'sp', FULLY_HOST: 'f', FULLY_PASSWORD: 'fp' }), {
    shelly: { host: 's', password: 'sp' },
    fully: { host: 'f', password: 'fp' },
  });
});
