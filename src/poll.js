/**
 * The poller: every cycle renews the access token when it is due, records the
 * module list and each module's status from getstationsdata, and brings every
 * module's series up to date from getmeasure.
 *
 * There is no separate import: the first start, a restart after twelve hours
 * and an ordinary cycle all run the same backfill, which continues after the
 * newest stored point. Only the amount of work differs.
 */
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { readToken, writeToken, acquireLock } from './tokenStore.js';
import { isExpired } from './tokens.js';
import { refreshTokens, getStationsData, getMeasure, TokenChainBroken } from './netatmo.js';
import { parseStations, summarize } from './station.js';
import { seriesFor } from './measure.js';
import { backfillModule } from './backfill.js';
import { openStore } from './store.js';

/**
 * The first import is ~900 pages. Capping each cycle at 50, one second apart,
 * spreads it over about three hours at ~310 requests an hour — below Netatmo's
 * documented per-user limits (50 per 10 s, 500 per hour) — and keeps every
 * cycle around a minute long, well inside the token's five-minute skew.
 */
export const PAGES_PER_CYCLE = 50;
export const PAGE_PAUSE_MS = 1000;

const isoTime = (utc) => (utc === null ? 'nothing yet' : new Date(utc * 1000).toISOString());

/**
 * One cycle.
 *
 * The token file — not a variable in this process — is the source of truth, and
 * every cycle starts by reading it. That is not belt-and-braces: an earlier
 * version kept the token in memory and only assigned it once the *whole* cycle
 * had succeeded, so a failure after the refresh (a 503 from getstationsdata,
 * observed in practice) discarded the rotated pair and sent the
 * superseded refresh token on the next attempt. Netatmo happened to still
 * accept it 38 minutes later, which is the only reason the chain survived.
 *
 * We hold the exclusive lock, so re-reading costs one local file read and makes
 * that class of failure impossible. It also means a token pair dropped in by
 * hand is picked up without restarting the poller.
 *
 * `known` is the module list of the last cycle whose getstationsdata call
 * succeeded, and the cycle returns the list it worked with. When
 * getstationsdata fails — a 503 about 7 % of the time — the backfill still
 * runs on `known`: the call supplies only the module list and the status, and
 * losing the values for a cycle kept a wrong window hint on the wall for ten
 * more minutes. The status snapshot is skipped rather than invented.
 * Without a list (the first cycle after a start) the failure ends the cycle.
 */
export async function cycle(config, deps) {
  const {
    store,
    signal,
    known = null,
    refresh = refreshTokens,
    fetchStation = getStationsData,
    fetchMeasure = getMeasure,
    pause = () => sleep(PAGE_PAUSE_MS, signal),
  } = deps;
  let token = await readToken(config.tokenFile);

  if (isExpired(token, Date.now(), config.skewMs)) {
    const reason = token.expires_at ? 'access token due for renewal' : 'no expiry recorded yet';
    log.info(`refreshing (${reason})`);
    token = await refresh({
      token,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    // Persist before use: from here on the rotated pair survives any later
    // failure in this cycle.
    await writeToken(config.tokenFile, token);
    const validFor = Math.round((token.expires_at - Date.now()) / 60000);
    log.info(`refreshed, access token valid for ${validFor} min, refresh token rotated`);
  }

  let station = null;
  try {
    station = parseStations(await fetchStation({ accessToken: token.access_token }));
  } catch (error) {
    if (!known) throw error;
    log.warn(`${error.message} — backfilling the last known ${known.length} modules, no status this cycle`);
  }
  const now = station?.timeServer ?? Math.floor(Date.now() / 1000);
  const modules = (station?.modules ?? known).map((module) => {
    const moduleId = store.upsertModule(module, now);
    if (station) store.insertStatus(moduleId, now, module);
    return { module, moduleId };
  });

  // One budget for the whole cycle. A failure ends only that module's
  // backfill: the modules are independent, and the next cycle resumes each
  // one where it stopped.
  let budget = PAGES_PER_CYCLE;
  let added = 0;
  const behind = [];
  for (const { module, moduleId } of modules) {
    if (budget === 0 || signal?.aborted) {
      behind.push(module.name);
      continue;
    }
    const result = await backfillModule({
      store,
      moduleId,
      series: seriesFor(module.dataTypes),
      budget,
      pause,
      signal,
      fetchPage: ({ types, dateBegin }) => fetchMeasure({
        accessToken: token.access_token,
        deviceId: module.deviceId,
        moduleId: module.id,
        types,
        dateBegin,
      }),
    });
    budget -= result.pages;
    added += result.added;
    if (result.caughtUp) continue;
    behind.push(module.name);
    const progress = `+${result.added} samples, now at ${isoTime(result.last)}`;
    if (result.error) {
      log.warn(`backfill ${module.name} failed, resuming next cycle (${progress}): ${result.error.message}`);
    } else {
      log.info(`backfill ${module.name}: ${progress}`);
    }
  }

  const catchingUp = behind.length ? ` | catching up: ${behind.join(', ')}` : '';
  const summary = station
    ? `${station.stationName ?? 'station'} — ${summarize(station)}`
    : `without getstationsdata — ${modules.length} modules`;
  log.info(`ok ${summary} | +${added} samples${catchingUp}`);
  return station?.modules ?? known;
}

/**
 * Waits out the interval, but gives it up the moment the signal is aborted.
 * A plain timer made Ctrl-C take up to a full interval to be honoured, because
 * the stop flag was only read once the sleep had finished on its own.
 *
 * `node:timers/promises` rejects with an AbortError on abort; that is the
 * normal path here, not a failure, so it is swallowed.
 */
export async function sleep(ms, signal) {
  try {
    await delay(ms, undefined, { signal });
    return 'elapsed';
  } catch (error) {
    if (error?.name === 'AbortError') return 'aborted';
    throw error;
  }
}

/**
 * `--once` is `--cycles=1`. A bounded run is what makes the rotation testable:
 * combined with a wide TOKEN_SKEW_MS it forces one refresh per cycle, so the
 * chain can be put through a day's worth of rotations in minutes.
 */
function plannedCycles(argv) {
  if (argv.includes('--once')) return 1;
  const flag = argv.find((a) => a.startsWith('--cycles='));
  if (!flag) return Infinity;
  const n = Number(flag.slice('--cycles='.length));
  if (!Number.isInteger(n) || n < 1) throw new Error(`--cycles needs a positive integer, got "${flag}"`);
  return n;
}

async function main() {
  const cycles = plannedCycles(process.argv);
  const config = loadConfig();
  const release = await acquireLock(config.tokenFile);
  let store;

  // A stop request interrupts the wait between cycles and the pause between
  // backfill pages. An HTTP call already in flight still has to finish — at
  // worst a few seconds, against the ten minutes a plain timer used to cost.
  const stopping = new AbortController();
  let stop = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info(`${signal} — stopping`);
      stop = true;
      stopping.abort();
    });
  }

  try {
    // Fail fast on a missing or unusable token file rather than warning once
    // per interval forever.
    await readToken(config.tokenFile);
    store = openStore(config.databaseFile);
    log.info(
      cycles === Infinity
        ? `polling every ${Math.round(config.intervalMs / 60000)} min — Ctrl-C to stop`
        : `${cycles} cycle(s), ${Math.round(config.intervalMs / 1000)} s apart`,
    );

    let known = null;
    for (let done = 1; ; done += 1) {
      try {
        known = await cycle(config, { store, signal: stopping.signal, known });
      } catch (error) {
        if (error instanceof TokenChainBroken) throw error;
        // Anything else — a network blip, a 500, a rate limit — is transient by
        // assumption. Log it and let the next cycle try again; the backfill
        // closes whatever the outage missed, so it must not stop the poller.
        log.warn(`cycle failed, retrying next interval: ${error.message}`);
      }
      if (done >= cycles || stop) break;
      await sleep(config.intervalMs, stopping.signal);
      if (stop) break;
    }
  } finally {
    store?.close();
    await release();
  }
}

// Only run the loop when started as a program; importing this module for a
// test must not start polling.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log.error(error.message);
    process.exitCode = 1;
  });
}
