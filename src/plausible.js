/**
 * Faulty points, dropped on the way out. The database keeps every point as
 * Netatmo delivered it — *store everything* — and the server decides what is
 * fit to show. A dropped value becomes null, so a chart breaks its line there;
 * nothing is ever replaced by an estimate. Pure, so it is unit-tested from
 * `src/plausible.test.js`.
 *
 * Two kinds of fault turned up in a real station's history: spikes of one to
 * three points — a base unit that fell over reported CO₂ above 4,000 ppm —
 * and one plateau of seven hours at 782 hPa. A spike is caught by comparing a
 * point with its neighbours; the plateau is its own neighbourhood and only
 * caught by a bound.
 *
 * Neither catches the tail of a jump that decays slowly. One room's sensor
 * went from 1,100 to 5,000 ppm and took half an hour back down
 * through 4,983, 3,849, 2,737 and 2,249; only the 5,000 is dropped. A point
 * was missing just before the jump, which leaves too few low neighbours for
 * even the 4,983 to stand out, and the tail looks like any real event. That
 * is a case for a hand-kept exclusion list.
 */

/**
 * Values outside these bounds are not measurements. Temperature and humidity
 * follow the modules' specified ranges (indoor 0–50 °C, outdoor −40–65 °C,
 * one bound for both). CO₂ tops out at 5,000 ppm, and a sensor at its ceiling
 * reports the ceiling, not the air, so 5,000 itself is dropped. Pressure is
 * the sea-level value, which Central European weather keeps well away from
 * both bounds; this station's history lies between 974 and 1,043 hPa apart
 * from the fault.
 */
export const BOUNDS = {
  temperature: { min: -40, max: 65 },
  humidity: { min: 0, max: 100 },
  co2: { min: 0, max: 4999 },
  pressure: { min: 940, max: 1060 },
};

/**
 * The spike test (a Hampel filter): a point is dropped when it lies further
 * from the median of its neighbourhood than `k` scaled median absolute
 * deviations — and at least the floor, so a quiet neighbourhood, where the
 * deviation is 0, does not turn every 0.1 °C step into a spike. The floors
 * sit above what weather and airing do within half an hour: over the full
 * history of three modules they drop 10 spikes in one room, none in the
 * other and two single humidity points outside, probably showers.
 *
 * Rain and wind are left alone: they are spiky by nature.
 */
export const SPIKE = {
  windowS: 30 * 60,
  k: 5,
  /**
   * The neighbourhood takes as many points on each side as the sparser side
   * has within the window — at least this many, or the point is not judged.
   */
  minSide: 3,
  floors: { temperature: 1.5, humidity: 8, co2: 400, pressure: 2 },
};

/** How far beyond a window the reader has to look to judge the window's edges. */
export const CONTEXT_S = SPIKE.windowS;

/** Scales the median absolute deviation to a standard deviation for normal data. */
const MAD_SCALE = 1.4826;

export function isPlausible(column, value) {
  const bounds = BOUNDS[column];
  return !bounds || (value >= bounds.min && value <= bounds.max);
}

const median = (sorted) => sorted[Math.floor(sorted.length / 2)];

/**
 * Points (ascending by time, no nulls) → the set of indexes that are spikes.
 * Each point is judged against the raw values around it, not against an
 * already cleaned series, so the result does not depend on the order.
 *
 * The neighbourhood is symmetric in points, not only in time. The station
 * sometimes adds points a minute apart; with more of them on one side of a
 * real step — CO₂ falling as a window opens — the median would sit on that
 * side and the first point past the step would look like a spike — which
 * happened on a real airing. With as many points on each side, the median of a
 * step lies on the step.
 *
 * The newest points have no neighbours after them yet and are not judged:
 * a fresh spike can stand for 15 minutes before the next points reveal it.
 */
export function spikes(points, floor) {
  const found = new Set();
  let from = 0;
  let to = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    while (points[from].t < t - SPIKE.windowS) from++;
    while (to + 1 < points.length && points[to + 1].t <= t + SPIKE.windowS) to++;
    const side = Math.min(i - from, to - i);
    if (side < SPIKE.minSide) continue;
    const values = points.slice(i - side, i + side + 1).map((p) => p.v).sort((a, b) => a - b);
    const middle = median(values);
    const mad = median(values.map((v) => Math.abs(v - middle)).sort((a, b) => a - b));
    if (Math.abs(points[i].v - middle) > Math.max(SPIKE.k * MAD_SCALE * mad, floor)) found.add(i);
  }
  return found;
}

/**
 * Rows (ascending by time, one column per quantity) → copies with every
 * faulty value set to null. Out-of-bounds values go first, so they cannot
 * skew the neighbourhood of the spike test.
 */
export function dropImplausible(rows, columns) {
  const clean = rows.map((row) => {
    const copy = { ...row };
    for (const column of columns) {
      if (copy[column] !== null && !isPlausible(column, copy[column])) copy[column] = null;
    }
    return copy;
  });
  for (const column of columns) {
    const floor = SPIKE.floors[column];
    if (floor === undefined) continue;
    const indexes = [];
    const points = [];
    clean.forEach((row, index) => {
      if (row[column] === null) return;
      indexes.push(index);
      points.push({ t: row.time_utc, v: row[column] });
    });
    for (const i of spikes(points, floor)) clean[indexes[i]][column] = null;
  }
  return clean;
}
