/**
 * Pure presentation logic: numbers, ages and staleness. No DOM, so it is
 * unit-tested from `src/format.test.js`.
 */
import { statusHint } from './status.js';
import { humidityAt } from './humidity.js';

/**
 * When a value counts as stale, in seconds. A point is uploaded up to ten
 * minutes after it was measured and picked up by the poller up to ten minutes
 * later, so twenty minutes is ordinary. `getstationsdata` fails about 7 % of
 * the time and costs a whole cycle when it does, so one more cycle on top is
 * still normal. Beyond that, something is wrong and the tile has to say so.
 */
export const STALE_AFTER_S = 35 * 60;

/** The quantities a tile shows, in order. The first is the large one. */
export const QUANTITIES = [
  { key: 'temperature', unit: '°C', digits: 1 },
  { key: 'humidity', unit: '%', digits: 0 },
  { key: 'co2', unit: 'ppm', digits: 0 },
];

/**
 * A number in German notation with a fixed number of decimals: 21,3. Negative
 * values get a real minus sign; a hyphen is too short to read from two metres.
 * A value that rounds to zero gets none: "−0,0 °C" reads like a different
 * temperature than "0,0 °C".
 */
export function formatNumber(value, digits) {
  const text = value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  if (/^-0(,0*)?$/.test(text)) return text.slice(1);
  return text.replace('-', '\u2212');
}

/**
 * Rain and wind get their own presentations (rain totals, wind rose), not a
 * tile of current values — a tile would stay empty for them.
 */
const OWN_PRESENTATION = new Set(['rain', 'wind']);

export const hasTile = (module) => !OWN_PRESENTATION.has(module.type);

/**
 * Outdoor first, on the left: it is the most frequent question and the
 * reference every indoor room is compared against. The rooms follow side by
 * side, the base unit first. Any other type comes last. Within a type the
 * API's order (module id) stays, so the layout is stable without a setting.
 */
const TILE_ORDER = ['outdoor', 'base', 'indoor'];

export function orderTiles(modules) {
  const rank = (module) => {
    const index = TILE_ORDER.indexOf(module.type);
    return index === -1 ? TILE_ORDER.length : index;
  };
  // Array.prototype.sort is stable, so equal ranks keep their order.
  return [...modules].sort((a, b) => rank(a) - rank(b));
}

/**
 * How old a value is, as the household reads it: "gerade eben", "vor 12 Min.",
 * "vor 3 Std.", "vor 2 Tagen". Negative ages (a clock slightly ahead) count as
 * "gerade eben".
 */
export function formatAge(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'vor 1 Tag' : `vor ${days} Tagen`;
}

/**
 * The age of a point in seconds, measured on the server's clock: the server's
 * time at the response, plus how long ago the response arrived. The tablet's
 * own clock only measures that interval, so a wrong date on the device does
 * not make every tile look stale.
 */
export function ageSeconds({ timeUtc, serverNowUtc, fetchedAtMs, nowMs }) {
  return serverNowUtc - timeUtc + Math.max(0, (nowMs - fetchedAtMs) / 1000);
}

export const isStale = (age) => age > STALE_AFTER_S;

/** Failed asks in a row before the page says so; one alone is a dropped request, not a lost server. */
export const FAILURES_SHOWN = 2;

/** What the page knows of the server before its first ask. */
export const NO_ASK = Object.freeze({ failures: 0, partial: false, contactAtMs: null, answeredAtMs: null });

/**
 * What one ask does to that record. An ask is answered in full only once the
 * values *and* every series that was due have arrived: a page with values and
 * no curves has also lost its airing and window labels, and looked complete.
 * Anything less is a failure, and `partial` says which kind the last
 * one was: the values came and a series did not.
 *
 * Two times, because they answer different questions: `contactAtMs` is when
 * the server last answered at all, `answeredAtMs` when it last answered in
 * full — which is how old the curves are.
 */
export function afterAsk(record, { values, seriesMissing, atMs }) {
  if (!values) return { ...record, failures: record.failures + 1, partial: false };
  if (seriesMissing) return { ...record, failures: record.failures + 1, partial: true, contactAtMs: atMs };
  return { failures: 0, partial: false, contactAtMs: atMs, answeredAtMs: atMs };
}

/**
 * Whether a module's series is fetched in this ask: when the module has a
 * newer point than the series held, or — `all` — when the hourly reload is
 * due. A fresh page starts without any series, so before the old one gives
 * way, the link has to carry every one of them once. A module without
 * a point has no series to fetch.
 */
export const seriesDue = ({ newest, held, all }) => newest !== null && (all || newest !== held);

/**
 * The hourly reload replaces a page that has curves with one that has none
 * yet, so it waits for an ask that fetched every series and lost none.
 */
export const mayReload = (record, { allSeries }) => allSeries && record.failures === 0;

/**
 * The server line in the bar at the foot of the page, or null while there is
 * nothing to say. Two wordings, because the household does two different
 * things: no answer at all is a server or a network that is gone, and the age
 * is that of the last contact; values without their series is a link that
 * loses requests, the tiles' values are current, and the age is that of the
 * curves. A page that never had the one or the other names no age.
 */
export function serverLine({ failures, partial, contactAtMs, answeredAtMs, nowMs }) {
  if (failures < FAILURES_SHOWN) return null;
  const age = (atMs) => formatAge((nowMs - atMs) / 1000);
  if (partial) {
    return answeredAtMs === null
      ? 'Verbindung zum Server gestört – keine Kurven'
      : `Verbindung zum Server gestört – letzte Kurven ${age(answeredAtMs)}`;
  }
  return contactAtMs === null
    ? 'Keine Verbindung zum Server'
    : `Keine Verbindung zum Server – letzte Antwort ${age(contactAtMs)}`;
}

/**
 * Values that carry a judgement are coloured from a fixed set of hues: red,
 * orange, yellow, green, teal, blue. Between the stops of a scale the hue
 * moves continuously; saturation and lightness stay fixed and moderate, so
 * the number stays readable on the dark tile and the page does not turn into
 * a traffic light.
 *
 * Only the *hue* is decided here. Saturation and lightness come from the
 * page's mode tokens, so the evening and the night dim these colours with
 * everything else — a value with its own `style` attribute would
 * otherwise be the brightest thing in a dark room.
 */
const HUE = { red: 0, orange: 28, yellow: 52, green: 130, teal: 175, blue: 212 };

function scaleColour(stops, value) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  let hue;
  if (value <= first[0]) hue = first[1];
  else if (value >= last[0]) hue = last[1];
  else {
    const upper = stops.findIndex(([at]) => at >= value);
    const [x0, h0] = stops[upper - 1];
    const [x1, h1] = stops[upper];
    hue = h0 + ((value - x0) / (x1 - x0)) * (h1 - h0);
  }
  return `hsl(${Math.round(hue)} var(--value-saturation, 65%) var(--value-lightness, 62%))`;
}

/**
 * How comfortable a room's relative humidity is: red when too dry, through
 * orange and yellow to green in the comfort band, then through teal to blue
 * when too damp. Every hue appears once, so a colour never means two
 * different humidities.
 *
 * This answers "is the room too dry or too damp". It is not the airing
 * recommendation, which has to compare absolute humidity.
 */
const HUMIDITY_STOPS = [
  [30, HUE.red], // too dry
  [35, HUE.orange],
  [40, HUE.yellow],
  [45, HUE.green], // comfort …
  [55, HUE.green], // … up to here
  [60, HUE.teal], // getting damp
  [65, HUE.blue], // too damp
];

export const humidityColour = (humidity) => scaleColour(HUMIDITY_STOPS, humidity);

/**
 * How stale a room's air is: green is good, yellow is still acceptable, red
 * means "air the room". The stops follow EN 16798's indoor air categories,
 * which sit about 400, 600 and 1,000 ppm above outdoor air (≈ 420 ppm), and
 * the German Umweltbundesamt, for which 1,000 ppm is the limit of hygienically
 * harmless air. Its "unacceptable" 2,000 ppm is far too late for a prompt to
 * open the window, so red is reached at 1,400.
 */
const CO2_STOPS = [
  [800, HUE.green], // good
  [1000, HUE.yellow], // still acceptable
  [1200, HUE.orange],
  [1400, HUE.red], // air the room
];

export const co2Colour = (co2) => scaleColour(CO2_STOPS, co2);

/**
 * Only rooms get a comfort colour. Outside, 90 % is ordinary weather and says
 * nothing about whether anyone is comfortable. CO₂ is only measured indoors.
 */
const ROOM_TYPES = new Set(['base', 'indoor']);

export const isRoom = (module) => ROOM_TYPES.has(module.type);

function colourFor(module, key, value) {
  if (!ROOM_TYPES.has(module.type)) return undefined;
  if (key === 'humidity') return humidityColour(value);
  if (key === 'co2') return co2Colour(value);
  return undefined;
}

/**
 * The outdoor tile shows the air pressure next to its humidity. Only the base
 * unit measures it, but it is the same air pressure indoors and out, and it
 * belongs with the weather, not with a room. Sea-level pressure in whole hPa,
 * as weather reports give it.
 */
const PRESSURE = { key: 'pressure', unit: 'hPa', digits: 0 };

/**
 * The pressure tendency (`public/pressure.js`) as the tile shows it: one arrow
 * glyph, rotated, so every level uses the same character — flat when steady,
 * diagonal when rising or falling, vertical when it does so quickly. The label
 * is for assistive technology.
 */
const TRENDS = new Map([
  [2, { angle: -90, label: 'steigt stark' }],
  [1, { angle: -45, label: 'steigt' }],
  [0, { angle: 0, label: 'gleichbleibend' }],
  [-1, { angle: 45, label: 'fällt' }],
  [-2, { angle: 90, label: 'fällt stark' }],
]);

/**
 * A tendency whose newest point is stale says nothing about now — the series
 * may lag the current value when its fetch failed.
 */
function trendFor(tendency, clock) {
  if (!tendency) return undefined;
  if (isStale(ageSeconds({ timeUtc: tendency.atUtc, ...clock }))) return undefined;
  return TRENDS.get(tendency.level);
}

/**
 * The base unit's pressure for the outdoor tile, or nothing. A stale base unit
 * gives none: the outdoor tile's age would otherwise vouch for a value it did
 * not measure. The base tile shows its own age and says what is wrong.
 */
function borrowedPressure(module, station, clock, tendency) {
  if (module.type !== 'outdoor') return [];
  const latest = station?.latest;
  const value = latest?.values.pressure;
  if (typeof value !== 'number') return [];
  if (isStale(ageSeconds({ timeUtc: latest.time_utc, ...clock }))) return [];
  const trend = trendFor(tendency, clock);
  return [{ key: PRESSURE.key, text: formatNumber(value, PRESSURE.digits), unit: PRESSURE.unit, ...(trend && { trend }) }];
}

/**
 * The airing recommendation (`public/airing.js`) as a room tile shows it: a
 * label next to the name, and the reason behind a tap — every value the rules
 * look at, inside against outside, and one sentence (whoever asks gets the
 * whole picture, not only the rule that fired). `tone` picks the label's
 * box: `air`, `dont`, or `ask` for the quiet question while no rule applies.
 */
const ACTIONS = {
  air: { label: 'Lüften', tone: 'air' },
  brief: { label: 'Kurz lüften', tone: 'air' },
  dont: { label: 'Nicht lüften', tone: 'dont' },
  ask: { label: 'Lüften?', tone: 'ask' },
};

/**
 * The outside air at the room's temperature. Above 100 % the air cannot
 * hold its water and it condenses — on the walls, the case that matters — so
 * the number stops there.
 */
const translated = (humidity) => (humidity >= 100 ? '≥\u00a0100' : formatNumber(humidity, 0));
const inRoom = ({ outside }) => translated(outside.inRoom);

/**
 * The table: a column per side, a row per value — CO₂ where the room measures
 * it, then temperature and relative humidity. Each row is inside, outside and
 * the unit; an empty side is a value that side does not have. The units name
 * the rows, as they do on the tile: a column of labels made the table too wide
 * for it. Outside, the humidity carries what it would be at the room's
 * temperature behind an arrow — "90 → 32 %" — in place of a row of g/m³:
 * the same comparison in the scale the tile already uses.
 */
function comparison(r) {
  const { inside, outside } = r;
  return {
    head: ['Drinnen', 'Draußen'],
    rows: [
      ...(inside.co2 === undefined ? [] : [[formatNumber(inside.co2, 0), '', 'ppm']]),
      [formatNumber(inside.temperature, 1), formatNumber(outside.temperature, 1), '°C'],
      [formatNumber(inside.humidity, 0), `${formatNumber(outside.humidity, 0)} → ${inRoom(r)}`, '%'],
    ],
  };
}

/**
 * The humidity sentences name the number behind the arrow, so the sentence
 * right below the table says in words what the arrow means. A no-break space
 * (\u00a0) keeps a number and its unit on one line in every sentence here.
 */
const WATER = {
  drier: (r) => `Die Außenluft hätte drinnen nur ${inRoom(r)}\u00a0% – Lüften trocknet den Raum.`,
  wetter: (r) => `Die Außenluft hätte drinnen ${inRoom(r)}\u00a0% – Lüften macht den Raum feuchter.`,
  same: (r) => `Die Außenluft hätte drinnen ${inRoom(r)}\u00a0% – Lüften ändert die Feuchte kaum.`,
  humid: (r) => `Der Raum ist feucht, doch die Außenluft hätte drinnen ${inRoom(r)}\u00a0% – Lüften trocknet kaum.`,
};
const TEMPERATURE = {
  cooler: 'Draußen ist es kühler – Lüften kühlt den Raum.',
  warmer: 'Draußen ist es wärmer – Lüften wärmt den Raum.',
};

/**
 * No rule applies, so there is no reason to air — but the answer says what
 * airing would do, humidity first because that is what the rules weigh first.
 * "About the same" is said as what airing changes, not as a claim about the
 * two numbers, which can lie up to 3 °C apart and are right above.
 */
function askText(r) {
  const water = WATER[r.water ?? (r.humid ? 'humid' : 'same')](r);
  const temperature = TEMPERATURE[r.temperature]
    ?? (r.warm ? 'Der Raum ist warm, doch Lüften kühlt ihn kaum.' : 'Lüften ändert die Temperatur kaum.');
  return `Kein Grund zu lüften. ${water} ${temperature}`;
}

const REASONS = {
  co2: (r) => 'Ab 1000\u00a0ppm ist die Luft verbraucht.' + ({
    humid: ` Die Außenluft hätte drinnen ${inRoom(r)}\u00a0% – nur kurz.`,
    hot: ' Draußen ist es wärmer – nur kurz.',
  }[r.caveat] ?? ''),
  humid: WATER.wetter,
  dry: WATER.drier,
  hot: () => 'Draußen ist es wärmer – Lüften heizt den Raum auf.',
  cool: () => TEMPERATURE.cooler,
};

/**
 * Nothing without an answer, and nothing for a stale one: a label that rests
 * on old values would outlive the situation it describes.
 */
export function airingContent(answer, clock) {
  if (!answer) return undefined;
  if (isStale(ageSeconds({ timeUtc: answer.atUtc, ...clock }))) return undefined;
  const text = answer.action === 'ask' ? askText(answer) : REASONS[answer.reason](answer);
  return { ...ACTIONS[answer.action], ...comparison(answer), text };
}

/** A duration as the reason says it: "25 Min.", "1 Std. 5 Min.". */
export function formatDuration(seconds) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} Std.` : `${hours} Std. ${rest} Min.`;
}

const clockTime = (timeUtc) =>
  new Date(timeUtc * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

const WINDOW_TEXT = {
  co2: 'So schnell fällt CO₂ nur bei offenem Fenster.',
  cooling: 'So schnell folgt der Raum der Außenluft nur bei offenem Fenster.',
};

/**
 * "Is the air in the other room the same?": every other room's air at this
 * room's temperature, in the scale of this room's own humidity —
 * "Arbeitszimmer-Luft hier: 49 %" next to the tile's 50 %. The relative values of two rooms mislead
 * about a quarter of the time (a degree apart, 52 % can be the same air as
 * 50 %); the translation cannot. Rooms whose newest point is stale or lacks a
 * value are left out: an old reading would answer for air that has moved on.
 */
export function otherRooms(module, modules, clock) {
  const here = module.latest?.values.temperature;
  if (typeof here !== 'number') return [];
  return modules.flatMap((other) => {
    if (other.id === module.id || !isRoom(other) || !other.latest) return [];
    const { temperature, humidity } = other.latest.values;
    if (typeof temperature !== 'number' || typeof humidity !== 'number') return [];
    if (isStale(ageSeconds({ timeUtc: other.latest.time_utc, ...clock }))) return [];
    return [{ label: `${other.name}-Luft hier:`, value: `${translated(humidityAt(temperature, humidity, here))}\u00a0%` }];
  });
}

/**
 * The window guess (`public/window.js`) as a room tile shows it, in the
 * airing label's place: while a window is open, "Lüften" is moot. The dot is
 * neutral — a guess, not a judgement — and the reason says how the guess ends,
 * so a closed window's label is not a mystery while it lingers. It gives no
 * number: on a real wall it went 15 to 32 minutes after closing, a span
 * too wide for a promise. The label is as short as "Nicht lüften" so the room's name
 * keeps its place, and how long the window has been open is in the reason:
 * in the label, it pushed the name out of the tile.
 *
 * A value the newest point lacks is a dash, like on the tile: a point came
 * without CO₂ during an opening found by CO₂, and formatting the missing
 * value froze the wall. An older value would answer for air that has
 * moved on.
 */
export function windowContent(guess, clock) {
  if (!guess) return undefined;
  if (isStale(ageSeconds({ timeUtc: guess.atUtc, ...clock }))) return undefined;
  const since = ageSeconds({ timeUtc: guess.since, ...clock });
  const reading = (value, digits) => (typeof value === 'number' ? formatNumber(value, digits) : MISSING);
  const rows = [['Seit', `${clockTime(guess.since)} · ${formatDuration(since)}`]];
  if (guess.why === 'co2') {
    rows.push(['CO₂', `${reading(guess.from.co2, 0)} → ${reading(guess.now.co2, 0)} ppm`]);
  } else {
    rows.push(['Drinnen', `${reading(guess.from.temperature, 1)} → ${reading(guess.now.temperature, 1)} °C`]);
    rows.push(['Draußen', `${reading(guess.now.outside, 1)} °C`]);
  }
  return {
    label: 'Fenster auf?',
    tone: 'window',
    rows,
    text: `${WINDOW_TEXT[guess.why]} Nach dem Schließen bleibt der Hinweis noch eine Weile stehen.`,
  };
}

/**
 * What each type of module measures. Netatmo sometimes delivers a point
 * without one of them — one indoor module's CO₂ went missing about five times
 * a day, following its radio link. Such a value is shown as a placeholder, not
 * left out: its number is the tap target for its curve, and the curve is
 * exactly what one wants to see when the value is missing. Nothing is
 * estimated and nothing is carried over from an older point. A type not
 * listed here shows only what its point has.
 */
const MEASURES = new Map([
  ['base', new Set(['temperature', 'humidity', 'co2'])],
  ['indoor', new Set(['temperature', 'humidity', 'co2'])],
  ['outdoor', new Set(['temperature', 'humidity'])],
]);

const MISSING = '–';

/**
 * One module from the API → what its tile shows. Quantities the module does
 * not measure are left out rather than shown as a dash; one it measures but
 * whose newest point lacks it is a dash marked `missing`. A value that carries
 * a judgement gets a `colour`; the others have none. `station` is the base
 * unit, whose pressure the outdoor tile shows, and `tendency` that pressure's
 * three-hour tendency, shown as an arrow next to it. `hint` is what is wrong
 * with the module itself, shown next to the age, or null.
 */
export function tileContent(module, clock, station, tendency) {
  const latest = module.latest;
  if (!latest) {
    return { name: module.name, values: [], age: 'noch keine Werte', stale: true, hint: statusHint(module, true) };
  }
  const age = ageSeconds({ timeUtc: latest.time_utc, ...clock });
  const measured = MEASURES.get(module.type);
  const values = QUANTITIES
    .filter(({ key }) => typeof latest.values[key] === 'number' || measured?.has(key))
    .map(({ key, unit, digits }) => {
      const value = latest.values[key];
      if (typeof value !== 'number') return { key, text: MISSING, unit, missing: true };
      const colour = colourFor(module, key, value);
      return { key, text: formatNumber(value, digits), unit, ...(colour && { colour }) };
    })
    .concat(borrowedPressure(module, station, clock, tendency));
  const stale = isStale(age);
  return { name: module.name, values, age: formatAge(age), stale, hint: statusHint(module, stale) };
}
