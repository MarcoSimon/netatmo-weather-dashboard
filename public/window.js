/**
 * Is a window open? A guess per room from its own series and the outdoor
 * temperature. Pure, so it is unit-tested from `src/window.test.js`.
 *
 * Two signals, both measured against real openings:
 *
 * - **CO₂ decays towards the outside level.** With the room's baseline B, the
 *   excess C − B falls exponentially, and the slope of ln(C − B) is the air
 *   change rate. A closed room stays well below 1 per hour; tilted windows
 *   with a draught reached 5–10. It says nothing once the excess is gone.
 * - **The room follows the outside temperature.** The temperature slope
 *   divided by the inside–outside difference is a cooling rate. A closed room
 *   exceeds 0.3 per hour in fewer than 1 % of the history; the open rooms
 *   reached 0.4–0.8 with the outside only 2.5 °C colder. It says nothing
 *   when inside and outside are about equal.
 *
 * Both rates come from a least-squares fit over 20 minutes: a single
 * five-minute step at a small CO₂ excess turns the sensor's noise into an
 * apparent opening.
 *
 * A window counts as open from the first sign until the room decouples from
 * the outside again — it warms although the outside does not, or it stops
 * cooling unusually fast — or until three hours have passed without anything
 * to go on.
 *
 * The temperature closes only an opening it saw. With the outside warmer than
 * the room, thick masonry walls can hold the air still while CO₂ shows several
 * air changes an hour — seen in a real opening: the room never followed the outside, so its
 * stillness says nothing about the window. Such an opening ends when CO₂
 * builds up again, well above the baseline — a window reported open too long
 * sends someone to check, one reported shut too early gets forgotten.
 */

export const WINDOW = {
  fitS: 20 * 60,
  minPoints: 4,
  /** Air changes per hour that only an open window produces. */
  co2Enter: 3,
  /** Below this excess over the baseline at the fit's start, CO₂ is not judged. */
  co2MinExcess: 100,
  /** Cooling rate per hour, relative to the inside–outside difference. */
  coolingEnter: 0.4,
  coolingLeave: 0.15,
  /** Cooling rate from which the temperature counts as having seen the opening. */
  coolingSeen: 0.25,
  /** CO₂ rising this fast, in ppm per hour, shows a room closed with people in it. */
  co2Rise: 150,
  /** …and only once it stands this far above the baseline again, in ppm. */
  co2Refilled: 75,
  /** Below this difference in °C, temperature is not judged. */
  minDifference: 1.5,
  /** How long the cooling has to stay below `coolingLeave` to count as closed. */
  quietS: 15 * 60,
  /** An opening with nothing to confirm it is dropped after this long. */
  maxOpenS: 3 * 3600,
  /** How far apart a room point and its outdoor point may lie. */
  pairS: 10 * 60,
};

/** Least-squares slope of `y` over time in hours. */
function slope(points, y) {
  const t0 = points.at(-1).time_utc;
  const xs = points.map((p) => (p.time_utc - t0) / 3600);
  const ys = points.map(y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx === 0 ? 0 : sxy / sxx;
}

/**
 * Air changes per hour from the CO₂ in `points`, or null when there is not
 * enough excess to judge.
 */
export function airChangeRate(points, baseline) {
  const measured = points.filter((p) => typeof p.co2 === 'number');
  if (typeof baseline !== 'number' || measured.length < WINDOW.minPoints) return null;
  if (measured[0].co2 - baseline < WINDOW.co2MinExcess) return null;
  // Near the baseline, the logarithm turns sensor noise into huge rates.
  if (measured.some((p) => p.co2 - baseline <= 5)) return null;
  return -slope(measured, (p) => Math.log(p.co2 - baseline));
}

/** How fast CO₂ rises in `points`, in ppm per hour, or null with too few points. */
export function co2Rise(points) {
  const measured = points.filter((p) => typeof p.co2 === 'number');
  if (measured.length < WINDOW.minPoints) return null;
  return slope(measured, (p) => p.co2);
}

/**
 * The cooling rate per hour relative to the inside–outside difference, or null
 * when the difference is too small or the points too few. Each point carries
 * `outside`, the paired outdoor temperature. Negative means the room warms
 * against the outside.
 */
export function coolingRate(points) {
  const paired = points.filter((p) => typeof p.temperature === 'number' && typeof p.outside === 'number');
  if (paired.length < WINDOW.minPoints) return null;
  const newest = paired.at(-1);
  const difference = newest.temperature - newest.outside;
  if (Math.abs(difference) < WINDOW.minDifference) return null;
  return -slope(paired, (p) => p.temperature) / difference;
}

/** Room points with the nearest outdoor temperature within `pairS`, as `outside`. */
export function withOutside(room, outdoor) {
  const outside = outdoor.filter((p) => typeof p.temperature === 'number');
  let j = 0;
  return room.map((point) => {
    while (j + 1 < outside.length && outside[j + 1].time_utc <= point.time_utc) j++;
    const nearest = [outside[j], outside[j + 1]]
      .filter((p) => p && Math.abs(p.time_utc - point.time_utc) <= WINDOW.pairS)
      .sort((a, b) => Math.abs(a.time_utc - point.time_utc) - Math.abs(b.time_utc - point.time_utc))[0];
    return { ...point, outside: nearest?.temperature ?? null };
  });
}

/**
 * A room's series, the outdoor series (both oldest first) and the room's CO₂
 * baseline → every opening the rule sees in them, as `{ since, until, why,
 * from }`. `until` is null for one still open; `why` is `co2` or `cooling`,
 * and `from` holds the room's CO₂ and temperature at the start of the fit
 * that raised it.
 */
export function windowEpisodes(room, outdoor, baseline) {
  const points = withOutside(room, outdoor);
  const episodes = [];
  let open = null;
  let quietSince = null;
  let seen = false;
  let start = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].time_utc;
    while (points[start].time_utc < t - WINDOW.fitS) start++;
    const fitted = points.slice(start, i + 1);
    const co2 = airChangeRate(fitted, baseline);
    const cooling = coolingRate(fitted);
    const byCo2 = co2 !== null && co2 >= WINDOW.co2Enter;
    const opening = byCo2 || (cooling !== null && cooling >= WINDOW.coolingEnter);

    if (!open) {
      if (opening) {
        const first = fitted[0];
        open = { since: t, until: null, why: byCo2 ? 'co2' : 'cooling', from: { co2: first.co2, temperature: first.temperature } };
        episodes.push(open);
        seen = cooling !== null && cooling >= WINDOW.coolingSeen;
        quietSince = null;
      }
      continue;
    }
    if (cooling !== null && cooling >= WINDOW.coolingSeen) seen = true;
    if (cooling !== null) quietSince = cooling < WINDOW.coolingLeave && !opening ? (quietSince ?? t) : null;
    const settled = t - open.since >= WINDOW.fitS;
    let closed;
    if (seen) {
      // Once the fit no longer reaches back to the opening, a warming room is closed.
      const warming = cooling !== null && cooling < 0 && settled;
      const quiet = quietSince !== null && t - quietSince >= WINDOW.quietS;
      closed = warming || quiet;
    } else {
      // The temperature never saw this opening — the walls held the air — so its
      // stillness says nothing about the window. Only CO₂ building up again does.
      const rise = co2Rise(fitted);
      const newest = points[i].co2;
      closed = settled && rise !== null && rise >= WINDOW.co2Rise
        && typeof baseline === 'number' && typeof newest === 'number' && newest - baseline >= WINDOW.co2Refilled;
    }
    if (closed || t - open.since >= WINDOW.maxOpenS) {
      open.until = t;
      open = null;
      quietSince = null;
    }
  }
  return episodes;
}

/**
 * The same inputs → the opening that is still open at the newest point, or
 * null. `atUtc` is the newest point's time, so the caller can drop a stale
 * guess; `now` holds the room's newest CO₂, temperature and outdoor
 * temperature for the reason.
 */
export function openWindow(room, outdoor, baseline) {
  const current = windowEpisodes(room, outdoor, baseline).at(-1);
  if (!current || current.until !== null) return null;
  const newest = withOutside(room.slice(-1), outdoor)[0];
  return {
    ...current,
    atUtc: newest.time_utc,
    now: { co2: newest.co2 ?? null, temperature: newest.temperature ?? null, outside: newest.outside },
  };
}
