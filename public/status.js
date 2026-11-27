/**
 * "Is something wrong with the station?": a module's status from
 * `getstationsdata` → a short German hint for its tile, or none. Pure, so it is
 * unit-tested from `src/status.test.js`.
 *
 * The hints stay quiet on purpose. On an ordinary day there is none, and the
 * tile's age already says when values are late. A hint adds what the age
 * cannot: *why* they are late, or that a battery is running out before
 * anything is late at all.
 *
 * Netatmo's levels, as its API documentation lists them: a radio signal
 * (`rf_status`) of 90 or more is low, 80 medium, 70 high, 60 highest; a
 * Wi-Fi signal (`wifi_status`) of 86 or more is bad, 71 average, 56 good.
 * Lower numbers are stronger signals. The battery is judged by
 * `battery_percent`, which the documentation recommends over the legacy
 * voltage `battery_vp`.
 */
export const STATUS = {
  /**
   * At or below this, the battery gets a hint. A guess, not a measurement:
   * no battery had run down while the status was being recorded (the
   * lowest were 82 % and 100 %). It should leave weeks to buy
   * batteries; revisit it when the first one actually runs low.
   */
  batteryLow: 20,
  /** Netatmo's "low" radio signal. */
  rfWeak: 90,
  /** Netatmo's "bad" Wi-Fi signal. */
  wifiWeak: 86,
};

/**
 * A module with `latest` and `status` from the API, and whether its tile is
 * stale → one hint, or null when nothing is wrong. One at most, so the age
 * and its hint never take more than two lines; when several apply, the cause
 * wins over the symptom:
 *
 * 1. **Battery low**, whether or not values are late. A flat battery is also
 *    the usual reason a module drops out, so it outranks the lost contact.
 * 2. **Out of reach:** the station has lost the add-on module. Only while no
 *    point has arrived since that status — a module that reconnected keeps
 *    delivering through `getmeasure` even while `getstationsdata` fails and
 *    the status cannot catch up.
 * 3. **Weak signal**, only on a stale tile. One indoor module's radio ranged
 *    from 67 to 87 in its first four days, so a single weak reading on a working module
 *    is noise; it matters as the explanation of values that stopped arriving.
 */
export function statusHint(module, stale) {
  const status = module.status;
  if (!status) return null;
  if (typeof status.battery_percent === 'number' && status.battery_percent <= STATUS.batteryLow) {
    return `Batterie ${status.battery_percent}\u00a0%`;
  }
  const lost = module.type !== 'base'
    && status.reachable === false
    && (!module.latest || status.time_utc >= module.latest.time_utc);
  if (lost) return 'kein Funkkontakt';
  if (!stale) return null;
  if (typeof status.rf_status === 'number' && status.rf_status >= STATUS.rfWeak) return 'Funk schwach';
  if (typeof status.wifi_status === 'number' && status.wifi_status >= STATUS.wifiWeak) return 'WLAN schwach';
  return null;
}
