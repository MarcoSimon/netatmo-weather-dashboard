/**
 * The pressure tendency: is the air pressure rising or falling, and how fast.
 * Pure, so it is unit-tested from `src/pressure.test.js`.
 *
 * Meteorology measures the tendency over three hours. The thresholds come
 * from four years of a real station's history (409,829 three-hour
 * differences): median 0.7 hPa, p90 1.9, p99 3.8.
 */

/** The meteorological convention for pressure tendency. */
export const TENDENCY_S = 3 * 3600;

/** How far the reference point may lie from exactly three hours earlier. */
export const MATCH_S = 10 * 60;

/**
 * Below this, the pressure counts as steady. The atmospheric tide alone moves
 * it by up to about 0.7 hPa in three hours at this latitude, and the sensor
 * steps in 0.1 hPa — the Met Office's "steady" band of < 0.1 hPa would
 * almost never show here. Steady for 63 % of the history.
 */
export const STEADY_BELOW = 1;

/** From here on, rising or falling quickly — where the Met Office's "quickly" starts. 1.5 % of the history. */
export const QUICK_FROM = 3.5;

/**
 * More than this in three hours is a sensor fault, not weather: the history
 * holds a seven-hour stretch at 782 hPa.
 */
export const IMPLAUSIBLE_ABOVE = 15;

/**
 * Samples (ascending by time) → the tendency at the newest pressure point:
 * `delta` in hPa, `level` from −2 (falling quickly) through 0 (steady) to 2
 * (rising quickly), and `atUtc`, the newest point's time. Null when there is
 * no newest point, no point near three hours earlier, or an implausible jump.
 */
export function pressureTendency(samples) {
  const withPressure = samples.filter((sample) => typeof sample.pressure === 'number');
  const newest = withPressure.at(-1);
  if (!newest) return null;
  const target = newest.time_utc - TENDENCY_S;
  let reference = null;
  for (const sample of withPressure) {
    const distance = Math.abs(sample.time_utc - target);
    if (distance <= MATCH_S && (!reference || distance < Math.abs(reference.time_utc - target))) {
      reference = sample;
    }
  }
  if (!reference) return null;
  // Rounded to the sensor's resolution, so 1013.4 − 1012.4 is exactly 1.
  const delta = Math.round((newest.pressure - reference.pressure) * 10) / 10;
  const size = Math.abs(delta);
  if (size > IMPLAUSIBLE_ABOVE) return null;
  const level = size < STEADY_BELOW ? 0 : size < QUICK_FROM ? 1 : 2;
  // `-0` for a slightly falling steady tendency would compare unequal to 0.
  return { delta, level: delta < 0 && level ? -level : level, atUtc: newest.time_utc };
}
