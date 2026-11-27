/**
 * The wall page: one tile per module with its current values, their age and
 * the temperature over the last 24 hours. A tap on another value shows that
 * value's curve instead, for half a minute, and a tap on the curve shows its
 * last seven days. Rooms carry an airing
 * recommendation — or, while a window seems open, that guess, and otherwise
 * the quiet question "Lüften?" — next to their name; a tap on it shows the
 * reason.
 *
 * The page stays open for weeks on a 2018 tablet, so it builds each tile once
 * and afterwards only replaces text. It never replaces the screen with an
 * error: a failed fetch keeps the last values, whose age then grows until the
 * tile looks stale.
 */
import { NO_ASK, afterAsk, airingContent, tileContent, hasTile, mayReload, seriesDue, serverLine, isRoom, orderTiles, otherRooms, windowContent } from './format.js';
import { GUIDES, VIEW, WEEK_S, WINDOW_S, chartContent, hasCurve } from './chart.js';
import { pressureTendency } from './pressure.js';
import { airingAnswer } from './airing.js';
import { openWindow } from './window.js';
import { nightWindow } from './night.js';
import { forecastContent } from './forecast.js';
import { EVENING, displayMode, eveningStart } from './evening.js';
import { powerHint } from './power.js';

/**
 * The station produces a point every five minutes and the poller picks them
 * up every ten, at an offset the page does not know. Asking once a minute
 * keeps that offset from adding up to ten minutes to every age, and costs a
 * few hundred bytes on the LAN.
 */
const FETCH_EVERY_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
/** The standing insurance against leaks: a fresh page every hour. */
const RELOAD_AFTER_MS = 60 * 60 * 1000;
/**
 * How long a tapped value's curve stays before the tile returns to the
 * temperature. The wall's resting state is one temperature curve per tile;
 * everything else is on request and goes away by itself.
 */
const SWAP_BACK_MS = 30 * 1000;
const RESTING_CURVE = 'temperature';
/** Not a curve: the airing recommendation's reason, shown in the curve's place. */
const REASON = 'reason';
/**
 * Not a curve either: the temperature with its 24-hour low and high, which a
 * tap on the night's low brings back for the same half minute.
 */
const DAY_RANGE = 'day-range';

/**
 * A week of a module's series, fetched only while a tile shows it: the wall's
 * resting state needs a day, and a week is seven times the points. Keyed by
 * module, since the outdoor tile's pressure is the base unit's series.
 */
const weekSeries = new Map();

const loadedAtMs = Date.now();
const grid = document.getElementById('tiles');
const status = document.getElementById('status');
const tiles = new Map();

/**
 * `?mode=day|evening|night` pins the rendering instead of letting the clock
 * and the sunset decide. `day` is the escape hatch for a wall that has
 * gone too dark to be useful, until there is somewhere to set that; the
 * other two are how the evening and the night get looked at *on the wall* —
 * the alternative is standing in front of it at 23:00. It survives the hourly
 * reload, which keeps the query string.
 */
const MODES = ['day', 'evening', 'night'];
const forcedMode = MODES.find((name) => name === new URLSearchParams(location.search).get('mode'));
/** 'day', 'evening' or 'night' — what the last render decided. */
let mode = 'day';

/**
 * Fully's JavaScript interface, present only when the page runs in the kiosk
 * browser on the wall. Every other browser — a desk, a phone, the
 * headless preview — gets null and none of this happens.
 */
const kiosk = typeof window.fully?.turnScreenOff === 'function' ? window.fully : null;
/**
 * The tablet's own charger and battery, from the same interface. Read in the
 * page rather than on the server: each wall reports itself, the line still
 * comes while the server is unreachable, and the server needs neither the
 * kiosk browser's address nor its password. Null outside the kiosk browser.
 */
function tabletPower() {
  const fully = window.fully;
  if (typeof fully?.isPlugged !== 'function' || typeof fully?.getBatteryLevel !== 'function') return null;
  try {
    return { plugged: fully.isPlugged(), level: fully.getBatteryLevel() };
  } catch (error) {
    console.warn(`kiosk power reading failed: ${error.message}`);
    return null;
  }
}
/** The pending "go dark again" timer; at most one, like a tile's. */
let screenOffTimer = null;
/**
 * Set by `?diag`, and refreshed by every render: on the wall the kiosk browser
 * runs fullscreen with no clock and no address bar, so what the page *decided*
 * is otherwise invisible — which is how an evening that never arrived once
 * went unexplained.
 */
let updateDiagnostics = null;

/**
 * The server fetches the forecast hourly; asking every ten minutes
 * picks up a new one soon enough.
 */
const FORECAST_EVERY_MS = 10 * 60 * 1000;

/** The last good response, kept through failures. */
let data = null;
/** Failed asks in a row, and when the server last answered at all and in full (`afterAsk`). */
let asked = NO_ASK;
/** The last forecast, and when it was asked for; null when the server has none. */
let forecast = null;
let forecastAskedMs = -Infinity;
/**
 * This install's evening and night, from `.env` through the server.
 * The defaults stand in until the first answer; asked once per page load, so
 * the hourly reload picks up a change and a restart of the server is enough.
 */
let settings = EVENING;
let serverZone = null;

async function get(path, method = 'GET') {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function svgElement(tag, className) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function tileFor(id) {
  if (!tiles.has(id)) {
    const root = element('article', 'tile');
    // One listener per tile for all its values, added once with the tile.
    // The values themselves are rebuilt on every render. A sleeping tile at
    // night wakes wherever it is tapped: the tile is the target then,
    // and its empty area is by far the largest part of it.
    root.addEventListener('click', (event) => {
      const key = event.target.closest('[data-key]')?.dataset.key;
      if (key || (mode === 'night' && !tiles.get(id).awake)) showCurve(id, key);
      // A tap on the curve itself swaps a day for a week and back.
      else if (event.target.closest('.chart')) toggleWeek(id);
    });
    // One svg with one path per layer, created once. A refresh only replaces
    // their `d` attributes — appending instead is how a chart leaks over weeks.
    const svg = svgElement('svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const grid = svgElement('path', 'grid');
    const guideLines = svgElement('path', 'grid guide-lines');
    const line = svgElement('path', 'line');
    const minDot = svgElement('path', 'dot min');
    const maxDot = svgElement('path', 'dot max');
    svg.append(grid, guideLines, line, minDot, maxDot);
    const chart = element('div', 'chart');
    const labels = element('div', 'labels');
    // "0", "60", "1000" at the left end of a horizontal guide.
    const guideLabels = element('div', 'guides');
    chart.append(svg, labels, guideLabels);
    // The name and, for rooms, the airing label beside it.
    const header = element('div', 'header');
    const name = element('h2', 'name');
    const airing = element('span', 'airing');
    airing.dataset.key = REASON;
    airing.hidden = true;
    const airingLabel = element('span', 'value');
    airing.append(airingLabel);
    header.append(name, airing);
    const reason = element('div', 'reason');
    reason.hidden = true;
    // Scrolling is reading: it keeps the reason up as a tap would, without a
    // render, and moves the fade to whichever edge has more beyond it.
    reason.addEventListener('scroll', () => {
      const tile = tiles.get(id);
      markMore(reason);
      keepDark();
      if (tile.swapBack === null) return;
      clearTimeout(tile.swapBack);
      tile.swapBack = setTimeout(() => restTile(id), SWAP_BACK_MS);
    }, { passive: true });
    // "Min: 23,8 °C – Max: 24,8 °C", built once; a refresh only replaces the two values.
    const range = element('p', 'range');
    const min = element('span', 'min');
    const max = element('span', 'max');
    range.append('Min: ', min, ' – Max: ', max);
    // "Nacht: 11,6 °C (6:40)" in its place on a morning, outdoors only.
    const nightRange = element('p', 'range night');
    const nightMin = element('span', 'min');
    const nightAt = element('span', 'at');
    nightRange.append('Nacht: ', nightMin, ' ', nightAt);
    nightRange.dataset.key = DAY_RANGE;
    nightRange.hidden = true;
    // "Arbeitszimmer-Luft hier: 49 %" under a room's humidity curve. Every tile
    // keeps its line free, so no curve changes height when the line fills.
    const others = element('div', 'range others');
    // "vor 12 Min. · Batterie 18 %": what is wrong with the module sits next to
    // its age, or whole on the line below when both do not fit.
    const age = element('div', 'age');
    const ageLine = element('p', 'line');
    const ageText = element('span', 'text');
    const hint = element('span', 'hint');
    hint.hidden = true;
    ageLine.append(ageText, hint);
    age.append(ageLine);
    const parts = {
      root,
      name,
      airing,
      airingLabel,
      reason,
      main: element('p', 'main'),
      secondary: element('ul', 'secondary'),
      chart,
      grid,
      guideLines,
      line,
      minDot,
      maxDot,
      labels,
      guideLabels,
      range,
      min,
      max,
      nightRange,
      others,
      nightMin,
      nightAt,
      age,
      ageText,
      hint,
      // The series this tile last fetched, and for which newest point.
      series: { newest: null, columns: [], samples: [], co2Baseline: null },
      // The quantity the curve shows, whether a tap has woken the tile out of
      // the night's reduced rendering, and the one timer that ends both.
      curve: RESTING_CURVE,
      week: false,
      awake: false,
      swapBack: null,
    };
    root.append(header, parts.main, parts.secondary, chart, reason, others, parts.range, nightRange, parts.age);
    tiles.set(id, parts);
  }
  return tiles.get(id);
}

function valueNode({ key, text, unit, colour, trend, missing }, className, curve) {
  const node = element(className === 'primary' ? 'span' : 'li', className);
  // A missing value keeps its key: the placeholder is still the way to its curve.
  node.dataset.key = key;
  if (missing) node.classList.add('missing');
  // Mark the value whose curve is showing, unless it is the usual one.
  if (key === curve && key !== RESTING_CURVE) node.classList.add('active');
  const value = element('span', 'value');
  value.textContent = text;
  if (colour) value.style.color = colour;
  node.append(value, trend ? trendNode(unit, trend) : unitNode(unit));
  return node;
}

function unitNode(unit) {
  const node = element('span', 'unit');
  node.textContent = unit;
  return node;
}

/**
 * The tendency arrow takes the unit's place: with "hPa" and the arrow, the
 * outdoor line no longer fits next to a humidity of 100 %, and a wrapped line
 * shrinks the curve. A four-digit number next to the humidity reads as
 * pressure; the unit is still named in the pressure curve's low/high line.
 */
function trendNode(unit, { angle, label }) {
  const node = element('span', 'trend');
  node.textContent = '→';
  node.style.transform = `rotate(${angle}deg)`;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `${unit}, ${label}`);
  return node;
}

/**
 * A tap on a value shows its curve; a tap on the value already showing, or on
 * the temperature, returns to rest at once. At night the first tap does
 * something else: it wakes the tile back to its full content, and only the
 * taps after that swap curves again — a tile nobody can read is no
 * place to start tapping values. Every tap restarts the timer, and a tile
 * never holds more than one.
 */
function showCurve(id, key) {
  const tile = tiles.get(id);
  if (!tile) return;
  clearTimeout(tile.swapBack);
  tile.swapBack = null;
  const waking = mode === 'night' && !tile.awake;
  if (waking) tile.awake = true;
  const known = hasCurve(key) || key === REASON || key === DAY_RANGE;
  tile.curve = waking || key === tile.curve || !known ? RESTING_CURVE : key;
  // Back at rest means back to the day, too.
  if (tile.curve === RESTING_CURVE && !tile.awake) tile.week = false;
  armSwapBack(id);
  render();
}

/**
 * A tap on the curve shows the same quantity over seven days, for the same
 * half minute; a second tap returns to the day at once.
 */
function toggleWeek(id) {
  const tile = tiles.get(id);
  if (!tile) return;
  tile.week = !tile.week;
  armSwapBack(id);
  render();
}

/** The one timer a tile holds, running while anything differs from rest. */
function armSwapBack(id) {
  const tile = tiles.get(id);
  clearTimeout(tile.swapBack);
  tile.swapBack = null;
  if (tile.awake || tile.week || tile.curve !== RESTING_CURVE) {
    tile.swapBack = setTimeout(() => restTile(id), SWAP_BACK_MS);
  }
}

/** Back to the resting curve, and at night back to the reduced rendering. */
function restTile(id) {
  const tile = tiles.get(id);
  if (!tile) return;
  clearTimeout(tile.swapBack);
  tile.swapBack = null;
  tile.curve = RESTING_CURVE;
  tile.week = false;
  tile.awake = false;
  if (![...tiles.values()].some((other) => other.week)) weekSeries.clear();
  render();
}

/**
 * Back to a dark wall after someone has woken it at night.
 *
 * The page cannot dim the backlight far enough — measured on a real tablet, the
 * panel's own minimum still lit the dark room — so at night the screen goes
 * off entirely, which only Fully can do. **The two directions are split on
 * purpose:**
 *
 * - **Off at night and on in the morning is Fully's scheduler**, not ours,
 *   set by hand to the same `NIGHT_FROM` and `DAY_FROM` as `.env`. A page
 *   that has hung cannot switch a screen back on, and a wall that stays dark
 *   all day is a worse failure than one that stays bright all night.
 * - **Off *again* after a tap is ours**, because a schedule fires at its two
 *   moments and never in between: woken at 02:00, the wall would otherwise
 *   burn until morning. If this half fails, the wall is merely too bright
 *   until the morning.
 *
 * Every interaction restarts the same half minute a tapped tile gets, so the
 * tile rests and the screen follows it. **Two independent triggers** arm it —
 * the touch itself and the page becoming visible when the screen comes on —
 * because it is not guaranteed that the tap which wakes the device is also
 * delivered to the page.
 *
 * **A pinned mode never sleeps.** `?mode=night` is how the night gets looked
 * at on the wall in daylight; a screen that switches itself off after half a
 * minute would make the one tool for checking it useless.
 */
function keepDark() {
  clearTimeout(screenOffTimer);
  screenOffTimer = null;
  // A hidden page is a screen that is already off: nothing to arm, and the
  // same event brings it back when the screen returns.
  if (!kiosk || forcedMode || mode !== 'night' || document.hidden) return;
  screenOffTimer = setTimeout(() => {
    screenOffTimer = null;
    // Decide on the mode of now, not of the last render: a tick need not have
    // landed in the half minute, and a morning wake would otherwise end dark.
    render();
    if (mode === 'night') kiosk.turnScreenOff();
  }, SWAP_BACK_MS);
}

/**
 * The samples a tile's curve is drawn from: its own series, unless the module
 * does not measure the quantity — the outdoor tile's pressure comes from the
 * base unit, whose series the base tile has already fetched.
 */
function curveSamples(tile, curve, station) {
  if (tile.series.columns.includes(curve) || !station) return tile.series.samples;
  return tiles.get(station.id)?.series.samples ?? [];
}

/**
 * The same choice over a week: the samples, or null while they are on their
 * way — the tile keeps its day until then. Fetched again once its module has
 * a newer point.
 */
function weekSamples(module, tile, curve, station) {
  const source = tile.series.columns.includes(curve) || !station ? module : station;
  const newest = source.latest?.time_utc ?? null;
  const cached = weekSeries.get(source.id);
  if (cached?.newest === newest) return cached.samples;
  if (!cached?.pending) fetchWeek(source.id, newest, cached);
  return cached?.samples ?? null;
}

async function fetchWeek(moduleId, newest, cached) {
  weekSeries.set(moduleId, { ...cached, pending: true });
  try {
    const body = await (await get(`/api/modules/${moduleId}/series?hours=${WEEK_S / 3600}`)).json();
    // A tile that went back to rest meanwhile has cleared the cache; keep it clear.
    if (weekSeries.has(moduleId)) weekSeries.set(moduleId, { newest, samples: body.samples });
  } catch (error) {
    // Not retried before the module's next point: the render below would ask again at once.
    console.warn(`week of module ${moduleId} failed: ${error.message}`);
    if (weekSeries.has(moduleId)) weekSeries.set(moduleId, { newest, samples: cached?.samples ?? null });
  }
  render();
}

/** The label beside a room's name, and the reason behind it, rebuilt on every render. */
function renderAiring(tile, airing, showing) {
  tile.airing.hidden = !airing;
  if (!airing) return;
  tile.airingLabel.textContent = airing.label;
  tile.airing.classList.toggle('dont', airing.tone === 'dont');
  tile.airing.classList.toggle('window', airing.tone === 'window');
  tile.airing.classList.toggle('forecast', airing.tone === 'forecast');
  tile.airing.classList.toggle('ask', airing.tone === 'ask');
  tile.airing.classList.toggle('active', showing);
  if (!showing) return;
  const cell = (tag, className, text) => {
    const node = element(tag, className);
    node.textContent = text;
    return node;
  };
  let rows;
  if (airing.head) {
    // Inside against outside: per side a number and its unit.
    rows = element('div', 'rows compare');
    rows.append(...airing.head.map((text) => cell('span', 'head', text)));
    for (const [inside, outside, unit] of airing.rows) {
      for (const value of [inside, outside]) {
        rows.append(cell('span', 'number', value), cell('span', 'measure', value ? unit : ''));
      }
    }
  } else {
    rows = element('dl', 'rows');
    for (const [label, value] of airing.rows) rows.append(cell('dt', '', label), cell('dd', '', value));
  }
  // The forecast's source line is not part of the reason block: it goes to the
  // foot of the tile, in the age line's place. Three rows leave the tile
  // half empty, and the white space is easier to read as a gap above that line
  // than as a tile that simply stops.
  if (airing.tone === 'forecast') {
    tile.reason.replaceChildren(rows);
    return;
  }
  const text = element('p', 'text');
  text.textContent = airing.text;
  tile.reason.replaceChildren(rows, text);
}

/**
 * Under a room's humidity curve, below its low and high, the other rooms' air
 * in this room's terms. The low and high stay: they were asked for.
 */
function renderOthers(tile, others) {
  tile.others.hidden = false;
  tile.others.replaceChildren(...others.map(({ label, value }) => {
    const line = element('p', 'line');
    const number = element('span', 'value');
    number.textContent = value;
    line.append(`${label} `, number);
    return line;
  }));
}

function renderChart(tile, chart) {
  tile.chart.hidden = !chart;
  tile.range.hidden = !chart || Boolean(chart.night);
  tile.nightRange.hidden = !chart?.night;
  if (!chart) return;
  if (chart.night) {
    tile.nightMin.textContent = chart.night.min;
    tile.nightAt.textContent = `(${chart.night.at})`;
  }
  tile.chart.classList.toggle('neutral', !chart.coloured);
  tile.range.classList.toggle('neutral', !chart.coloured);
  tile.min.textContent = chart.min;
  tile.max.textContent = chart.max;
  tile.line.setAttribute('d', chart.line);
  tile.minDot.setAttribute('d', chart.minDot);
  tile.maxDot.setAttribute('d', chart.maxDot);
  tile.grid.setAttribute('d', chart.grid);
  tile.guideLines.setAttribute('d', chart.guideLines);
  tile.labels.replaceChildren(...chart.marks.map(({ at, label }) => {
    const node = element('span', 'label');
    node.textContent = label;
    node.style.left = `${at * 100}%`;
    return node;
  }));
  tile.guideLabels.replaceChildren(...chart.guides.map(({ at, label }) => {
    const node = element('span', 'guide');
    node.textContent = label;
    node.style.top = `${at * 100}%`;
    return node;
  }));
}

/**
 * A series only changes when its module has a new point, about every ten
 * minutes, so it is fetched again only then — and all of them once the hourly
 * reload is due (`seriesDue`). A failure keeps the old one and is retried on
 * the next tick, because `newest` stays unchanged.
 *
 * Returns whether a series that was due is missing, so the tick can count a
 * failure the wall would otherwise not show.
 */
async function refreshSeries(modules, all) {
  let missing = false;
  for (const module of modules) {
    const newest = module.latest?.time_utc ?? null;
    const tile = tileFor(module.id);
    if (!seriesDue({ newest, held: tile.series.newest, all })) continue;
    try {
      const body = await (await get(`/api/modules/${module.id}/series`)).json();
      tile.series = { newest, columns: body.columns, samples: body.samples, co2Baseline: body.co2_baseline };
    } catch (error) {
      missing = true;
      console.warn(`series of module ${module.id} failed, keeping the old one: ${error.message}`);
    }
  }
  return missing;
}

/**
 * Three modules sit side by side; four make a square; five and six fill two
 * rows of three. The tiles scale their type with their own size, so the
 * layout grows from three modules to six without further changes.
 */
function gridShape(count) {
  const columns = count <= 3 ? Math.max(count, 1) : count === 4 ? 2 : 3;
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

/** One tile, from its module and the values `render()` works out once for all tiles. */
function renderTile(tile, module, { clock, serverNowUtc, station, outdoorSamples, tendency }) {
  // At night the tile is down to the room, its temperature and whether to
  // open or close a window. Humidity and CO₂ go with the curve, its low
  // and high, and the age of a tile that is fine: at 23:00 the question is
  // the temperature, and whoever wants the rest taps the tile awake.
  const reduced = mode === 'night' && !tile.awake;
  const content = tileContent(module, clock, station, tendency);
  const [first, ...rest] = content.values;
  tile.name.textContent = content.name;
  const { samples, co2Baseline } = tile.series;
  // The outdoor tile has no airing label; its slot carries the forecast.
  const airing = isRoom(module)
    ? windowContent(openWindow(samples, outdoorSamples, co2Baseline), clock)
      ?? airingContent(airingAnswer(samples, outdoorSamples), clock)
    : module.type === 'outdoor' ? forecastContent(forecast, serverNowUtc) : undefined;
  // A reason whose recommendation has gone shows the resting curve until the timer ends.
  const view = tile.curve === REASON && !airing ? RESTING_CURVE : tile.curve;
  // "Vorhersage" and "Lüften?" are nothing but offers to tap, and at night
  // the first tap wakes the tile instead — so the label would promise
  // something it does not do. The airing labels stay: their text is the
  // answer itself.
  const offer = airing?.tone === 'forecast' || airing?.tone === 'ask';
  renderAiring(tile, reduced && offer ? undefined : airing, view === REASON);
  // The forecast stands where a curve otherwise is, and the age line sits
  // right below it — but that age is the Netatmo point's, while the
  // forecast was asked for at its own time. Read there it says the wrong
  // thing, so for the half minute the forecast shows, that line carries the
  // forecast's own source and query time instead. The module's hint
  // goes with the age it belongs to, and the stale mark with it.
  const showingForecast = !reduced && view === REASON && airing?.tone === 'forecast';
  tile.main.replaceChildren(...(first ? [valueNode(first, 'primary', view)] : []));
  tile.secondary.replaceChildren(...rest.map((value) => valueNode(value, 'secondary-value', view)));
  tile.ageText.textContent = showingForecast ? airing.text : content.age;
  tile.hint.textContent = content.hint ?? '';
  tile.hint.hidden = showingForecast || content.hint === null;
  tile.age.classList.toggle('source', showingForecast);
  tile.root.classList.toggle('stale', content.stale);
  tile.root.classList.toggle('awake', tile.awake && mode === 'night');
  tile.secondary.hidden = reduced;
  tile.age.hidden = reduced && !content.stale;
  tile.reason.hidden = reduced || view !== REASON;
  if (reduced || view === REASON) {
    tile.others.hidden = true;
    tile.chart.hidden = true;
    tile.range.hidden = true;
    tile.nightRange.hidden = true;
  } else {
    const curve = view === DAY_RANGE ? RESTING_CURVE : view;
    // At rest on a morning the outdoor tile answers "how cold was the night".
    const night = module.type === 'outdoor' && view === RESTING_CURVE && !tile.week ? nightWindow(serverNowUtc) : null;
    const guides = (isRoom(module) ? GUIDES.room : module.type === 'outdoor' ? GUIDES.outdoor : {})[curve] ?? [];
    const week = tile.week ? weekSamples(module, tile, curve, station) : null;
    renderChart(tile, week
      ? chartContent(week, serverNowUtc, curve, null, WEEK_S, guides)
      : chartContent(curveSamples(tile, curve, station), serverNowUtc, curve, night, WINDOW_S, guides));
    renderOthers(tile, curve === 'humidity' && isRoom(module) ? otherRooms(module, data.modules, clock) : []);
    // Tapping the 24-hour line brought back by the night's tap returns at once, like a curve.
    if (view === DAY_RANGE) tile.range.dataset.key = DAY_RANGE;
    else delete tile.range.dataset.key;
  }
}

function render() {
  const nowMs = Date.now();
  if (data) {
    const clock = { serverNowUtc: data.nowUtc, fetchedAtMs: data.fetchedAtMs, nowMs };
    const serverNowUtc = clock.serverNowUtc + (nowMs - clock.fetchedAtMs) / 1000;
    // The evening and the night are the whole page's, not a tile's.
    const wasNight = mode === 'night';
    mode = forcedMode ?? displayMode(serverNowUtc, forecast, settings);
    if (document.body.dataset.mode !== mode) document.body.dataset.mode = mode;
    // Entering the night arms the screen too, so the wall still goes dark if
    // Fully's schedule is missing or has been switched off.
    if (mode === 'night' && !wasNight) keepDark();
    const station = data.modules.find((module) => module.type === 'base');
    const outdoor = data.modules.find((module) => module.type === 'outdoor');
    const outdoorSamples = (outdoor && tiles.get(outdoor.id)?.series.samples) ?? [];
    // From the series the base tile has fetched anyway; nothing extra on the wire.
    const tendency = station ? pressureTendency(tiles.get(station.id)?.series.samples ?? []) : null;
    const seen = new Set();
    for (const module of data.modules) {
      seen.add(module.id);
      const tile = tileFor(module.id);
      try {
        renderTile(tile, module, { clock, serverNowUtc, station, outdoorSamples, tendency });
      } catch (error) {
        // A tile that fails keeps what it last showed, and its place: the
        // others still render, and the append below keeps the order. Before,
        // the error left the failed tile in front and stopped the page.
        console.error(`tile of module ${module.id} failed to render: ${error.message}`);
      }
      // appendChild moves an existing node, so this also keeps the API's order.
      grid.appendChild(tile.root);
    }
    for (const [id, tile] of tiles) {
      if (!seen.has(id)) {
        clearTimeout(tile.swapBack);
        tile.root.remove();
        tiles.delete(id);
      }
    }
    const { columns, rows } = gridShape(data.modules.length);
    grid.style.setProperty('--columns', columns);
    grid.style.setProperty('--rows', rows);
  }

  // Two different things to do, so both lines when both apply: look at the
  // server, and put the plug back in.
  const lines = [
    serverLine({ ...asked, nowMs }),
    powerHint(tabletPower()),
  ].filter(Boolean);
  status.hidden = lines.length === 0;
  status.replaceChildren(...lines.map((text) => Object.assign(element('span', 'line'), { textContent: text })));
  if (lines.length > 0) {
    // At night the bar is text only and starts where the tiles' text does.
    const firstTile = grid.firstElementChild;
    if (firstTile) status.style.setProperty('--tile-inset', getComputedStyle(firstTile).paddingLeft);
  }

  // Last, once the status line has taken its share of the height.
  for (const tile of tiles.values()) markMore(tile.reason);
  updateDiagnostics?.();
}

/** Fades the reason's edges while more of it is out of sight there. */
function markMore(reason) {
  const below = reason.scrollHeight - reason.clientHeight - reason.scrollTop;
  reason.classList.toggle('above', !reason.hidden && reason.scrollTop > 1);
  reason.classList.toggle('below', !reason.hidden && below > 1);
}

const reloadDue = () => Date.now() - loadedAtMs >= RELOAD_AFTER_MS;

/**
 * A plain `location.reload()` while the WLAN is down replaces the page with the
 * browser's offline error page, and then no script is left to recover. So the
 * reload only happens right after the server answered in full, and only once
 * the page itself has been fetched successfully too.
 *
 * In full means the values and *every* series, fetched in that same ask: a
 * fresh page starts without curves, and on a link that lost most of its
 * packets a page with curves replaced itself with one that never got any.
 * Values alone prove nothing about that, and most asks fetch no
 * series at all, so a due reload makes its ask fetch them all.
 *
 * Even then the reload can hang: a Mac that wakes in the dark for a few
 * seconds answers the HEAD and goes back to sleep before the page's own GET.
 * Until that GET is answered the old page stays on screen, so it keeps
 * asking — the next due tick starts the reload afresh.
 */
async function reload() {
  try {
    await get('/', 'HEAD');
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Asked until the first answer, then never again for this page load. */
async function loadSettings() {
  if (serverZone !== null) return;
  try {
    const body = (await (await get('/api/settings')).json()).settings;
    if (!body) return;
    settings = {
      sunsetOffsetMin: body.sunset_offset_min,
      fallbackAt: body.fallback_at,
      nightFrom: body.night_from,
      dayFrom: body.day_from,
    };
    serverZone = body.time_zone;
  } catch (error) {
    console.warn(`settings failed, keeping the defaults: ${error.message}`);
  }
}

/** A failed ask keeps the last forecast; the server drops one that is too old. */
async function refreshForecast() {
  if (Date.now() - forecastAskedMs < FORECAST_EVERY_MS) return;
  forecastAskedMs = Date.now();
  try {
    forecast = (await (await get('/api/forecast')).json()).forecast;
  } catch (error) {
    console.warn(`forecast failed, keeping the last one: ${error.message}`);
  }
}

async function tick() {
  try {
    const body = await (await get('/api/modules')).json();
    data = { modules: orderTiles(body.modules.filter(hasTile)), nowUtc: body.now_utc, fetchedAtMs: Date.now() };
    const allSeries = reloadDue();
    const seriesMissing = await refreshSeries(data.modules, allSeries);
    asked = afterAsk(asked, { values: true, seriesMissing, atMs: data.fetchedAtMs });
    // A reload under way still renders and arms the next tick: it may never
    // arrive (see reload), and until it does this page is the wall.
    if (!(mayReload(asked, { allSeries }) && (await reload()))) {
      await loadSettings();
      await refreshForecast();
    }
  } catch (error) {
    asked = afterAsk(asked, { values: false });
    console.warn(`fetch failed, keeping the last values: ${error.message}`);
  }
  try {
    render();
  } finally {
    // A chain of timeouts rather than an interval: a slow request can never
    // overlap the next one. It is armed even when the render fails: a broken
    // chain stops the fetches and the hourly reload with them, and the wall
    // then shows one moment for good without looking stale.
    setTimeout(tick, FETCH_EVERY_MS);
  }
}

/**
 * `?diag` shows what Chrome makes of the screen. The type sizes are set in
 * CSS pixels, and only the device can say how many of those it has.
 */
function showDiagnostics() {
  const box = document.getElementById('diag');
  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'unbekannt';
  const hhmm = (utc) =>
    new Date(utc * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  updateDiagnostics = () => {
    const now = new Date();
    // The forecast's days start at the server's midnight and the evening at
    // the tablet's: two zones that must agree.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const serverNowUtc = data ? data.nowUtc + (Date.now() - data.fetchedAtMs) / 1000 : null;
    box.textContent =
      `Viewport ${innerWidth}×${innerHeight} CSS-px · devicePixelRatio ${devicePixelRatio}` +
      ` · Bildschirm ${screen.width}×${screen.height} · Chrome ${chrome}\n` +
      `Modus ${document.body.dataset.mode ?? '–'}${forcedMode ? ' (gepinnt!)' : ''}` +
      ` · Text ${getComputedStyle(document.body).color}` +
      ` · Gerät ${now.toLocaleTimeString('de-DE')} ${now.toTimeString().slice(9, 17)}` +
      ` · Server ${serverNowUtc === null ? 'keine Daten' : hhmm(serverNowUtc)}` +
      ` · Abend ab ${serverNowUtc === null ? '?' : hhmm(eveningStart(serverNowUtc, forecast, settings))}` +
      ` · Vorhersage ${forecast ? 'da' : 'fehlt'}` +
      ` · Zone ${zone}${serverZone && serverZone !== zone ? `, Server ${serverZone} (abweichend!)` : ''}` +
      ` · Kiosk ${kiosk ? 'ja' : 'nein'}`;
  };
  box.hidden = false;
  updateDiagnostics();
  addEventListener('resize', updateDiagnostics);
}

// Two listeners on the page, not one per tile: a tap anywhere counts, and the
// tap that wakes the device may never reach the page at all.
addEventListener('pointerdown', keepDark);
// A screen coming back renders at once: the mode may have changed while it was
// off, and a morning wake should show the day, not the night for up to a minute.
addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
  keepDark();
});

if (new URLSearchParams(location.search).has('diag')) showDiagnostics();
tick();
