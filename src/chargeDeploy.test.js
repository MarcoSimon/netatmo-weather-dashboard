import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOY, chunks, deploy } from './chargeDeploy.js';

function fakePlug(scripts) {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'Script.List') return { scripts };
    if (method === 'Script.Create') return { id: 3 };
    if (method === 'Script.GetStatus') return { id: params.id, running: true };
    return {};
  };
  return { calls, call };
}

test('a first deploy sets the fail-safe, stores the URL, creates the script and starts it with the plug', async () => {
  const { calls, call } = fakePlug([]);
  const status = await deploy({ call, code: 'print(1);', fullyUrl: 'http://f/' });
  assert.deepEqual(status, { id: 3, running: true });
  assert.deepEqual(calls.map((c) => c.method), [
    'Switch.SetConfig', 'KVS.Set', 'Script.List', 'Script.Create', 'Script.PutCode', 'Script.SetConfig', 'Script.Start', 'Script.GetStatus',
  ]);
  assert.deepEqual(calls[0].params, { id: 0, config: { initial_state: 'on', auto_on: true, auto_on_delay: 16200 } });
  assert.deepEqual(calls[1].params, { key: 'charge_fully_url', value: 'http://f/' });
  assert.deepEqual(calls[4].params, { id: 3, code: 'print(1);', append: false });
  assert.deepEqual(calls[5].params, { id: 3, config: { enable: true } });
});

test('a second deploy stops the running script, replaces its code in pieces and starts it again', async () => {
  const { calls, call } = fakePlug([{ id: 1, name: 'other', running: true }, { id: 2, name: 'charge', running: true }]);
  const code = 'x'.repeat(DEPLOY.chunk * 2 + 5);
  await deploy({ call, code, fullyUrl: 'http://f/' });
  assert.ok(!calls.some((c) => c.method === 'Script.Create'));
  assert.deepEqual(calls.find((c) => c.method === 'Script.Stop').params, { id: 2 });
  const puts = calls.filter((c) => c.method === 'Script.PutCode').map((c) => c.params);
  assert.deepEqual(puts.map((p) => [p.id, p.code.length, p.append]), [[2, DEPLOY.chunk, false], [2, DEPLOY.chunk, true], [2, 5, true]]);
  assert.equal(puts.map((p) => p.code).join(''), code);
});

test('chunks keep every character, an empty text included', () => {
  assert.deepEqual(chunks('abcde', 2), ['ab', 'cd', 'e']);
  assert.deepEqual(chunks('', 2), ['']);
});
