// Clock times in a window's reason are local; pin the zone before any Date is made.
process.env.TZ = 'Europe/Berlin';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALE_AFTER_S,
  ageSeconds,
  airingContent,
  otherRooms,
  formatDuration,
  windowContent,
  co2Colour,
  FAILURES_SHOWN,
  NO_ASK,
  afterAsk,
  mayReload,
  seriesDue,
  formatAge,
  serverLine,
  formatNumber,
  hasTile,
  humidityColour,
  orderTiles,
  isStale,
  tileContent,
} from '../public/format.js';

// The frontend's pure module lives in public/ so the browser can load it;
// its tests live here so the server never serves them.

test('numbers use a decimal comma and a fixed number of decimals', () => {
  assert.equal(formatNumber(21.25, 1), '21,3');
  assert.equal(formatNumber(-3, 1), '\u22123,0');
  assert.equal(formatNumber(-0.04, 1), '0,0');
  assert.equal(formatNumber(-0.4, 0), '0');
  assert.equal(formatNumber(-0.06, 1), '\u22120,1');
  assert.equal(formatNumber(57, 0), '57');
  assert.equal(formatNumber(1234, 0), '1234');
});

test('ages read the way the household says them', () => {
  assert.equal(formatAge(-20), 'gerade eben');
  assert.equal(formatAge(59), 'gerade eben');
  assert.equal(formatAge(60), 'vor 1 Min.');
  assert.equal(formatAge(59 * 60 + 59), 'vor 59 Min.');
  assert.equal(formatAge(3600), 'vor 1 Std.');
  assert.equal(formatAge(23 * 3600 + 3599), 'vor 23 Std.');
  assert.equal(formatAge(24 * 3600), 'vor 1 Tag');
  assert.equal(formatAge(3 * 24 * 3600), 'vor 3 Tagen');
});

test('the server line waits for two failed asks in a row', () => {
  const nowMs = 10_000_000;
  const at = (minutes) => ({ contactAtMs: nowMs - minutes * 60_000, answeredAtMs: nowMs - minutes * 60_000 });
  assert.equal(FAILURES_SHOWN, 2);
  assert.equal(serverLine({ failures: 0, partial: false, ...at(1), nowMs }), null);
  assert.equal(serverLine({ failures: 1, partial: false, ...at(2), nowMs }), null);
  assert.equal(
    serverLine({ failures: 2, partial: false, ...at(6), nowMs }),
    'Keine Verbindung zum Server – letzte Antwort vor 6 Min.',
  );
});

test('the server line names no age before the first answer', () => {
  assert.equal(
    serverLine({ failures: 5, partial: false, contactAtMs: null, answeredAtMs: null, nowMs: 10_000_000 }),
    'Keine Verbindung zum Server',
  );
});

test('values without their series are a disturbed link, not a lost server', () => {
  const nowMs = 10_000_000;
  // The tiles beside this line read "vor 2 Min.": the age is the curves', and says so.
  assert.equal(
    serverLine({ failures: 2, partial: true, contactAtMs: nowMs - 5_000, answeredAtMs: nowMs - 3 * 3600_000, nowMs }),
    'Verbindung zum Server gestört – letzte Kurven vor 3 Std.',
  );
  // A fresh page whose series never came.
  assert.equal(
    serverLine({ failures: 5, partial: true, contactAtMs: nowMs - 5_000, answeredAtMs: null, nowMs }),
    'Verbindung zum Server gestört – keine Kurven',
  );
});

test('a lost server is aged by the last contact, not by the last full answer', () => {
  const nowMs = 10_000_000;
  // Values came five minutes ago without a series, then nothing: "vor 3 Std." would contradict the tiles.
  assert.equal(
    serverLine({ failures: 6, partial: false, contactAtMs: nowMs - 5 * 60_000, answeredAtMs: nowMs - 3 * 3600_000, nowMs }),
    'Keine Verbindung zum Server – letzte Antwort vor 5 Min.',
  );
});

test('an ask is answered only by the values and every series that was due', () => {
  const full = afterAsk(NO_ASK, { values: true, seriesMissing: false, atMs: 1_000 });
  assert.deepEqual(full, { failures: 0, partial: false, contactAtMs: 1_000, answeredAtMs: 1_000 });

  // Values without a series: a failure, although the server answered.
  const partial = afterAsk(full, { values: true, seriesMissing: true, atMs: 2_000 });
  assert.deepEqual(partial, { failures: 1, partial: true, contactAtMs: 2_000, answeredAtMs: 1_000 });

  // No values: both times stay where they were.
  const lost = afterAsk(partial, { values: false });
  assert.deepEqual(lost, { failures: 2, partial: false, contactAtMs: 2_000, answeredAtMs: 1_000 });

  assert.equal(afterAsk(lost, { values: true, seriesMissing: false, atMs: 3_000 }).failures, 0);
});

test('a series is fetched for a new point, and every series once the reload is due', () => {
  assert.equal(seriesDue({ newest: 200, held: 100, all: false }), true);
  assert.equal(seriesDue({ newest: 200, held: 200, all: false }), false);
  assert.equal(seriesDue({ newest: 200, held: 200, all: true }), true);
  // A module without a point has no series, due reload or not.
  assert.equal(seriesDue({ newest: null, held: null, all: true }), false);
});

test('the reload waits for an ask that fetched every series and lost none', () => {
  const full = afterAsk(NO_ASK, { values: true, seriesMissing: false, atMs: 1_000 });
  // The ordinary ask: answered, but it fetched no series and proves nothing about them.
  assert.equal(mayReload(full, { allSeries: false }), false);
  assert.equal(mayReload(full, { allSeries: true }), true);
  const partial = afterAsk(full, { values: true, seriesMissing: true, atMs: 2_000 });
  assert.equal(mayReload(partial, { allSeries: true }), false);
  assert.equal(mayReload(afterAsk(full, { values: false }), { allSeries: true }), false);
});

test('the age runs on the server clock, advanced by the time since the fetch', () => {
  const clock = { serverNowUtc: 10_000, fetchedAtMs: 5_000_000, nowMs: 5_090_000 };
  assert.equal(ageSeconds({ timeUtc: 9_400, ...clock }), 600 + 90);
});

test('a tablet clock behind the fetch time does not make a value younger', () => {
  const clock = { serverNowUtc: 10_000, fetchedAtMs: 5_000_000, nowMs: 4_000_000 };
  assert.equal(ageSeconds({ timeUtc: 9_400, ...clock }), 600);
});

test('a value turns stale only after one missed cycle on top of the normal delay', () => {
  assert.equal(isStale(20 * 60), false);
  assert.equal(isStale(STALE_AFTER_S), false);
  assert.equal(isStale(STALE_AFTER_S + 1), true);
});

const clock = { serverNowUtc: 10_000, fetchedAtMs: 0, nowMs: 0 };

test('an indoor tile shows temperature first, then humidity and CO₂', () => {
  const content = tileContent({
    name: 'Arbeitszimmer',
    type: 'indoor',
    latest: { time_utc: 10_000 - 720, values: { co2: 590, humidity: 56, temperature: 23.7 } },
  }, clock);
  assert.deepEqual(content, {
    name: 'Arbeitszimmer',
    values: [
      { key: 'temperature', text: '23,7', unit: '°C' },
      { key: 'humidity', text: '56', unit: '%', colour: humidityColour(56) },
      { key: 'co2', text: '590', unit: 'ppm', colour: co2Colour(590) },
    ],
    age: 'vor 12 Min.',
    stale: false,
    hint: null,
  });
});

test('a value the module measures but its newest point lacks stays as a tappable dash', () => {
  // The Arbeitszimmer on 2025-09-15 at 21:07: temperature and humidity, no CO₂.
  const values = (type, pointValues) =>
    tileContent({ name: type, type, latest: { time_utc: 10_000, values: pointValues } }, clock).values;
  assert.deepEqual(values('indoor', { temperature: 20.8, humidity: 57 }), [
    { key: 'temperature', text: '20,8', unit: '°C' },
    { key: 'humidity', text: '57', unit: '%', colour: humidityColour(57) },
    { key: 'co2', text: '–', unit: 'ppm', missing: true },
  ]);
  assert.deepEqual(values('base', { humidity: 50, co2: 700 }).map((v) => [v.key, v.text]),
    [['temperature', '–'], ['humidity', '50'], ['co2', '700']], 'the order stays, the large value too');
  assert.deepEqual(values('outdoor', { temperature: 5 }).map((v) => [v.key, v.text]),
    [['temperature', '5,0'], ['humidity', '–']]);
  assert.deepEqual(values('outdoor', { temperature: 5, humidity: 90 }).map((v) => v.key), ['temperature', 'humidity'],
    'outside has no CO₂ to miss');
  assert.deepEqual(values('rain', { temperature: 5 }).map((v) => v.key), ['temperature'],
    'an unknown type shows only what it has');
});

const hue = (colour) => Number(/^hsl\((\d+) /.exec(colour)[1]);
// Saturation and lightness are the page's, so the night dims these too.
const SHADE = 'var(--value-saturation, 65%) var(--value-lightness, 62%)';

test('humidity is coloured by comfort, each hue at exactly one humidity band', () => {
  assert.equal(humidityColour(20), `hsl(0 ${SHADE})`, 'too dry: red');
  assert.equal(hue(humidityColour(30)), 0);
  assert.equal(hue(humidityColour(35)), 28, 'orange');
  assert.equal(hue(humidityColour(40)), 52, 'yellow');
  for (const rh of [45, 50, 55]) assert.equal(hue(humidityColour(rh)), 130, `comfort at ${rh} %`);
  assert.equal(hue(humidityColour(60)), 175, 'teal');
  assert.equal(hue(humidityColour(65)), 212, 'blue');
  assert.equal(hue(humidityColour(95)), 212, 'too damp stays blue');
});

test('the humidity colour moves continuously and never turns back', () => {
  assert.equal(hue(humidityColour(32.5)), 14);
  assert.equal(hue(humidityColour(57.5)), 153);
  let previous = -1;
  for (let rh = 0; rh <= 100; rh += 0.5) {
    const current = hue(humidityColour(rh));
    assert.ok(current >= previous, `${rh} %: ${current} after ${previous}`);
    previous = current;
  }
});

test('CO₂ runs from green through yellow to red', () => {
  assert.equal(co2Colour(420), `hsl(130 ${SHADE})`, 'outdoor level: green');
  assert.equal(hue(co2Colour(800)), 130, 'still good');
  assert.equal(hue(co2Colour(900)), 91);
  assert.equal(hue(co2Colour(1000)), 52, 'still acceptable: yellow');
  assert.equal(hue(co2Colour(1200)), 28, 'orange');
  assert.equal(hue(co2Colour(1400)), 0, 'air the room: red');
  assert.equal(hue(co2Colour(3000)), 0);
  let previous = Infinity;
  for (let ppm = 300; ppm <= 2000; ppm += 10) {
    const current = hue(co2Colour(ppm));
    assert.ok(current <= previous, `${ppm} ppm: ${current} after ${previous}`);
    previous = current;
  }
});

test('only rooms colour their humidity and CO₂, outside says nothing about comfort', () => {
  const latest = { time_utc: 10_000, values: { temperature: 5, humidity: 90, co2: 1500 } };
  const humidity = (type) => tileContent({ name: type, type, latest }, clock).values[1];
  assert.equal(humidity('base').colour, humidityColour(90));
  assert.equal(humidity('indoor').colour, humidityColour(90));
  assert.equal('colour' in humidity('outdoor'), false);
  const co2 = (type) => tileContent({ name: type, type, latest }, clock).values[2];
  assert.equal(co2('indoor').colour, co2Colour(1500));
  assert.equal('colour' in co2('outdoor'), false, 'a colour needs a room');
  assert.equal('colour' in tileContent({ name: 'x', type: 'indoor', latest }, clock).values[0], false,
    'temperature carries no colour');
});

test('quantities a tile does not answer a question with are left out', () => {
  const content = tileContent({
    name: 'Wohnzimmer',
    latest: { time_utc: 10_000, values: { temperature: 24.5, pressure: 1015.9, noise: 34 } },
  }, clock);
  assert.deepEqual(content.values.map((v) => v.key), ['temperature']);
});

const base = (timeUtc, values) => ({ name: 'Wohnzimmer', type: 'base', latest: { time_utc: timeUtc, values } });
const outdoor = { name: 'Außen', type: 'outdoor', latest: { time_utc: 10_000, values: { temperature: 5, humidity: 90 } } };

test('the outdoor tile shows the base unit\'s pressure after its humidity', () => {
  const content = tileContent(outdoor, clock, base(10_000 - 600, { temperature: 21, pressure: 1013.6 }));
  assert.deepEqual(content.values.slice(1), [
    { key: 'humidity', text: '90', unit: '%' },
    { key: 'pressure', text: '1014', unit: 'hPa' },
  ]);
});

test('no pressure outside without a fresh base unit reading', () => {
  const keys = (station) => tileContent(outdoor, clock, station).values.map((v) => v.key);
  assert.deepEqual(keys(undefined), ['temperature', 'humidity'], 'no base unit');
  assert.deepEqual(keys({ name: 'Wohnzimmer', type: 'base', latest: null }), ['temperature', 'humidity'], 'no values yet');
  assert.deepEqual(keys(base(10_000, { temperature: 21 })), ['temperature', 'humidity'], 'no pressure');
  assert.deepEqual(keys(base(10_000 - STALE_AFTER_S, { pressure: 1000 })), ['temperature', 'humidity', 'pressure'],
    'just not stale');
  assert.deepEqual(keys(base(10_000 - STALE_AFTER_S - 1, { pressure: 1000 })), ['temperature', 'humidity'], 'stale');
});

test('the outdoor pressure carries its tendency as a rotated arrow', () => {
  const station = base(10_000, { pressure: 1009 });
  const pressure = (tendency) => tileContent(outdoor, clock, station, tendency).values[2];
  const trend = (level) => pressure({ delta: level, level, atUtc: 10_000 }).trend;
  assert.deepEqual(trend(2), { angle: -90, label: 'steigt stark' });
  assert.deepEqual(trend(1), { angle: -45, label: 'steigt' });
  assert.deepEqual(trend(0), { angle: 0, label: 'gleichbleibend' });
  assert.deepEqual(trend(-1), { angle: 45, label: 'fällt' });
  assert.deepEqual(trend(-2), { angle: 90, label: 'fällt stark' });
  assert.equal('trend' in pressure(null), false, 'no tendency, no arrow');
  assert.equal('trend' in pressure(undefined), false);
  assert.equal('trend' in pressure({ delta: -2, level: -1, atUtc: 10_000 - STALE_AFTER_S - 1 }), false,
    'a stale tendency says nothing about now');
});

test('only the outdoor tile borrows the pressure', () => {
  const station = base(10_000, { temperature: 21, humidity: 50, pressure: 1013 });
  for (const module of [station, { ...outdoor, type: 'indoor' }]) {
    const keys = tileContent(module, clock, station).values.map((v) => v.key);
    assert.equal(keys.includes('pressure'), false, module.type);
  }
});

test('an old value is marked stale', () => {
  const content = tileContent({
    name: 'Außen',
    latest: { time_utc: 10_000 - 2 * 3600, values: { temperature: 5 } },
  }, clock);
  assert.equal(content.age, 'vor 2 Std.');
  assert.equal(content.stale, true);
});

test('a module without any value says so and counts as stale', () => {
  assert.deepEqual(tileContent({ name: 'Neu', latest: null }, clock), {
    name: 'Neu',
    values: [],
    age: 'noch keine Werte',
    stale: true,
    hint: null,
  });
});

test('a tile carries the status hint of its module, judged against its own staleness', () => {
  const status = { time_utc: 10_000, reachable: true, battery_percent: 82, rf_status: 92, wifi_status: null };
  const outdoor = (age) => ({ name: 'Außen', type: 'outdoor', latest: { time_utc: 10_000 - age, values: { temperature: 12 } }, status });
  assert.equal(tileContent(outdoor(600), clock).hint, null);
  assert.equal(tileContent(outdoor(3600), clock).hint, 'Funk schwach');
});

test('rain and wind modules get no tile, every other module does', () => {
  for (const type of ['base', 'outdoor', 'indoor', 'NAModule9']) assert.equal(hasTile({ type }), true, type);
  for (const type of ['rain', 'wind']) assert.equal(hasTile({ type }), false, type);
});

const names = (modules) => modules.map((m) => m.name);

test('outdoor comes first, then the base unit, then the indoor rooms', () => {
  const api = [
    { id: 1, type: 'base', name: 'Wohnzimmer' },
    { id: 2, type: 'outdoor', name: 'Außen' },
    { id: 3, type: 'indoor', name: 'Arbeitszimmer' },
  ];
  assert.deepEqual(names(orderTiles(api)), ['Außen', 'Wohnzimmer', 'Arbeitszimmer']);
  assert.deepEqual(names(api), ['Wohnzimmer', 'Außen', 'Arbeitszimmer'], 'the input is left alone');
});

test('modules of the same type keep the API order, unknown types go last', () => {
  const api = [
    { id: 1, type: 'NAModule9', name: 'Neu' },
    { id: 2, type: 'indoor', name: 'Schlafzimmer' },
    { id: 3, type: 'base', name: 'Wohnzimmer' },
    { id: 4, type: 'indoor', name: 'Arbeitszimmer' },
    { id: 5, type: 'outdoor', name: 'Außen' },
  ];
  assert.deepEqual(names(orderTiles(api)), ['Außen', 'Wohnzimmer', 'Schlafzimmer', 'Arbeitszimmer', 'Neu']);
});

const recommendation = (fields) => ({
  inside: { temperature: 23.4, humidity: 62, water: 12.73, co2: 1180 },
  outside: { temperature: 25.06, humidity: 75, water: 17.31, inRoom: 83.2 },
  atUtc: 10_000,
  ...fields,
});

const TABLE = {
  head: ['Drinnen', 'Draußen'],
  rows: [['1180', '', 'ppm'], ['23,4', '25,1', '°C'], ['62', '75 → 83', '%']],
};

test('an airing recommendation becomes a label, every value inside against outside, and a sentence', () => {
  assert.deepEqual(airingContent(recommendation({ action: 'dont', reason: 'humid' }), clock), {
    label: 'Nicht lüften',
    tone: 'dont',
    ...TABLE,
    text: 'Die Außenluft hätte drinnen 83\u00a0% – Lüften macht den Raum feuchter.',
  });
  assert.deepEqual(airingContent(recommendation({ action: 'air', reason: 'dry' }), clock).text,
    'Die Außenluft hätte drinnen nur 83\u00a0% – Lüften trocknet den Raum.');
  const cool = airingContent(recommendation({ action: 'air', reason: 'cool' }), clock);
  assert.deepEqual([cool.label, cool.tone, cool.rows], ['Lüften', 'air', TABLE.rows], 'the whole table, not only the rule\'s values');
  assert.equal(airingContent(recommendation({ action: 'dont', reason: 'hot' }), clock).text,
    'Draußen ist es wärmer – Lüften heizt den Raum auf.');
});

test('a room without CO₂ has no CO₂ row', () => {
  const { inside } = recommendation({});
  const { co2, ...rest } = inside;
  const content = airingContent(recommendation({ action: 'air', reason: 'dry', inside: rest }), clock);
  assert.deepEqual(content.rows, TABLE.rows.slice(1));
});

test('CO₂ names the limit, and a brief airing says why it is brief', () => {
  const air = airingContent(recommendation({ action: 'air', reason: 'co2' }), clock);
  assert.deepEqual([air.label, air.tone, air.text], ['Lüften', 'air', 'Ab 1000\u00a0ppm ist die Luft verbraucht.']);
  const brief = airingContent(recommendation({ action: 'brief', reason: 'co2', caveat: 'humid' }), clock);
  assert.deepEqual([brief.label, brief.tone, brief.text],
    ['Kurz lüften', 'air', 'Ab 1000\u00a0ppm ist die Luft verbraucht. Die Außenluft hätte drinnen 83\u00a0% – nur kurz.']);
  assert.equal(airingContent(recommendation({ action: 'brief', reason: 'co2', caveat: 'hot' }), clock).text,
    'Ab 1000\u00a0ppm ist die Luft verbraucht. Draußen ist es wärmer – nur kurz.');
});

const ask = (fields) => airingContent(recommendation({ action: 'ask', humid: false, warm: false, water: null, temperature: null, ...fields }), clock);

test('without a rule the room can be asked, and the answer says what airing would do', () => {
  const quiet = ask({});
  assert.deepEqual([quiet.label, quiet.tone, quiet.rows], ['Lüften?', 'ask', TABLE.rows]);
  assert.equal(quiet.text, 'Kein Grund zu lüften. Die Außenluft hätte drinnen 83\u00a0% – Lüften ändert die Feuchte kaum. Lüften ändert die Temperatur kaum.');
  const winter = { temperature: 5, humidity: 90, water: 6.1, inRoom: 31.6 };
  assert.equal(ask({ water: 'drier', temperature: 'cooler', outside: winter }).text,
    'Kein Grund zu lüften. Die Außenluft hätte drinnen nur 32\u00a0% – Lüften trocknet den Raum. Draußen ist es kühler – Lüften kühlt den Raum.');
  assert.equal(ask({ water: 'wetter', temperature: 'warmer' }).text,
    'Kein Grund zu lüften. Die Außenluft hätte drinnen 83\u00a0% – Lüften macht den Raum feuchter. Draußen ist es wärmer – Lüften wärmt den Raum.');
});

test('no reason sentence can break a line between a number and its unit', () => {
  const texts = [
    ...['humid', 'dry', 'hot', 'cool'].map((reason) => recommendation({ action: 'air', reason })),
    ...['humid', 'hot'].map((caveat) => recommendation({ action: 'brief', reason: 'co2', caveat })),
    ...['drier', 'wetter', 'same'].map((water) => recommendation({ action: 'ask', water, temperature: 'warmer' })),
    recommendation({ action: 'ask', humid: true, warm: true, water: null, temperature: null }),
    recommendation({ action: 'dont', reason: 'humid', outside: { temperature: 28, humidity: 90, water: 24.5, inRoom: 108.4 } }),
  ].map((r) => airingContent(r, clock).text);
  for (const text of texts) assert.doesNotMatch(text, /\d (%|ppm)|≥ \d/, text);
});

test('air that would condense in the room stops at 100 %', () => {
  const wet = recommendation({ action: 'dont', reason: 'humid', outside: { temperature: 28, humidity: 90, water: 24.5, inRoom: 108.4 } });
  const content = airingContent(wet, clock);
  assert.deepEqual(content.rows.at(-1), ['62', '90 → ≥\u00a0100', '%']);
  assert.equal(content.text, 'Die Außenluft hätte drinnen ≥\u00a0100\u00a0% – Lüften macht den Raum feuchter.');
  assert.equal(airingContent(recommendation({ action: 'dont', reason: 'humid', outside: { ...wet.outside, inRoom: 99.6 } }), clock).rows.at(-1)[1],
    '90 → 100', 'rounded, not marked');
});

test('a humid or warm room without the outside to act on it says so', () => {
  assert.equal(ask({ humid: true, warm: true }).text,
    'Kein Grund zu lüften. Der Raum ist feucht, doch die Außenluft hätte drinnen 83\u00a0% – Lüften trocknet kaum. Der Raum ist warm, doch Lüften kühlt ihn kaum.');
});

test('no answer, or a stale one, shows nothing', () => {
  assert.equal(airingContent(null, clock), undefined);
  assert.equal(ask({ atUtc: 10_000 - STALE_AFTER_S - 1 }), undefined);
  assert.equal(airingContent(recommendation({ action: 'air', reason: 'co2', atUtc: 10_000 - STALE_AFTER_S - 1 }), clock), undefined);
  assert.notEqual(airingContent(recommendation({ action: 'air', reason: 'co2', atUtc: 10_000 - STALE_AFTER_S }), clock), undefined);
});

test('how long a window is open reads in minutes, then hours', () => {
  assert.equal(formatDuration(-5), '0 Min.');
  assert.equal(formatDuration(25 * 60 + 59), '25 Min.');
  assert.equal(formatDuration(3600), '1 Std.');
  assert.equal(formatDuration(3600 + 5 * 60), '1 Std. 5 Min.');
});

const guess = (fields) => ({
  since: 10_000 - 25 * 60,
  until: null,
  atUtc: 10_000,
  from: { co2: 562, temperature: 24 },
  now: { co2: 415, temperature: 23.46, outside: 20.94 },
  ...fields,
});

test('an open window found by CO₂ takes the label, and the reason says since when and why', () => {
  // 10,000 − 1,500 s is 1970-01-01 02:21:40 UTC, 03:21 in Berlin (CET).
  assert.deepEqual(windowContent(guess({ why: 'co2' }), clock), {
    label: 'Fenster auf?',
    tone: 'window',
    rows: [['Seit', '03:21 · 25 Min.'], ['CO₂', '562 → 415 ppm']],
    text: 'So schnell fällt CO₂ nur bei offenem Fenster. Nach dem Schließen bleibt der Hinweis noch eine Weile stehen.',
  });
});

test('an open window found by cooling shows the temperatures', () => {
  const content = windowContent(guess({ why: 'cooling' }), clock);
  assert.deepEqual(content.rows, [['Seit', '03:21 · 25 Min.'], ['Drinnen', '24,0 → 23,5 °C'], ['Draußen', '20,9 °C']]);
  assert.match(content.text, /^So schnell folgt der Raum der Außenluft/);
});

test('a value the newest point lacks is a dash in the reason, not a crash', () => {
  // A real point came without CO₂ during an opening found by CO₂, and the wall froze.
  const co2 = windowContent(guess({ why: 'co2', now: { co2: null, temperature: 19.8, outside: 11.6 } }), clock);
  assert.deepEqual(co2.rows[1], ['CO₂', '562 → – ppm']);
  const cooling = windowContent(guess({ why: 'cooling', now: { co2: 415, temperature: null, outside: null } }), clock);
  assert.deepEqual(cooling.rows.slice(1), [['Drinnen', '24,0 → – °C'], ['Draußen', '– °C']]);
});

test('no guess, or a stale one, shows nothing', () => {
  assert.equal(windowContent(null, clock), undefined);
  assert.equal(windowContent(guess({ why: 'co2', atUtc: 10_000 - STALE_AFTER_S - 1 }), clock), undefined);
});

const room = (id, name, values, timeUtc = 10_000, type = 'indoor') => ({ id, type, name, latest: { time_utc: timeUtc, values } });

test('the other rooms\' air is said in this room\'s terms', () => {
  // A real pair of rooms: the same air, a degree apart.
  const wohnzimmer = room(1, 'Wohnzimmer', { temperature: 21.6, humidity: 50 }, 10_000, 'base');
  const arbeitszimmer = room(3, 'Arbeitszimmer', { temperature: 20.6, humidity: 52 });
  const outdoor = room(2, 'Außen', { temperature: 5, humidity: 90 }, 10_000, 'outdoor');
  const modules = [wohnzimmer, outdoor, arbeitszimmer];
  assert.deepEqual(otherRooms(wohnzimmer, modules, clock), [{ label: 'Arbeitszimmer-Luft hier:', value: '49\u00a0%' }], 'outside is not a room');
  assert.deepEqual(otherRooms(arbeitszimmer, modules, clock), [{ label: 'Wohnzimmer-Luft hier:', value: '53\u00a0%' }]);
  assert.deepEqual(otherRooms(wohnzimmer, [wohnzimmer, outdoor], clock), [], 'nothing to compare with');
});

test('a stale or incomplete room is left out, and air that would condense stops at 100 %', () => {
  const here = room(1, 'Wohnzimmer', { temperature: 18, humidity: 50 }, 10_000, 'base');
  const stale = room(3, 'Arbeitszimmer', { temperature: 20, humidity: 50 }, 10_000 - STALE_AFTER_S - 1);
  const partial = room(4, 'Schlafzimmer', { temperature: 20 });
  const damp = room(5, 'Bad', { temperature: 24, humidity: 90 });
  assert.deepEqual(otherRooms(here, [here, stale, partial, damp], clock), [{ label: 'Bad-Luft hier:', value: '≥\u00a0100\u00a0%' }]);
  assert.deepEqual(otherRooms(room(1, 'Wohnzimmer', { humidity: 50 }), [here, damp], clock), [], 'no temperature here');
});
