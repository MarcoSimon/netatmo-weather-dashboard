/**
 * When the wall steps down for the evening and the night.
 *
 * A bright dashboard in a dark living room at 23:00 is unusable, and the page
 * cannot reach the backlight: a tablet's IPS LCD shines through a black page
 * as a grey rectangle. What the page can do is light fewer pixels, less
 * brightly, and show less. The backlight itself is the kiosk browser's half,
 * switched off on a schedule (see `keepDark()` in `app.js`).
 *
 * **Two steps, on two different anchors**, because two different things set
 * them off:
 *
 * - **Evening, a quarter of an hour before sunset.** The daylight going is what
 *   darkens the room, and it wanders from 16:20 to 21:35 over the year — which
 *   is why a fixed hour is wrong here and right below. The default offset is
 *   negative, for a tablet in a room with little daylight of its own: it is
 *   dim all day and dark well before the sky is, unless someone switches the
 *   light on. Waiting until *after* sunset, as dusk outdoors suggests, suits
 *   a room with windows to the west instead. The sunset comes from the
 *   forecast the page already fetches every ten minutes, so this costs
 *   nothing on the wire.
 * - **Night at 22:00, and day again at 06:00.** Going to bed and getting up are
 *   habits on a clock, not astronomy. In December the sun sets at 16:20 and
 *   nobody wants the wall asleep at teatime; in June it sets at 21:35 and the
 *   lamps have long been on. Night wins over the evening, so a sunset later
 *   than 22:00 simply leaves no evening.
 *
 * Without a forecast — no coordinates, a dead fetch, or one dropped as too old
 * — the evening starts at a fixed time instead of never, **one per half of the
 * year**: a single hour is far off at one end or the other, with sunset
 * at 21:42 in June and 16:32 in December.
 *
 * **Every number here is an install-time setting**: the values below are the
 * defaults, and `.env` overrides them through the server
 * (`src/config.js`, served at `/api/settings`), so another house with other
 * habits changes a line of configuration, not this file. The functions take
 * the settings as an argument and fall back to these.
 *
 * Local time throughout, like `night.js`: a DST day is then one hour shorter or
 * longer and needs no case of its own. The zone is the tablet's own. Pure, so
 * it is unit-tested from `src/evening.test.js`.
 */
export const EVENING = {
  /**
   * How long after sunset the room is dark enough — negative, because a room
   * with little daylight gets there before the sky does.
   */
  sunsetOffsetMin: -15,
  /**
   * The evening's start when no sunset is known, in minutes after local
   * midnight, per half of the year. Computed from a year of Open-Meteo sunsets
   * in Central Europe, minus the offset above: summer time averages 20:22 and
   * winter time 17:06. These two are rounded to something easy to remember, and land within a minute of the
   * optimum either way — mean error 46 and 37 minutes.
   *
   * **Rounded towards early**, because the two errors do not weigh the same:
   * too early is a dimmed but complete page in daylight, too late is the
   * bright day rendering in a dark room, which is what this whole mode exists
   * to prevent. Only reached when Open-Meteo has been gone for six
   * hours, so it is a rare state to begin with.
   */
  fallbackAt: { summer: 20 * 60 + 30, winter: 17 * 60 },
  /**
   * Bedtime and getting up, the two anchors the sun has no say in, in minutes
   * after local midnight. A night may also begin after midnight; the evening
   * then runs across it.
   */
  nightFrom: 22 * 60,
  dayFrom: 6 * 60,
};

/** Unix seconds of local midnight of `base`'s day. */
const localMidnight = (base) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime() / 1000;

/** The same, given minutes after local midnight. */
const localMinute = (base, minutes) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, minutes).getTime() / 1000;

/**
 * Whether summer time is running, asked of the zone itself rather than of a
 * date range: the offset is further from UTC than the same year's winter one.
 * A zone without summer time has one offset all year and always counts as
 * winter, which is the right half for a place that never moves its clocks.
 */
function summerTime(date) {
  const winter = Math.max(
    new Date(date.getFullYear(), 0, 1).getTimezoneOffset(),
    new Date(date.getFullYear(), 6, 1).getTimezoneOffset(),
  );
  return date.getTimezoneOffset() < winter;
}

/**
 * Today's sunset from the forecast's daily rows, whose `time_utc` is local
 * midnight — or null when today is not among them or Open-Meteo left it out.
 */
function sunsetOf(forecast, now) {
  const today = forecast?.daily?.find((day) => day.time_utc === localMidnight(now));
  return typeof today?.sunset_utc === 'number' ? today.sunset_utc : null;
}

/** When the evening starts today: sunset plus the offset, or the season's fallback. */
export function eveningStart(nowUtc, forecast, settings = EVENING) {
  const now = new Date(nowUtc * 1000);
  const sunset = sunsetOf(forecast, now);
  if (sunset !== null) return sunset + settings.sunsetOffsetMin * 60;
  return localMinute(now, settings.fallbackAt[summerTime(now) ? 'summer' : 'winter']);
}

/**
 * Whether `minute` (after local midnight) is in the night. A night that starts
 * before midnight wraps around it; one that starts after midnight does not.
 */
function inNight(minute, { nightFrom, dayFrom }) {
  return nightFrom > dayFrom
    ? minute >= nightFrom || minute < dayFrom
    : minute >= nightFrom && minute < dayFrom;
}

/** What the page shows at `nowUtc`: `'day'`, `'evening'` or `'night'`. */
export function displayMode(nowUtc, forecast, settings = EVENING) {
  const now = new Date(nowUtc * 1000);
  const minute = now.getHours() * 60 + now.getMinutes();
  if (inNight(minute, settings)) return 'night';
  // Past midnight and not yet night: still yesterday's evening, which only
  // happens when the night begins after midnight.
  if (minute < settings.dayFrom) return 'evening';
  return nowUtc >= eveningStart(nowUtc, forecast, settings) ? 'evening' : 'day';
}
