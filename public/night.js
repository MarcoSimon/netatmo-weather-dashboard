/**
 * "How cold was it last night", on the outdoor tile in the morning.
 *
 * The 24-hour low does not answer it: the outdoor low comes around sunrise,
 * and at 07:00 the 24-hour window still reaches back to yesterday's sunrise.
 * Over the history, the 24-hour low read at 07:00 was off the night's by at
 * least 1 °C on 32 % of days, because it was yesterday morning's. A night from
 * 18:00 to 09:00 holds the true low on 92 % of days.
 *
 * Local time throughout: "night" and "morning" are what people mean,
 * so a DST night is simply one hour shorter or longer.
 */
export const NIGHT = {
  /** The morning in which the tile shows the night instead of the last 24 hours. */
  showFrom: 5,
  /** The night itself: from this hour the evening before until this hour. */
  startsAt: 18,
  endsAt: 9,
  /** After the night ends, the low stays until it is this many seconds old. */
  lingerS: 3600,
};

/**
 * The night to show at `nowUtc` as `{ fromUtc, toUtc, endsUtc }`, or null
 * outside the morning. Before 09:00 the night is still running and ends now.
 * The morning lasts until the latest moment the low can still show, an hour
 * past the night's end; `nightLowShows` decides within it.
 */
export function nightWindow(nowUtc) {
  const now = new Date(nowUtc * 1000);
  const [year, month, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const morningUtc = new Date(year, month, day, NIGHT.showFrom).getTime() / 1000;
  const endsUtc = new Date(year, month, day, NIGHT.endsAt).getTime() / 1000;
  if (nowUtc < morningUtc || nowUtc >= endsUtc + NIGHT.lingerS) return null;
  const fromUtc = new Date(year, month, day - 1, NIGHT.startsAt).getTime() / 1000;
  return { fromUtc, toUtc: Math.min(nowUtc, endsUtc), endsUtc };
}

/**
 * Whether the night's low, reached at `lowAtUtc`, still shows at `nowUtc`:
 * until 09:00, and at least an hour after the low. A low at 08:40 is news at
 * 09:00 too. Nothing ends before 09:00, because until then the night is still
 * running and a colder point would bring the line back; from 09:00 the low
 * is fixed, so the line leaves once and for the day.
 */
export const nightLowShows = (night, lowAtUtc, nowUtc) =>
  nowUtc < Math.max(night.endsUtc, lowAtUtc + NIGHT.lingerS);

/** "6:40": the local time of the night's low, as anyone reads a clock. */
export const clockTime = (utc) =>
  new Date(utc * 1000).toLocaleTimeString('de-DE', { hour: 'numeric', minute: '2-digit' });
