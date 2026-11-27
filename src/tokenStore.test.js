import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readToken, writeToken, acquireLock } from './tokenStore.js';

async function scratch() {
  return join(await mkdtemp(join(tmpdir(), 'token-')), 'token.json');
}

test('a missing token file explains how to create one', async () => {
  const path = await scratch();
  await assert.rejects(() => readToken(path), /No token file at .*token generator/s);
});

test('an unparsable token file is named as such', async () => {
  const path = await scratch();
  await writeFile(path, '{ oops');
  await assert.rejects(() => readToken(path), /not valid JSON/);
});

test('a hand-written pair without an expiry is accepted', async () => {
  const path = await scratch();
  await writeFile(path, JSON.stringify({ access_token: 'a', refresh_token: 'r' }));
  assert.deepEqual(await readToken(path), { access_token: 'a', refresh_token: 'r' });
});

test('a write is readable back and leaves no temp file behind', async () => {
  const path = await scratch();
  const token = { access_token: 'a', refresh_token: 'r', expires_at: 123 };
  await writeToken(path, token);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), token);
  const left = await readdir(join(path, '..'));
  assert.deepEqual(left, ['token.json']);
});

test('a second writer is refused while the first holds the lock', async () => {
  const path = await scratch();
  const release = await acquireLock(path);
  await assert.rejects(() => acquireLock(path), /another poller holds the token file/);
  await release();
});

test('releasing the lock lets the next poller take it', async () => {
  const path = await scratch();
  await (await acquireLock(path))();
  const release = await acquireLock(path);
  await release();
});

test('releasing twice is harmless', async () => {
  const path = await scratch();
  const release = await acquireLock(path);
  await release();
  await release();
});

/** The pid of a process that has already exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('a lock left by a process that is gone is taken over', async () => {
  const path = await scratch();
  await writeFile(`${path}.lock`, `pid ${deadPid()} since 2025-09-12T12:00:00.000Z`);
  const release = await acquireLock(path);
  assert.match(await readFile(`${path}.lock`, 'utf8'), new RegExp(`^pid ${process.pid} since `));
  assert.deepEqual((await readdir(join(path, '..'))).sort(), ['token.json.lock']);
  await release();
});

test('a lock held by a running process is still refused', async () => {
  const path = await scratch();
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  try {
    await writeFile(`${path}.lock`, `pid ${other.pid} since 2025-09-12T12:00:00.000Z`);
    await assert.rejects(() => acquireLock(path), new RegExp(`another poller holds the token file .*pid ${other.pid} is running`, 's'));
  } finally {
    other.kill();
  }
});

test('a lock that names no process is refused', async () => {
  const path = await scratch();
  await writeFile(`${path}.lock`, '');
  await assert.rejects(() => acquireLock(path), /names no process/);
});

test('two pollers finding the same stale lock: only one takes it over', async () => {
  const path = await scratch();
  await writeFile(`${path}.lock`, `pid ${deadPid()} since 2025-09-12T12:00:00.000Z`);
  const results = await Promise.allSettled([acquireLock(path), acquireLock(path)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.deepEqual((await readdir(join(path, '..'))).sort(), ['token.json.lock']);
  await results.find((r) => r.status === 'fulfilled').value();
});
