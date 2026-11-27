import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW, airChangeRate, co2Rise, coolingRate, openWindow, windowEpisodes, withOutside } from '../public/window.js';

// The frontend's pure module lives in public/ so the browser can load it;
// its tests live here so the server never serves them.

// 2025-09-11, 16:45–18:51 local, as stored. Windows in both rooms were
// tilted at about 17:25 and closed at 17:50, with no one in the rooms afterwards.
const at = (hhmm) => Date.parse(`2025-09-11T${hhmm}:00+02:00`) / 1000;
const toRoom = ([time_utc, temperature, co2]) => ({ time_utc, temperature, ...(co2 !== undefined && { co2 }) });
const WOHNZIMMER = [[1757601914, 24, 625], [1757602217, 24, 602], [1757602520, 24, 587], [1757602823, 24, 589], [1757603126, 24, 558], [1757603429, 24, 585], [1757603732, 24, 562], [1757604035, 23.9, 547], [1757604338, 23.9, 536], [1757604641, 23.8, 462], [1757604943, 23.7, 429], [1757605246, 23.5, 413], [1757605549, 23.5, 415], [1757605852, 23.4, 375], [1757606155, 23.4, 399], [1757606458, 23.4, 409], [1757606762, 23.5, 413], [1757607065, 23.6, 402], [1757607367, 23.6, 409], [1757607670, 23.6, 406], [1757607973, 23.7, 416], [1757608276, 23.7, 409], [1757608579, 23.7, 425], [1757608882, 23.7, 439], [1757609185, 23.7, 427], [1757609488, 23.8, 453]].map(toRoom);
const ARBEITSZIMMER = [[1757602185, 23.4, 765], [1757602492, 23.4, 731], [1757602800, 23.4, 760], [1757603107, 23.4, 752], [1757603415, 23.4, 750], [1757603723, 23.4, 728], [1757604030, 23.4, 763], [1757604287, 23.4, 740], [1757604594, 23.2, 704], [1757604902, 23.1, 630], [1757605209, 23.1, 552], [1757605517, 23, 523], [1757605825, 22.9, 499], [1757606132, 22.8, 470], [1757606440, 22.9, 465], [1757606747, 22.9, 471], [1757607055, 22.9, 464], [1757607363, 22.9, 470], [1757607670, 22.9, 461], [1757607927, 22.9, 463], [1757608234, 22.9, 461], [1757608542, 22.9, 452], [1757608850, 22.9, 457], [1757609157, 22.9, 454], [1757609465, 22.9, 444]].map(toRoom);
const OUTSIDE = [[1757601902, 21.3], [1757602210, 21.3], [1757602518, 21.3], [1757602774, 21.4], [1757603082, 21.4], [1757603389, 21.4], [1757603697, 21.4], [1757604005, 21.5], [1757604312, 21.5], [1757604620, 21.4], [1757604927, 21.3], [1757605235, 21.1], [1757605543, 21], [1757605850, 20.9], [1757606107, 20.9], [1757606414, 20.7], [1757606722, 20.7], [1757607029, 20.6], [1757607337, 20.6], [1757607645, 20.5], [1757607952, 20.4], [1757608260, 20.4], [1757608568, 20.3], [1757608875, 20.1], [1757609183, 20], [1757609439, 19.9]].map(toRoom);
const BASELINE = { wohnzimmer: 414, arbeitszimmer: 399 };

test('the tilted windows of 2025-09-11 are found in the Wohnzimmer by CO₂, at the first point after the opening', () => {
  const [episode, ...rest] = windowEpisodes(WOHNZIMMER, OUTSIDE, BASELINE.wohnzimmer);
  assert.equal(rest.length, 0);
  assert.equal(episode.why, 'co2');
  assert.equal(episode.since, 1757604641, '17:30:41, the first point after the opening');
  assert.deepEqual(episode.from, { co2: 562, temperature: 24 }, 'the start of the fit that found it, 17:12');
  assert.equal(episode.until, 1757606762, '18:06:02, once the room warmed against the outside');
  assert.ok(episode.until - at('17:50') < 20 * 60);
});

test('in the Arbeitszimmer they are found by the room following the outside temperature', () => {
  const [episode, ...rest] = windowEpisodes(ARBEITSZIMMER, OUTSIDE, BASELINE.arbeitszimmer);
  assert.equal(rest.length, 0);
  assert.equal(episode.why, 'cooling');
  assert.equal(episode.since, 1757604902, '17:35:02');
  assert.equal(episode.until, 1757606747, '18:05:47');
  assert.ok(episode.until - at('17:50') < 20 * 60);
});

test('while they were open, the guess is current, with the newest values for its reason', () => {
  const until = (series, hhmm) => series.filter((p) => p.time_utc <= at(hhmm));
  const guess = openWindow(until(WOHNZIMMER, '17:46'), until(OUTSIDE, '17:46'), BASELINE.wohnzimmer);
  assert.equal(guess.why, 'co2');
  assert.equal(guess.until, null);
  assert.equal(guess.atUtc, 1757605549);
  assert.deepEqual(guess.now, { co2: 415, temperature: 23.5, outside: 21 });
  assert.equal(openWindow(until(WOHNZIMMER, '17:20'), until(OUTSIDE, '17:20'), BASELINE.wohnzimmer), null, 'not yet');
  assert.equal(openWindow(WOHNZIMMER, OUTSIDE, BASELINE.wohnzimmer), null, 'closed again');
});

test('without a baseline, CO₂ is not judged and only the temperature can tell', () => {
  const [episode] = windowEpisodes(WOHNZIMMER, OUTSIDE, null);
  assert.equal(episode.why, 'cooling');
  assert.ok(episode.since > at('17:30'));
});

// 2025-09-21, 17:26–19:32 local, as stored. The Wohnzimmer was tilted from
// 17:45 to 19:00 with the outside 3–4 °C warmer, and people in the room.
const WOHNZIMMER_WARM = [[1758468385, 21.8, 674], [1758468688, 21.8, 674], [1758468991, 21.8, 681], [1758469294, 21.9, 698], [1758469597, 21.9, 747], [1758469900, 21.8, 680], [1758470203, 21.8, 616], [1758470506, 21.8, 568], [1758470809, 21.9, 537], [1758471112, 21.9, 508], [1758471415, 21.9, 465], [1758471718, 21.9, 437], [1758472021, 21.9, 450], [1758472324, 21.9, 448], [1758472627, 21.9, 433], [1758472930, 21.9, 414], [1758473233, 22, 407], [1758473536, 22, 407], [1758473839, 21.9, 403], [1758474142, 21.9, 407], [1758474445, 21.9, 407], [1758474748, 21.9, 429], [1758475050, 21.9, 473], [1758475353, 22, 502], [1758475656, 22, 482], [1758475959, 22, 482]].map(toRoom);
const OUTSIDE_WARM = [[1758468367, 26.2], [1758468675, 26.1], [1758468982, 26.2], [1758469290, 26.1], [1758469546, 26.1], [1758469854, 26], [1758470161, 25.9], [1758470469, 25.8], [1758470777, 25.7], [1758471084, 25.6], [1758471392, 25.5], [1758471699, 25.3], [1758472007, 25.2], [1758472315, 25.1], [1758472622, 24.9], [1758472879, 24.8], [1758473186, 24.7], [1758473494, 24.5], [1758473802, 24.3], [1758474109, 24.2], [1758474417, 24], [1758474724, 23.7], [1758475032, 23.4], [1758475340, 23.2], [1758475647, 22.8], [1758475955, 22.4]].map(toRoom);

test('with warm air coming in, the walls hold the room still, and only CO₂ building up again closes the window', () => {
  const [episode, ...rest] = windowEpisodes(WOHNZIMMER_WARM, OUTSIDE_WARM, 414);
  assert.equal(rest.length, 0);
  assert.equal(episode.why, 'co2');
  assert.equal(episode.since, 1758470506, '18:01:46');
  // The room stayed at 21.8–22.0 °C throughout. The quiet rule closed it at 18:42, 18 minutes early.
  assert.equal(episode.until, 1758475353, '19:22:33, CO₂ 88 ppm above the baseline and rising');
  const closed = Date.parse('2025-09-21T19:00:00+02:00') / 1000;
  assert.ok(episode.until > closed && episode.until - closed < 25 * 60);
});

// 2025-09-22, 12:10–14:06 local, as stored. The Arbeitszimmer was tilted from 12:35 to
// 13:30 with the outside 1–2.5 °C warmer, and closed because the outside air
// held more water than the room's.
const ARBEITSZIMMER_WARM = [[1758535807, 21.5], [1758536114, 21.6, 1036], [1758536422, 21.6, 1041], [1758536730, 21.6, 1067], [1758537037, 21.6, 1080], [1758537345, 21.6, 1068], [1758537652, 21.6, 1036], [1758537960, 21.7, 939], [1758538268, 21.7, 872], [1758538575, 21.8, 729], [1758538883, 21.8, 589], [1758539139, 21.8, 553], [1758539447, 21.8, 535], [1758539754, 21.8, 529], [1758540062, 21.8, 514], [1758540370, 21.9, 498], [1758540677, 21.9, 495], [1758540985, 21.9, 506], [1758541293, 21.9, 521], [1758541600, 21.9, 544], [1758541908, 21.9, 552], [1758542215, 21.9, 557], [1758542472, 21.8, 567], [1758542779, 21.8, 568]].map(toRoom);
const OUTSIDE_NOON = [[1758535839, 21.8], [1758536146, 21.9], [1758536454, 22.1], [1758536762, 22.3], [1758537018, 22.5], [1758537325, 22.6], [1758537633, 22.9], [1758537941, 23.1], [1758538248, 23.2], [1758538556, 23.4], [1758538864, 23.6], [1758539171, 23.7], [1758539479, 23.7], [1758539786, 23.9], [1758540094, 24], [1758540350, 24.1], [1758540658, 24.2], [1758540966, 24.3], [1758541273, 24.4], [1758541581, 24.5], [1758541888, 24.6], [1758542196, 24.6], [1758542504, 24.7], [1758542779, 24.7]].map(toRoom);

test('with warm air coming in and the room following it, the temperature finds the window and closes it again', () => {
  const [episode, ...rest] = windowEpisodes(ARBEITSZIMMER_WARM, OUTSIDE_NOON, 376);
  assert.equal(rest.length, 0);
  // Warming towards a warmer outside is the same coupling as cooling towards a colder one.
  assert.equal(episode.why, 'cooling');
  assert.equal(episode.since, 1758538575, '12:56:15, twenty minutes after the opening');
  assert.deepEqual(episode.from, { co2: 1036, temperature: 21.6 }, 'the start of the fit that found it, 12:40, as CO₂ began to fall');
  // Unlike the day before, the room did follow the outside, so the quiet rule is trusted.
  assert.equal(episode.until, 1758541908, '13:51:48, a quarter of an hour after the room stopped warming');
  const closed = Date.parse('2025-09-22T13:30:00+02:00') / 1000;
  assert.ok(episode.until > closed && episode.until - closed < 25 * 60);
});

// 2025-09-22, 19:40–20:54 local, as stored. The Wohnzimmer had one window at
// the front and one at the back wide open from 20:05 to 20:25, a strong
// draught, with the outside 2 °C colder and people staying in the room.
const WOHNZIMMER_DRAUGHT = [[1758562820, 22.3, 935], [1758563022, 22.3, 1014], [1758563326, 22.3, 1035], [1758563629, 22.3, 1035], [1758563932, 22.3, 1038], [1758564235, 22.3, 1095], [1758564538, 22.3, 1100], [1758564841, 22.2, 863], [1758565144, 22.2, 768], [1758565447, 22.2, 706], [1758565750, 22.2, 672], [1758566053, 22.2, 666], [1758566356, 22.2, 654], [1758566659, 22.2, 688], [1758566962, 22.2, 730], [1758567265, 22.2, 692]].map(toRoom);
const OUTSIDE_EVENING = [[1758562806, 21.8], [1758563012, 21.6], [1758563319, 21.3], [1758563627, 21.1], [1758563883, 20.9], [1758564191, 20.6], [1758564498, 20.4], [1758564806, 20.1], [1758565114, 19.9], [1758565421, 19.6], [1758565729, 19.4], [1758566036, 19.2], [1758566344, 18.9], [1758566652, 18.7], [1758566959, 18.5], [1758567216, 18.3]].map(toRoom);

test('an airing shorter than the fit is found only as it ends, and CO₂ building up again closes it', () => {
  const [episode, ...rest] = windowEpisodes(WOHNZIMMER_DRAUGHT, OUTSIDE_EVENING, 414);
  assert.equal(rest.length, 0);
  // The room lost 0.1 °C to the colder outside: the walls held the air, and only CO₂ saw the window.
  assert.equal(episode.why, 'co2');
  // At 20:19 the fit still reached back into the flat minutes before the opening and diluted
  // the decay to 2.8 air changes an hour; the draught itself exchanged about 5.
  assert.equal(episode.since, 1758565447, '20:24:07, one minute before the windows were shut');
  assert.deepEqual(episode.from, { co2: 1100, temperature: 22.3 }, 'the start of the fit that found it, 20:08');
  assert.equal(episode.until, 1758566962, '20:49:22, CO₂ rising again with people in the room');
  const shut = Date.parse('2025-09-22T20:25:00+02:00') / 1000;
  assert.ok(episode.until > shut && episode.until - shut < 25 * 60);
});

const STEP = 300;
const series = (values, key) => values.map((v, i) => ({ time_utc: i * STEP, [key]: v }));

test('the air change rate is the decay of the excess, and needs an excess to judge', () => {
  // The excess over 400 halves every five minutes: ln 2 × 12 per hour.
  const halving = series([800, 600, 500, 450, 425], 'co2');
  assert.ok(Math.abs(airChangeRate(halving, 400) - Math.LN2 * 12) < 1e-9);
  assert.equal(airChangeRate(series([480, 460, 440, 420], 'co2'), 400), null, 'starting excess below 100');
  assert.equal(airChangeRate(series([800, 600, 500, 404], 'co2'), 400), null, 'a point at the baseline');
  assert.equal(airChangeRate(series([800, 600, 500], 'co2'), 400), null, 'too few points');
  assert.equal(airChangeRate(halving, null), null, 'no baseline');
  assert.ok(airChangeRate(series([800, 820, 850, 900], 'co2'), 400) < 0, 'rising CO₂ is a negative rate');
});

test('noise at a small excess does not look like an opening, where a single step would', () => {
  // ±20 ppm around 530 with a baseline of 410: one step from 550 to 510 alone reads as 4/h.
  const noisy = series([530, 550, 510, 540, 520], 'co2');
  assert.ok(Math.log((550 - 410) / (510 - 410)) * 12 > WINDOW.co2Enter);
  assert.ok(airChangeRate(noisy, 410) < WINDOW.co2Enter);
});

test('the cooling rate is relative to the difference, and needs one', () => {
  const cooling = [23, 22.9, 22.8, 22.7].map((temperature, i) => ({ time_utc: i * STEP, temperature, outside: 20.7 }));
  // 1.2 °C per hour with the room 2 °C warmer than outside.
  assert.ok(Math.abs(coolingRate(cooling) - 0.6) < 1e-9);
  const close = cooling.map((p) => ({ ...p, outside: 21.5 }));
  assert.equal(coolingRate(close), null, 'within 1.5 °C of the outside');
  assert.equal(coolingRate(cooling.slice(1)), null, 'too few points');
  assert.equal(coolingRate(cooling.map((p) => ({ ...p, outside: null }))), null, 'no outdoor partner');
  const warmer = [23, 23.1, 23.2, 23.3].map((temperature, i) => ({ time_utc: i * STEP, temperature, outside: 21 }));
  assert.ok(coolingRate(warmer) < 0);
});

test('room points get the nearest outdoor temperature within ten minutes', () => {
  const room = [{ time_utc: 1000, temperature: 21 }, { time_utc: 9000, temperature: 21 }];
  const outdoor = [{ time_utc: 700, temperature: 5 }, { time_utc: 1100, temperature: 6 }, { time_utc: 1150 }];
  assert.deepEqual(withOutside(room, outdoor).map((p) => p.outside), [6, null]);
});

/** A closed room at 22 °C with the outside at 15 °C, plus the given points. */
function scenario(roomTemperatures, outside = 15) {
  const room = roomTemperatures.map((temperature, i) => ({ time_utc: i * STEP, temperature }));
  const outdoor = roomTemperatures.map((_, i) => ({ time_utc: i * STEP, temperature: outside }));
  return [room, outdoor];
}

test('an opening without confirmation ends after three hours', () => {
  // Cooling fast for 20 minutes, then the difference drops below 1.5 °C: nothing to judge.
  const temperatures = [22, 22, 22, 22, 21, 20, 19, 18, 17, 16.4, ...Array(60).fill(16.4)];
  const [room, outdoor] = scenario(temperatures);
  const [episode] = windowEpisodes(room, outdoor, null);
  assert.equal(episode.why, 'cooling');
  assert.equal(episode.until - episode.since, WINDOW.maxOpenS);
});

test('an opening ends once the room has stopped cooling for a quarter of an hour', () => {
  // Cooling, then flat at a clear difference: neither warming nor cooling.
  const temperatures = [22, 22, 22, 22, 21.6, 21.2, 20.8, 20.4, ...Array(20).fill(20.4)];
  const [room, outdoor] = scenario(temperatures);
  const [episode] = windowEpisodes(room, outdoor, null);
  assert.ok(episode.until !== null);
  assert.ok(episode.until - episode.since >= WINDOW.quietS);
  assert.ok(episode.until - episode.since < WINDOW.maxOpenS);
});

test('a closed room that drifts slowly is never open', () => {
  const temperatures = Array.from({ length: 100 }, (_, i) => 22 - i * 0.01);
  const [room, outdoor] = scenario(temperatures);
  assert.deepEqual(windowEpisodes(room, outdoor, null), []);
});

/** A room whose CO₂ fell to its baseline of 400 and whose temperature never moved, plus the given CO₂. */
function stillRoom(co2) {
  const decay = [800, 700, 600, 500, 440, 410, 400, 400, 400];
  const room = [...decay, ...co2].map((c, i) => ({ time_utc: i * STEP, temperature: 22, co2: c }));
  const outdoor = room.map(({ time_utc }) => ({ time_utc, temperature: 26 }));
  return [room, outdoor];
}

test('the rise of CO₂ is its slope in ppm per hour', () => {
  assert.equal(Math.round(co2Rise(series([400, 425, 450, 475], 'co2'))), 300);
  assert.equal(co2Rise(series([400, 425, 450], 'co2')), null, 'too few points');
});

test('an opening the temperature never saw stays open while the room sits at its baseline', () => {
  const [room, outdoor] = stillRoom(Array(60).fill(400));
  const [episode] = windowEpisodes(room, outdoor, 400);
  assert.equal(episode.why, 'co2');
  assert.equal(episode.until - episode.since, WINDOW.maxOpenS);
});

test('it closes once CO₂ builds up well above the baseline', () => {
  const [room, outdoor] = stillRoom([400, 400, 430, 470, 500, 530, ...Array(40).fill(530)]);
  const [episode] = windowEpisodes(room, outdoor, 400);
  assert.equal(episode.until, room.findLast((p) => p.co2 === 500).time_utc);
});

test('a brief bump or noise near the baseline does not close it', () => {
  // Ten minutes of cooking next door, and a sensor wandering 30–70 ppm above.
  const [room, outdoor] = stillRoom([400, 420, 450, 410, 400, 430, 470, 450, 440, 470, 460, ...Array(40).fill(440)]);
  const [episode] = windowEpisodes(room, outdoor, 400);
  assert.equal(episode.until - episode.since, WINDOW.maxOpenS);
});

test('an opening the temperature saw is still closed by the temperature', () => {
  // Cooling fast, then flat at a clear difference, with CO₂ at the baseline all along.
  const temperatures = [22, 22, 22, 22, 21.6, 21.2, 20.8, 20.4, ...Array(20).fill(20.4)];
  const [room, outdoor] = scenario(temperatures);
  const withCo2 = room.map((p) => ({ ...p, co2: 400 }));
  const [episode] = windowEpisodes(withCo2, outdoor, 400);
  assert.ok(episode.until - episode.since < WINDOW.maxOpenS);
});
