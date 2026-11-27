import { DatabaseSync } from 'node:sqlite';
import { COLUMNS } from './measure.js';
import { CONTEXT_S, dropImplausible, isPlausible } from './plausible.js';
import { SCHEMA_VERSION } from './store.js';

/**
 * The HTTP server's view of the database: read-only, and never the one that
 * creates or migrates it. The poller is the only writer. A server that opened
 * the file through `openStore()` would create the schema if it started first —
 * a second writer through the back door.
 *
 * WAL mode (set by the poller) lets this connection read while the poller
 * writes, and every query sees the newest committed page. A read-only
 * connection still has to create `-wal` and `-shm` next to the database, so
 * the server needs write access to the directory, not to the file.
 */
export function openReader(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new Error(`cannot open ${path} (${error.message}) — has the poller run yet?`);
  }
  // Readers rarely wait in WAL mode, but a checkpoint can briefly hold them
  // up; wait as long as the poller would rather than failing the request.
  db.exec('PRAGMA busy_timeout = 5000');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`database schema v${version} does not match this code (v${SCHEMA_VERSION})`);
  }

  const listModules = db.prepare('SELECT id, type, name FROM modules ORDER BY id');
  const findModule = db.prepare('SELECT id, type, name FROM modules WHERE id = ?');
  const newestSample = db.prepare(`
    SELECT time_utc, ${COLUMNS.join(', ')} FROM samples
    WHERE module_id = ? ORDER BY time_utc DESC LIMIT 1
  `);
  const newestStatus = db.prepare(`
    SELECT time_utc, reachable, battery_percent, rf_status, wifi_status FROM module_status
    WHERE module_id = ? ORDER BY time_utc DESC LIMIT 1
  `);
  const co2Values = db.prepare(`
    SELECT co2 FROM samples
    WHERE module_id = ? AND time_utc > ? AND time_utc <= ? AND co2 IS NOT NULL
    ORDER BY co2
  `);
  const range = db.prepare(`
    SELECT time_utc, ${COLUMNS.join(', ')} FROM samples
    WHERE module_id = ? AND time_utc >= ? AND time_utc <= ?
    ORDER BY time_utc
  `);

  return {
    /**
     * Every module with its newest point and its newest status from
     * `getstationsdata`, each null before the first.
     */
    modules() {
      return listModules.all().map((module) => ({
        ...toModule(module),
        latest: toLatest(newestSample.get(module.id)),
        status: toStatus(newestStatus.get(module.id)),
      }));
    },

    /**
     * One module's points in [fromUtc, toUtc] without faulty values, or null
     * for an unknown module. The spike test needs neighbours on both sides, so
     * the query reaches beyond the window and the extra points are cut after.
     *
     * `co2_baseline` is what the room's sensor reads for outside air — the
     * page's window guess needs it and has only a day of points.
     */
    series(moduleId, fromUtc, toUtc) {
      const module = findModule.get(moduleId);
      if (!module) return null;
      const rows = dropImplausible(range.all(moduleId, fromUtc - CONTEXT_S, toUtc + CONTEXT_S), COLUMNS)
        .filter((row) => row.time_utc >= fromUtc && row.time_utc <= toUtc);
      const baseline = co2Baseline(co2Values.all(moduleId, toUtc - BASELINE_S, toUtc).map((row) => row.co2));
      return { ...toModule(module), ...toSeries(rows), co2_baseline: baseline };
    },

    close() {
      db.close();
    },
  };
}

const toModule = ({ id, type, name }) => ({ id, type, name });

/** The span a CO₂ baseline is taken from. */
export const BASELINE_S = 7 * 24 * 3600;

/** Fewer values than this (about a day and a half) give no baseline. */
const BASELINE_MIN_VALUES = 500;

/**
 * Sorted CO₂ values → what the sensor reads for outside air, or null. Netatmo
 * calibrates its sensors itself, so this is not simply 420 ppm: this house's
 * rooms read between 370 and 520 at their lowest, depending on the week.
 * The 2nd percentile of a week is where an aired room ends up, and it ignores
 * the rare reading below that. Faulty values do not matter here — they are
 * spikes upwards or the 5,000 ppm ceiling.
 */
export function co2Baseline(sorted) {
  if (sorted.length < BASELINE_MIN_VALUES) return null;
  return sorted[Math.floor(sorted.length * 0.02)];
}

/**
 * A `samples` row carries a column for every quantity any module can measure,
 * and all but the module's own are null. Only the measured ones go out.
 *
 * This also drops a value that is null for a single point, such as CO₂ while
 * the sensor calibrates, and a value outside its bounds. For a tile that is
 * the honest answer: there is no current value. The spike test cannot judge
 * the newest point — it has no neighbours after it yet.
 */
export function toLatest(row) {
  if (!row) return null;
  const values = {};
  for (const column of COLUMNS) {
    if (row[column] !== null && isPlausible(column, row[column])) values[column] = row[column];
  }
  return { time_utc: row.time_utc, values };
}

/**
 * A `module_status` row → what the page judges: whether the station reaches
 * the module, its battery and its signal. Each value is null where the module
 * has none — the base unit has no battery and no radio, the add-on modules no
 * Wi-Fi. The status is only as new as the last successful `getstationsdata`,
 * so it carries its own time.
 */
export function toStatus(row) {
  if (!row) return null;
  return {
    time_utc: row.time_utc,
    reachable: row.reachable === 1,
    battery_percent: row.battery_percent,
    rf_status: row.rf_status,
    wifi_status: row.wifi_status,
  };
}

/**
 * Rows → a series with a fixed set of columns: every quantity that has at
 * least one value in the window. Within those, a single missing value stays
 * null, so a chart can break its line there instead of bridging the gap.
 */
export function toSeries(rows) {
  const columns = COLUMNS.filter((column) => rows.some((row) => row[column] !== null));
  const samples = rows.map((row) => {
    const sample = { time_utc: row.time_utc };
    for (const column of columns) sample[column] = row[column];
    return sample;
  });
  return { columns, samples };
}
