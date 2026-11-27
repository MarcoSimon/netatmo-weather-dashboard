/**
 * Pure logic around `getmeasure`, the one source of stored series.
 *
 * `getstationsdata` only carries the newest point of each module, and a
 * 10-minute poll of it sees every other one of the ~5-minute points the
 * station produces. `getmeasure` delivers all of them, and the newest one is
 * identical to `dashboard_data` (measured against a real station), so the series are
 * read from here alone.
 */

/** `getmeasure` never returns more than this many points per request. */
export const PAGE_LIMIT = 1024;

/**
 * Netatmo's `data_type` (from getstationsdata) → the `getmeasure` types that
 * deliver it, and the `samples` column each lands in.
 *
 * The indoor and outdoor entries are measured against the real station. Rain
 * and wind follow Netatmo's documentation and are unverified until those
 * sensors exist — which matters, because `getmeasure` answers a misspelt type
 * with an empty body rather than an error.
 */
const SERIES = {
  Temperature: [{ type: 'temperature', column: 'temperature' }],
  Humidity: [{ type: 'humidity', column: 'humidity' }],
  CO2: [{ type: 'co2', column: 'co2' }],
  Pressure: [{ type: 'pressure', column: 'pressure' }],
  Noise: [{ type: 'noise', column: 'noise' }],
  Rain: [{ type: 'rain', column: 'rain' }],
  Wind: [
    { type: 'windstrength', column: 'wind_strength' },
    { type: 'windangle', column: 'wind_angle' },
    { type: 'guststrength', column: 'gust_strength' },
    { type: 'gustangle', column: 'gust_angle' },
  ],
};

/** Every column a series can land in — the shape of the `samples` table. */
export const COLUMNS = Object.values(SERIES).flat().map((s) => s.column);

/**
 * The series a module can deliver, in a fixed order. Unknown data types are
 * skipped: requesting them would not fail, it would silently empty the page.
 */
export function seriesFor(dataTypes = []) {
  return dataTypes.flatMap((dataType) => SERIES[dataType] ?? []);
}

/**
 * A `getmeasure` body (requested with `optimize=false`) → rows sorted by time.
 * Values arrive in the order the types were requested; single values can be
 * `null` (CO₂ during calibration) and stay `null`.
 *
 * An empty range comes back as `[]` rather than `{}`, so both mean "no rows".
 */
export function parseMeasure(body, series) {
  const points = body?.body;
  if (Array.isArray(points)) {
    if (points.length === 0) return [];
    throw new Error('getmeasure returned the optimized format — request it with optimize=false');
  }
  if (!points || typeof points !== 'object') {
    throw new Error('getmeasure response has no body');
  }
  return Object.entries(points)
    .map(([time, values]) => {
      if (!Array.isArray(values) || values.length !== series.length) {
        throw new Error(`getmeasure point ${time} has ${values?.length} values for ${series.length} types`);
      }
      return { timeUtc: Number(time), values };
    })
    .sort((a, b) => a.timeUtc - b.timeUtc);
}
