/**
 * The Open-Meteo forecast as the outdoor tile shows it: a "Vorhersage"
 * label beside the name, and behind a tap, in the curve's place for half a
 * minute, the answers to the household's questions. Pure, so it is
 * unit-tested from `src/forecast.test.js`.
 *
 * - "Wie warm wird es heute noch?" — the rest of the day's high, until the
 *   evening, and the coming night's low.
 * - "Regnet es in den nächsten Stunden?" — when rain becomes likely within
 *   the next twelve hours, or that it stays dry.
 * - "Wie wird morgen?" — tomorrow's low and high, and its rain, from the
 *   evening on.
 * - "Lohnt sich der Nachmittag noch?" — the sunshine the day has left, and in
 *   the evening view tomorrow's whole day.
 * - "Wie viel Regen?" — the amount below the chance, in l/m².
 *
 * The view turns at 18:00: by day "today" and no "tomorrow", in the evening
 * the other way round. A morning that showed the next day and the rest of a
 * night already over answered nothing anyone asks after getting up.
 * - Wind and the felt temperature only when they stand out; on an ordinary
 *   day they would be two more lines to read past.
 *
 * Local time throughout, as with the night low (`night.js`).
 */
import { formatNumber } from './format.js';
import { NIGHT } from './night.js';

export const FORECAST_VIEW = {
  /** From this hour on, "today" is mostly over and gives way to "tomorrow". */
  eveningFrom: 18,
  /** Until this hour the running night is the one to show; from it, the coming one. */
  nightTurnsAt: 5,
  /** How far ahead the rain row looks. */
  rainHours: 12,
  /** From this probability on, rain counts as coming; from `rainMaybe`, as possible. */
  rainLikely: 50,
  rainMaybe: 30,
  /** Gusts from this speed get a row (Beaufort 7, "steifer Wind"). */
  gustsFrom: 50,
  /** A felt temperature this far from the air temperature gets a row. */
  feltApart: 3,
  /**
   * Below this much sunshine left, the day has nothing to promise any more and
   * the row says so instead of rounding to "noch 0,0 h".
   */
  sunLeftH: 0.05,
  /** Below this, a chance of rain comes with no amount worth naming. */
  rainAmount: 0.05,
};

const degrees = (value) => `${formatNumber(value, 0)} °C`;
/** Rain as a rain gauge measures it: 1 mm on the ground is one litre per square metre. */
const litres = (mm) => `${formatNumber(mm, 1)} l/m²`;
const hours = (seconds) => `${formatNumber(seconds / 3600, 1)} h`;
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const hourOf = (utc) => new Date(utc * 1000).getHours();
const clock = (utc) => `${hourOf(utc)} Uhr`;
const localTime = (base, dayOffset, hour) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour).getTime() / 1000;
const numbers = (rows, key) => rows.map((row) => row[key]).filter((value) => typeof value === 'number');

/**
 * The forecast from `/api/forecast` and the time now → the label and its
 * reason, or undefined without a forecast or without hours ahead.
 */
export function forecastContent(forecast, nowUtc) {
  if (!forecast) return undefined;
  const hourStart = nowUtc - (nowUtc % 3600);
  const ahead = forecast.hourly.filter((hour) => hour.time_utc >= hourStart);
  if (ahead.length === 0) return undefined;
  const now = new Date(nowUtc * 1000);
  const rows = [];

  const evening = now.getHours() >= FORECAST_VIEW.eveningFrom;
  if (!evening) {
    const today = ahead.filter((hour) => hour.time_utc < localTime(now, 1, 0));
    const high = numbers(today, 'temperature');
    if (high.length > 0) rows.push(['Heute', `höchstens ${degrees(Math.max(...high))}`]);
    // What the day has left, like the row above it — the running hour counts
    // whole, which is the same rounding "Heute" already does.
    const sun = numbers(today, 'sunshine');
    if (sun.length > 0) {
      const left = total(sun);
      rows.push(['Sonne', left / 3600 < FORECAST_VIEW.sunLeftH ? 'heute vorbei' : `noch ${hours(left)}`]);
    }
  }

  // In the small hours the night is still running; from 05:00 on, the coming
  // one — its low has been measured by then, and the tile shows it.
  const running = now.getHours() < FORECAST_VIEW.nightTurnsAt;
  const nightFrom = running ? nowUtc : Math.max(nowUtc, localTime(now, 0, NIGHT.startsAt));
  const nightTo = localTime(now, running ? 0 : 1, NIGHT.endsAt);
  const night = numbers(ahead.filter((hour) => hour.time_utc + 3600 > nightFrom && hour.time_utc < nightTo), 'temperature');
  if (night.length > 0) rows.push(['Nacht', `tiefstens ${degrees(Math.min(...night))}`]);

  const rain = rainRow(ahead.slice(0, FORECAST_VIEW.rainHours));
  if (rain) {
    rows.push(['Regen', rain.says]);
    // Its own row: measured on the wall, "ab 15 Uhr · 75 % · 1,6 l/m²" breaks
    // into two lines in the tile, and so does every other one-line cut of it.
    if (rain.amount !== null) rows.push(['Menge', litres(rain.amount)]);
  }

  const tomorrow = evening && forecast.daily.find((day) => day.time_utc === localTime(now, 1, 0));
  if (tomorrow && typeof tomorrow.temperature_min === 'number' && typeof tomorrow.temperature_max === 'number') {
    const wet = tomorrow.precipitation_probability_max ?? 0;
    const range = `${formatNumber(tomorrow.temperature_min, 0)}–${degrees(tomorrow.temperature_max)}`;
    rows.push(['Morgen', range]);
    // A line of its own: beside the range it broke the line on the wall.
    if (wet >= FORECAST_VIEW.rainMaybe) {
      rows.push(['', `Regen ${wet} %`]);
      const mm = tomorrow.precipitation_sum ?? 0;
      if (mm >= FORECAST_VIEW.rainAmount) rows.push(['Menge', litres(mm)]);
    }
    if (typeof tomorrow.sunshine === 'number') rows.push(['Sonne', hours(tomorrow.sunshine)]);
  }

  const gusts = numbers(ahead.slice(0, FORECAST_VIEW.rainHours), 'wind_gusts');
  if (gusts.length > 0 && Math.max(...gusts) >= FORECAST_VIEW.gustsFrom) {
    rows.push(['Wind', `Böen bis ${formatNumber(Math.max(...gusts), 0)} km/h`]);
  }
  const current = ahead[0];
  if (typeof current.apparent_temperature === 'number' && typeof current.temperature === 'number'
    && Math.abs(current.apparent_temperature - current.temperature) >= FORECAST_VIEW.feltApart) {
    rows.push(['Gefühlt', degrees(current.apparent_temperature)]);
  }

  const fetched = new Date(forecast.fetched_utc * 1000)
    .toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return { label: 'Vorhersage', tone: 'forecast', rows, text: `Open-Meteo, ${fetched} Uhr` };
}

/**
 * The next hours, the current one first → `says` is "ab 15 Uhr · 60 %" from the
 * first hour rain is likely, else from the first it is possible ("jetzt" when
 * that is the current hour), or plain "trocken". The percentage is the peak
 * from then on and carries the doubt itself: a "vielleicht" in front broke the
 * line on the wall. **"trocken" names no hour**: it said "trocken bis 0 Uhr"
 * at the end of the window, which reads as a promise of rain at midnight even
 * when the next three days are dry. The row looks twelve hours ahead
 * either way; an open end is the truer answer. `amount` is the rain expected from that hour to the end of
 * the window, in millimetres, or null — a chance says nothing about
 * whether it is worth an umbrella, and a dry stretch has nothing to add.
 */
function rainRow(ahead) {
  if (ahead.length === 0) return undefined;
  const when = (hour) => (hour === ahead[0] ? 'jetzt' : `ab ${clock(hour.time_utc)}`);
  const chance = (hour) => hour.precipitation_probability ?? 0;
  const from = (hour) => ahead.slice(ahead.indexOf(hour));
  const row = (hour) => {
    const mm = total(numbers(from(hour), 'precipitation'));
    return {
      says: `${when(hour)} · ${Math.max(...from(hour).map(chance))} %`,
      amount: mm >= FORECAST_VIEW.rainAmount ? mm : null,
    };
  };
  const likely = ahead.find((hour) => chance(hour) >= FORECAST_VIEW.rainLikely);
  if (likely) return row(likely);
  const maybe = ahead.find((hour) => chance(hour) >= FORECAST_VIEW.rainMaybe);
  if (maybe) return row(maybe);
  return { says: 'trocken', amount: null };
}
