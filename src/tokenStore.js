import { readFile, writeFile, rename, unlink, open, link } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { assertUsable } from './tokens.js';
import { log } from './log.js';
import { randomUUID } from 'node:crypto';

/**
 * The token file is live credential state, not configuration: every renewal
 * invalidates the previous refresh token, so a lost or half-written file costs
 * a manual trip to the developer portal. Hence two guarantees here — an atomic
 * replace, and a lock that makes a second writer fail loudly instead of
 * silently racing the first one.
 */

const HINT = `
Create it next to package.json with the pair from the token generator on
https://dev.netatmo.com/apps (your app, scope
read_station):

  {
    "access_token": "...",
    "refresh_token": "..."
  }

No expiry is needed — the first poll refreshes the pair and records one.`;

export async function readToken(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No token file at ${path}.${HINT}`);
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON.${HINT}`);
  }
  return assertUsable(parsed, path);
}

/**
 * Replace the file atomically: a temp file in the same directory, flushed to
 * disk, then renamed over the target. A crash mid-write therefore leaves the
 * previous, still-valid token in place rather than a truncated file.
 */
export async function writeToken(path, token) {
  const temp = join(dirname(path), `.${basename(path)}.tmp`);
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(token, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

/**
 * Exactly one writer. Two pollers against one token file would invalidate each
 * other's refresh token within minutes, so a lock held by a running process is
 * refused, loudly.
 *
 * A lock whose process is gone — `kill -9`, a crash, a power cut — is taken
 * over instead. Under a supervisor that restarts the poller, refusing it
 * would be a silent outage: the same refusal forever, and a stale wall.
 *
 * The lock is created complete or not at all: its content goes into a temp
 * file that is then hard-linked to the lock's name, and `link` fails if the
 * name exists. With `open(…, 'wx')` a crash between creating and writing left
 * an empty lock that named no process to check.
 */
export async function acquireLock(path) {
  const lockPath = `${path}.lock`;
  const content = `pid ${process.pid} since ${new Date().toISOString()}`;
  try {
    await createExclusive(lockPath, content);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readLock(lockPath);
    if (owner === null) return acquireLock(path); // released in the meantime
    const pid = ownerPid(owner);
    if (pid === null || isAlive(pid)) throw held(lockPath, owner, pid);
    await takeOver(lockPath, owner, content);
    log.warn(`took over a stale ${lockPath} (${owner}) — that process is gone`);
  }
  return () => unlink(lockPath).catch(() => {});
}

/**
 * Replaces a stale lock, and only that one. Two pollers starting at once may
 * both find the same stale lock; a guard file, itself created exclusively,
 * lets one of them through, and the lock is re-read under it — if it no longer
 * holds the stale content, someone else has already taken it over.
 */
async function takeOver(lockPath, stale, content) {
  const guard = `${lockPath}.takeover`;
  try {
    await createExclusive(guard, content);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      `${lockPath} is being taken over by another poller right now (${guard} exists).\n` +
        `If no poller is starting, ${guard} is a leftover from a crash and can be deleted.`,
    );
  }
  try {
    const current = await readLock(lockPath);
    if (current !== null && current !== stale) throw held(lockPath, current, ownerPid(current));
    if (current !== null) await unlink(lockPath);
    await createExclusive(lockPath, content);
  } finally {
    await unlink(guard).catch(() => {});
  }
}

async function createExclusive(path, content) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, 'utf8');
  try {
    await link(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/** The lock's content, or null if there is no lock (any more). */
async function readLock(lockPath) {
  try {
    return (await readFile(lockPath, 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function ownerPid(owner) {
  const match = /^pid (\d+)\b/.exec(owner);
  return match ? Number(match[1]) : null;
}

/** `ESRCH` means no such process; `EPERM` means it exists but belongs to someone else. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function held(lockPath, owner, pid) {
  const hint = pid === null
    ? `It names no process, so it cannot be checked. If no poller is running, it can be deleted.`
    : `pid ${pid} is running. If that is not a poller — after a reboot the pid can\n` +
      `belong to an unrelated process — the lock is a leftover and can be deleted.`;
  return new Error(
    `${lockPath} exists — another poller holds the token file (${owner}).\n` +
      `Two writers would invalidate each other's refresh token. ${hint}`,
  );
}
