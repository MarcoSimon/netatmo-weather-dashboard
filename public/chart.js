/**
 * The day's curve inside a tile, as pure functions: samples in, SVG path data
 * and labels out. Temperature by default; humidity, CO₂ or pressure for half a
 * minute after a tap on that value. No DOM, so it is unit-tested from
 * `src/chart.test.js`.
 */
import { formatNumber } from './format.js';
import { clockTime, nightLowShows } from './night.js';

/** The chart's window: the last 24 hours, not "today". */
export const WINDOW_S = 24 * 3600;

/** The window a tap on the curve swaps in for half a minute: the last seven days. */
export const WEEK_S = 7 * WINDOW_S;

/**
 * Points are five minutes apart. A step longer than this is a gap — the
 * station was offline or the backfill has not reached it yet — and breaks the
 * line instead of drawing a straight bridge across it.
 */
export const GAP_S = 15 * 60;

/**
 * The quantities a curve can show. `minSpan` is the narrowest span the curve
 * is scaled to: without it, an indoor room that only moves by 0.3 °C would
 * fill the whole height and look as dramatic as a day outside. The other
 * spans follow the same idea — a room's humidity moves by a few percent,
 * CO₂ by a few hundred ppm when nobody is home, pressure by a few hPa on a
 * quiet day.
 *
 * Only temperature colours its low and high blue and red. On the humidity
 * scale red means dry and blue damp — the low would be blue although it is
 * the dry end — so the other curves keep them neutral.
 */
export const CURVES = {
  temperature: { unit: '°C', digits: 1, minSpan: 2, coloured: true },
  humidity: { unit: '%', digits: 0, minSpan: 10, coloured: false },
  co2: { unit: 'ppm', digits: 0, minSpan: 200, coloured: false },
  pressure: { unit: 'hPa', digits: 0, minSpan: 5, coloured: false },
};

export const hasCurve = (key) => Object.hasOwn(CURVES, key);

/**
 * Key values drawn as a horizontal line, per kind of module and quantity:
 * frost outside, and a room's thresholds of the airing rules — 60 % humidity
 * and 1,000 ppm CO₂ (`public/airing.js`). `side` is where the threshold is
 * reached: below 0 °C, above the other two. Outdoor humidity is left out on
 * purpose: outside air sits above 60 % most of the time, and the threshold is
 * a room's.
 */
export const GUIDES = {
  outdoor: { temperature: [{ value: 0, side: 'below' }] },
  room: { humidity: [{ value: 60, side: 'above' }], co2: [{ value: 1000, side: 'above' }] },
};

/**
 * The guides a curve of `range` shows: only those reached in the window, so
 * a calm day draws none and a line appearing is the message itself.
 */
export function reachedGuides(guides, { min, max }) {
  return guides.filter(({ value, side }) => (side === 'below' ? min <= value : max >= value));
}

/**
 * The scale widened to take in every reached guide. A reached guide lies
 * inside the range unless the whole curve sits on its far side — a day below
 * zero throughout — and the line is then drawn at the edge rather than left
 * out. The scale is never widened for a guide not reached.
 */
export function scaleWithGuides(scale, guides) {
  let { low, high } = scale;
  for (const { value } of guides) [low, high] = [Math.min(low, value), Math.max(high, value)];
  return { low, high };
}

/** The SVG's internal coordinates; the element is stretched to its box. */
export const VIEW = { width: 1000, height: 100 };

const round = (n) => Math.round(n * 10) / 10;

/**
 * Lowest and highest value of `key` in the window and when they were reached,
 * or null if there is none. An indoor room sits on its low or high for hours,
 * so the time is the *last* point at that value: "this cold until then".
 */
export function valueRange(samples, key, fromUtc, toUtc) {
  let min = Infinity;
  let max = -Infinity;
  let minAt = null;
  let maxAt = null;
  for (const { time_utc: t, [key]: v } of samples) {
    if (t < fromUtc || t > toUtc || typeof v !== 'number') continue;
    if (v <= min) [min, minAt] = [v, t];
    if (v >= max) [max, maxAt] = [v, t];
  }
  return min === Infinity ? null : { min, max, minAt, maxAt };
}

/** The value scale: the range, widened around its middle to at least `minSpan`. */
export function scaleFor({ min, max }, minSpan) {
  if (max - min >= minSpan) return { low: min, high: max };
  const middle = (min + max) / 2;
  return { low: middle - minSpan / 2, high: middle + minSpan / 2 };
}

/**
 * Samples → SVG path data across the whole window. Time runs left to right
 * from `fromUtc` to `toUtc`, so a module that stopped reporting shows an empty
 * stretch at the right end. A 10 % margin keeps the line off the edges.
 */
function projection({ fromUtc, toUtc, low, high }) {
  const { width, height } = VIEW;
  const margin = height * 0.1;
  return {
    x: (t) => round(((t - fromUtc) / (toUtc - fromUtc)) * width),
    y: (v) => round(height - margin - ((v - low) / (high - low)) * (height - 2 * margin)),
  };
}

export function linePath(samples, frame, key) {
  const { fromUtc, toUtc } = frame;
  const { x, y } = projection(frame);

  const parts = [];
  let previous = null;
  for (const { time_utc: t, [key]: v } of samples) {
    if (t < fromUtc || t > toUtc || typeof v !== 'number') {
      previous = null;
      continue;
    }
    const command = previous !== null && t - previous <= GAP_S ? 'L' : 'M';
    parts.push(`${command}${x(t)} ${y(v)}`);
    previous = t;
  }
  return parts.join('');
}

/**
 * A dot on the curve, as path data: a subpath of zero length, which a round
 * line cap draws as a circle. With a non-scaling stroke it stays round although
 * the SVG is stretched to its box, which a <circle> would not.
 */
export function dotPath(t, v, frame) {
  const { x, y } = projection(frame);
  return `M${x(t)} ${y(v)}h0`;
}

/**
 * Local midnight and noon inside the window, as a fraction of its width. The
 * window is stepped in whole hours of UTC, which are whole local hours too for
 * Europe/Berlin, so a day with 23 or 25 hours still gets exactly one midnight.
 */
export function localMarks(fromUtc, toUtc) {
  const marks = [];
  for (let t = Math.ceil(fromUtc / 3600) * 3600; t <= toUtc; t += 3600) {
    const date = new Date(t * 1000);
    if (date.getMinutes() !== 0) continue;
    const hour = date.getHours();
    if (hour === 0 || hour === 12) {
      marks.push({ at: (t - fromUtc) / (toUtc - fromUtc), label: `${hour} Uhr` });
    }
  }
  return marks;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * A week's marks: a line at each local midnight, and each day's name under
 * its noon, where the day's own stretch of curve is. Fourteen "0 Uhr" and
 * "12 Uhr" labels would not fit a tile. A day whose noon is too close to
 * an edge for its name is left unnamed rather than cut off.
 */
export function weekMarks(fromUtc, toUtc) {
  const lines = [];
  const labels = [];
  for (let t = Math.ceil(fromUtc / 3600) * 3600; t <= toUtc; t += 3600) {
    const date = new Date(t * 1000);
    if (date.getMinutes() !== 0) continue;
    const at = (t - fromUtc) / (toUtc - fromUtc);
    if (date.getHours() === 0) lines.push({ at });
    if (date.getHours() === 12 && at >= 0.04 && at <= 0.96) labels.push({ at, label: WEEKDAYS[date.getDay()] });
  }
  return { lines, labels };
}

/** Vertical lines for the marks, as path data in the same coordinates. */
export function marksPath(marks) {
  return marks.map(({ at }) => `M${round(at * VIEW.width)} 0V${VIEW.height}`).join('');
}

/** Horizontal lines for the guides across the whole width, in the frame's scale. */
export function guidesPath(guides, frame) {
  const { y } = projection(frame);
  return guides.map(({ value }) => `M0 ${y(value)}H${VIEW.width}`).join('');
}

/**
 * Everything a tile's chart shows for the quantity `key`. `nowUtc` is the
 * server's clock at render time; the window ends there. The high carries the
 * unit, so a humidity curve is never read as a temperature. Temperature puts
 * it on the low too, as it always has; "Min: 1014 hPa – Max: 1019 hPa" is
 * too wide for one line, and a wrapped line would shrink the curve. A
 * no-break space keeps number and unit together.
 *
 * With a `night` window the chart also carries the night's low and its
 * local time, and the blue dot marks that low instead of the 24-hour one, so
 * the line below and the curve agree; the high's dot is left out. A night
 * without a point, or one whose low no longer shows, falls back to the
 * 24-hour low and high.
 *
 * `guides` (from `GUIDES`) adds a horizontal line at each one reached in the
 * window, as path data of its own, and its position from the top as a
 * fraction of the height for the label at its end.
 */
export function chartContent(samples, nowUtc, key = 'temperature', night = null, windowS = WINDOW_S, guides = []) {
  const { unit, digits, minSpan, coloured } = CURVES[key];
  const fromUtc = nowUtc - windowS;
  const range = valueRange(samples, key, fromUtc, nowUtc);
  if (!range) return null;
  const week = windowS > WINDOW_S;
  const day = week ? null : localMarks(fromUtc, nowUtc);
  const { lines, labels } = week ? weekMarks(fromUtc, nowUtc) : { lines: day, labels: day };
  const reached = reachedGuides(guides, range);
  const frame = { fromUtc, toUtc: nowUtc, ...scaleWithGuides(scaleFor(range, minSpan), reached) };
  const { y } = projection(frame);
  const nightRange = night && valueRange(samples, key, Math.max(night.fromUtc, fromUtc), night.toUtc);
  const low = nightRange && nightLowShows(night, nightRange.minAt, nowUtc) ? nightRange : null;
  return {
    key,
    coloured,
    line: linePath(samples, frame, key),
    minDot: low ? dotPath(low.minAt, low.min, frame) : dotPath(range.minAt, range.min, frame),
    maxDot: low ? '' : dotPath(range.maxAt, range.max, frame),
    grid: marksPath(lines),
    guideLines: guidesPath(reached, frame),
    marks: labels,
    guides: reached.map(({ value }) => ({ at: y(value) / VIEW.height, label: formatNumber(value, 0) })),
    week,
    min: formatNumber(range.min, digits) + (coloured ? `\u00a0${unit}` : ''),
    max: `${formatNumber(range.max, digits)}\u00a0${unit}`,
    night: low ? { min: `${formatNumber(low.min, digits)}\u00a0${unit}`, at: clockTime(low.minAt) } : null,
  };
}
