/**
 * "Is the wall itself about to go flat?": the tablet's own charger and battery,
 * as the kiosk browser reports them → a German line for the status bar, or
 * none. Pure, so it is unit-tested from `src/power.test.js`.
 *
 * A tablet that runs flat does not come back by itself: most Android tablets
 * wait at their charging screen for the power button once power returns. The
 * realistic way there is a plug pulled by accident — the battery carries the
 * wall for hours and nothing looks wrong until it is dark — so the line has to
 * come while there are still hours left.
 */
export const POWER = {
  /**
   * At or below this, off power, the line shows. Not "off power" alone: a
   * tablet whose charging is cycled through a switched socket spends much of
   * the day off power on purpose, from 75 % down to about 43 % by day. 40 %
   * sits just below that and still leaves five to six hours at the measured
   * daytime drain of 5–7 %/h. How close that is to the band is still open.
   */
  levelLow: 40,
};

/**
 * `{ plugged, level }` from the kiosk browser, or null when there is none →
 * the line, or null. Anything that is not a boolean and a number gives null:
 * a reading the page cannot trust is not worth a warning on the wall.
 */
export function powerHint(power) {
  if (!power || typeof power.plugged !== 'boolean' || !Number.isFinite(power.level)) return null;
  if (power.plugged || power.level > POWER.levelLow) return null;
  return `Tablet hängt nicht am Strom – Akku ${Math.round(power.level)} %`;
}
