import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { COLUMNS } from './measure.js';

/**
 * The SQLite file: every point the station ever delivered, at full resolution,
 * plus a status snapshot per module and cycle. Timestamps are unix seconds in
 * UTC, exactly as Netatmo returns them; local time is the UI's business.
 *
 * `samples` is wide on purpose — one row per `getmeasure` point, one nullable
 * column per quantity. The set of quantities is fixed by the hardware, new
 * modules add rows rather than columns, and temperature and humidity of the
 * same instant (which the airing calculation needs) stay in one row.
 */

export const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE modules (
    id             INTEGER PRIMARY KEY,
    netatmo_id     TEXT    NOT NULL UNIQUE,
    device_id      TEXT    NOT NULL,
    type           TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    first_seen_utc INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE samples (
    module_id     INTEGER NOT NULL REFERENCES modules (id),
    time_utc      INTEGER NOT NULL,
    temperature   REAL,
    humidity      REAL,
    co2           REAL,
    pressure      REAL,
    noise         REAL,
    rain          REAL,
    wind_strength REAL,
    wind_angle    REAL,
    gust_strength REAL,
    gust_angle    REAL,
    PRIMARY KEY (module_id, time_utc)
  ) STRICT, WITHOUT ROWID;

  -- getmeasure cannot deliver these after the fact, so they exist only for
  -- the time the poller was running.
  CREATE TABLE module_status (
    module_id       INTEGER NOT NULL REFERENCES modules (id),
    time_utc        INTEGER NOT NULL,
    reachable       INTEGER NOT NULL,
    battery_percent INTEGER,
    battery_vp      INTEGER,
    rf_status       INTEGER,
    wifi_status     INTEGER,
    firmware        INTEGER,
    PRIMARY KEY (module_id, time_utc)
  ) STRICT, WITHOUT ROWID;
`;

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version === SCHEMA_VERSION) return;
  if (version > SCHEMA_VERSION) {
    throw new Error(`database schema v${version} is newer than this code (v${SCHEMA_VERSION})`);
  }
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function transaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Opens (and on first use creates) the database. `:memory:` works for tests. */
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL lets the HTTP server (phase 2) read while the poller writes. A power
  // cut can cost the last committed page, which the next backfill re-fetches.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);

  const upsertModule = db.prepare(`
    INSERT INTO modules (netatmo_id, device_id, type, name, first_seen_utc)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (netatmo_id) DO UPDATE
      SET device_id = excluded.device_id, type = excluded.type, name = excluded.name
    RETURNING id
  `);
  const lastSample = db.prepare('SELECT max(time_utc) AS t FROM samples WHERE module_id = ?');
  const insertStatus = db.prepare(`
    INSERT INTO module_status
      (module_id, time_utc, reachable, battery_percent, battery_vp, rf_status, wifi_status, firmware)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);
  const sampleInserts = new Map();

  function sampleInsert(columns) {
    const key = columns.join(',');
    if (!sampleInserts.has(key)) {
      for (const column of columns) {
        // Column names are interpolated, so only our own may get this far.
        if (!COLUMNS.includes(column)) throw new Error(`unknown sample column "${column}"`);
      }
      sampleInserts.set(
        key,
        db.prepare(
          `INSERT INTO samples (module_id, time_utc, ${key})
           VALUES (?, ?, ${columns.map(() => '?').join(', ')})
           ON CONFLICT DO NOTHING`,
        ),
      );
    }
    return sampleInserts.get(key);
  }

  return {
    /** Inserts or renames a module; returns its row id. */
    upsertModule(module, nowUtc) {
      return upsertModule.get(module.id, module.deviceId, module.type, module.name, nowUtc).id;
    },

    /** Newest stored point of a module, or null if there is none yet. */
    lastSampleTime(moduleId) {
      return lastSample.get(moduleId).t;
    },

    /**
     * One page in one transaction: a crash loses the page in flight, never
     * half of it, and the next backfill resumes after the last committed one.
     * Points already stored are skipped. Returns how many were new.
     */
    insertSamples(moduleId, columns, rows) {
      const insert = sampleInsert(columns);
      return transaction(db, () => {
        let added = 0;
        for (const { timeUtc, values } of rows) {
          added += Number(insert.run(moduleId, timeUtc, ...values).changes);
        }
        return added;
      });
    },

    insertStatus(moduleId, timeUtc, module) {
      insertStatus.run(
        moduleId,
        timeUtc,
        module.reachable ? 1 : 0,
        module.batteryPercent,
        module.batteryVp,
        module.rfStatus,
        module.wifiStatus,
        module.firmware,
      );
    },

    /** For tests and ad-hoc checks. */
    db,

    close() {
      db.close();
    },
  };
}
