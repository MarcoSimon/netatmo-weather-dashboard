import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, PAIR_S, airingAnswer, airingRecommendation, latched, pairs } from '../public/airing.js';
import { absoluteHumidity, humidityAt } from '../public/humidity.js';

// The frontend's pure module lives in public/ so the browser can load it;
// its tests live here so the server never serves them.

const STEP = 300;
/** A series of `count` points, five minutes apart, all with the same values. */
const steady = (values, count = 12, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({ time_utc: offset + i * STEP, ...values }));
const decide = (room, outdoor) => {
  const result = airingRecommendation(steady(room), steady(outdoor, 12, 20));
  return result && { action: result.action, reason: result.reason, ...(result.caveat && { caveat: result.caveat }) };
};

// A comfortable room and mild weather: nothing to say.
const ROOM = { temperature: 21, humidity: 50, co2: 600 };
const MILD = { temperature: 15, humidity: 70 };

test('a condition holds between its thresholds until it is left', () => {
  const band = { enter: 60, leave: 58 };
  assert.equal(latched([55, 59, 59], band), false, 'never entered');
  assert.equal(latched([55, 60, 59, 58], band), true, 'entered, still in the band');
  assert.equal(latched([60, 59, 57.9, 59], band), false, 'left, back in the band');
  assert.equal(latched([57, 61, null, undefined], band), true, 'gaps are skipped');
  assert.equal(latched([], band), false);
  assert.equal(latched([59, 59], band), false, 'the band alone is off');
});

test('room points are paired with the nearest outdoor point within ten minutes', () => {
  const room = [{ time_utc: 1000, temperature: 21, humidity: 50 }, { time_utc: 5000, temperature: 21, humidity: 50 }];
  const outdoor = [
    { time_utc: 700, temperature: 5, humidity: 90 },
    { time_utc: 1100, temperature: 6, humidity: 90 },
    { time_utc: 1150, temperature: 7 },
    { time_utc: 5000 + PAIR_S + 1, temperature: 8, humidity: 90 },
  ];
  const paired = pairs(room, outdoor);
  assert.equal(paired.length, 1, 'the second room point has no partner close enough');
  assert.equal(paired[0].outside.temperature, 6, 'nearest, and with both values');
});

test('without an outdoor partner there is no recommendation', () => {
  assert.equal(airingRecommendation(steady({ ...ROOM, co2: 1500 }), []), null);
  assert.equal(airingRecommendation([], steady(MILD)), null);
});

test('a comfortable room gets no recommendation', () => {
  assert.equal(decide(ROOM, MILD), null);
});

test('high CO₂ means airing', () => {
  assert.deepEqual(decide({ ...ROOM, co2: CONDITIONS.co2High.enter }, MILD), { action: 'air', reason: 'co2' });
  assert.equal(decide({ ...ROOM, co2: 999 }, MILD), null);
});

test('humid cold air dries a humid room — the trap in its winter form', () => {
  // 90 % at 5 °C outside is 6.1 g/m³, 62 % at 21 °C inside 11.4 g/m³.
  assert.deepEqual(decide({ ...ROOM, humidity: 62 }, { temperature: 5, humidity: 90 }), { action: 'air', reason: 'dry' });
});

test('a humid room is not aired when the outside air holds more water', () => {
  // A summer day: 25 °C and 75 % outside is 17.3 g/m³, 62 % at 23 °C inside 12.7.
  const summer = { temperature: 25, humidity: 75 };
  assert.ok(absoluteHumidity(25, 75) > absoluteHumidity(23, 62));
  assert.deepEqual(decide({ ...ROOM, temperature: 23, humidity: 62 }, summer), { action: 'dont', reason: 'humid' });
});

test('less than 1 g/m³ of difference decides nothing', () => {
  // 21 °C and 62 % inside is 11.4 g/m³; outside 16 °C at 82 % is 11.1.
  assert.equal(decide({ ...ROOM, humidity: 62 }, { temperature: 16, humidity: 82 }), null);
});

test('a warm room is not aired when it is warmer outside, and aired when it is clearly cooler', () => {
  const warmRoom = { ...ROOM, temperature: 25, humidity: 50 };
  assert.deepEqual(decide(warmRoom, { temperature: 28, humidity: 40 }), { action: 'dont', reason: 'hot' });
  assert.deepEqual(decide(warmRoom, { temperature: 20, humidity: 60 }), { action: 'air', reason: 'cool' });
  assert.equal(decide(warmRoom, { temperature: 23, humidity: 60 }), null, 'only 2 °C cooler');
  assert.equal(decide({ ...warmRoom, temperature: 23 }, { temperature: 15, humidity: 60 }), null, 'not warm');
});

test('the humidity trap beats cooling', () => {
  // Warm, humid room; outside cooler but holding more water.
  const room = { ...ROOM, temperature: 26, humidity: 62 };
  const night = { temperature: 22, humidity: 95 };
  assert.ok(absoluteHumidity(22, 95) > absoluteHumidity(26, 62) + 1);
  assert.deepEqual(decide(room, night), { action: 'dont', reason: 'humid' });
});

test('high CO₂ still means airing, only briefly when airing would harm otherwise', () => {
  const summer = { temperature: 25, humidity: 75 };
  assert.deepEqual(decide({ temperature: 23, humidity: 62, co2: 1200 }, summer),
    { action: 'brief', reason: 'co2', caveat: 'humid' });
  assert.deepEqual(decide({ temperature: 25, humidity: 50, co2: 1200 }, { temperature: 28, humidity: 40 }),
    { action: 'brief', reason: 'co2', caveat: 'hot' });
  assert.deepEqual(decide({ temperature: 25, humidity: 50, co2: 1200 }, { temperature: 20, humidity: 60 }),
    { action: 'air', reason: 'co2' }, 'cooling does not shorten it');
});

test('a recommendation stays while CO₂ falls through the band, and ends below it', () => {
  const room = [1200, 1100, 950, 920].map((co2, i) => ({ time_utc: i * STEP, ...ROOM, co2 }));
  const outdoor = steady(MILD, 4);
  assert.equal(airingRecommendation(room, outdoor)?.reason, 'co2', 'still above 900');
  room.push({ time_utc: 4 * STEP, ...ROOM, co2: 890 });
  outdoor.push({ time_utc: 4 * STEP, ...MILD });
  assert.equal(airingRecommendation(room, outdoor), null);
  room.push({ time_utc: 5 * STEP, ...ROOM, co2: 950 });
  outdoor.push({ time_utc: 5 * STEP, ...MILD });
  assert.equal(airingRecommendation(room, outdoor), null, 'the band alone does not switch it back on');
});

test('the drying recommendation does not flicker on a single step of humidity', () => {
  // Outside 6.1 g/m³. At 21 °C, 60 % is 11.0 g/m³ and 59 % is 10.8 — both in, and the room stays humid.
  const outdoor = steady({ temperature: 5, humidity: 90 }, 5);
  const room = [61, 60, 59, 59, 58].map((humidity, i) => ({ time_utc: i * STEP, ...ROOM, humidity }));
  assert.equal(airingRecommendation(room, outdoor)?.reason, 'dry');
  room.push({ time_utc: 5 * STEP, ...ROOM, humidity: 57 });
  outdoor.push({ time_utc: 5 * STEP, temperature: 5, humidity: 90 });
  assert.equal(airingRecommendation(room, outdoor), null);
});

test('the recommendation carries the newest values it rests on and their age', () => {
  const room = steady({ temperature: 21, humidity: 62, co2: 700 });
  const outdoor = steady({ temperature: 5, humidity: 90 }, 12, 20);
  const result = airingRecommendation(room, outdoor);
  assert.equal(result.inside.temperature, 21);
  assert.equal(result.inside.humidity, 62);
  assert.equal(result.inside.co2, 700);
  assert.equal(result.inside.water, absoluteHumidity(21, 62));
  assert.deepEqual({ ...result.outside, water: undefined, inRoom: undefined }, { temperature: 5, humidity: 90, water: undefined, inRoom: undefined });
  assert.equal(result.outside.inRoom, humidityAt(5, 90, 21), 'the outside air at the room\'s temperature');
  assert.equal(result.atUtc, 11 * STEP, 'the older point of the newest pair');
  // An outdoor module that stopped reporting: the pair, and so the age, stays old.
  const late = [...room, { time_utc: 40 * STEP, ...room[0] }];
  assert.equal(airingRecommendation(late, outdoor).atUtc, 11 * STEP);
});

test('a room without a CO₂ sensor is still judged on humidity', () => {
  const result = airingRecommendation(steady({ temperature: 21, humidity: 62 }), steady({ temperature: 5, humidity: 90 }));
  assert.equal(result.reason, 'dry');
  assert.equal('co2' in result.inside, false);
});

const answer = (room, outdoor) => {
  const result = airingAnswer(steady(room), steady(outdoor, 12, 20));
  return result && { action: result.action, humid: result.humid, warm: result.warm, water: result.water, temperature: result.temperature };
};

test('asked, a room a rule applies to answers with the recommendation', () => {
  const room = steady({ ...ROOM, co2: 1500 });
  const outdoor = steady(MILD, 12, 20);
  assert.deepEqual(airingAnswer(room, outdoor), airingRecommendation(room, outdoor));
  assert.equal(airingAnswer([], outdoor), null, 'without a pair there is nothing to answer');
});

test('asked without a rule, the answer says what airing would do', () => {
  // 50 % at 21 °C is 9.1 g/m³; 70 % at 15 °C is 9.0 — the same water, and 6 °C cooler.
  assert.deepEqual(answer(ROOM, MILD), { action: 'ask', humid: false, warm: false, water: null, temperature: 'cooler' });
  // 90 % at 5 °C is 6.1 g/m³: drier, and cooler.
  assert.deepEqual(answer(ROOM, { temperature: 5, humidity: 90 }),
    { action: 'ask', humid: false, warm: false, water: 'drier', temperature: 'cooler' });
  // 75 % at 25 °C is 17.2 g/m³: wetter, and warmer.
  assert.deepEqual(answer(ROOM, { temperature: 25, humidity: 75 }),
    { action: 'ask', humid: false, warm: false, water: 'wetter', temperature: 'warmer' });
  // 2 °C cooler is within the cooling margin.
  assert.equal(answer(ROOM, { temperature: 19, humidity: 57 }).temperature, null);
});

test('asked, a humid or warm room the outside cannot help is named as such', () => {
  // 62 % at 21 °C is 11.3 g/m³, 71 % at 18.5 °C 11.2: humid, but airing would not dry it.
  const humid = answer({ ...ROOM, humidity: 62 }, { temperature: 18.5, humidity: 71 });
  assert.deepEqual([humid.action, humid.humid, humid.water], ['ask', true, null]);
  // 24.5 °C inside, 23 °C outside: warm, but not cool enough outside to help.
  const warm = answer({ ...ROOM, temperature: 24.5, humidity: 40 }, { temperature: 23, humidity: 50 });
  assert.deepEqual([warm.action, warm.warm, warm.temperature], ['ask', true, null]);
});
