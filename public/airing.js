/**
 * Whether to air a room, decided per room against the outdoor module.
 * Pure, so it is unit-tested from `src/airing.test.js`.
 *
 * The rules, in order; the first that applies wins:
 *
 * 1. CO₂ is high → air. If rule 2 or 3 would also apply, only briefly.
 * 2. The room is humid and the outside air holds more water → do not air.
 *    This is the trap the project exists for, and it beats cooling: mould
 *    outweighs comfort.
 * 3. The room is warm and it is warmer outside → do not air.
 * 4. The room is warm and it is clearly cooler outside → air, it cools.
 * 5. The room is humid and the outside air holds less water → air, it dries.
 *
 * Otherwise there is no recommendation: one that is always on is noise. The
 * room can still be asked, and the answer says what airing would do.
 * "Too dry" is not a rule — in four years of an old house's history the rooms
 * were below 40 % for under 1 % of the time.
 */
import { absoluteHumidity, humidityAt } from './humidity.js';

/**
 * Every condition switches on at `enter` and off only below `leave`, so a
 * label does not flicker when a value steps back and forth across a
 * threshold. Differences are inside minus outside, or the other way round,
 * as named.
 *
 * - CO₂ 1,000 ppm: the Umweltbundesamt's limit of hygienically harmless air,
 *   where the value turns yellow.
 * - Humidity 60 %: where the humidity colour leaves the comfort band.
 * - Warm from 24 °C: below that, nobody airs a room to cool it.
 * - 1 g/m³ of water: one percent of relative humidity is about 0.2 g/m³ at
 *   room temperature, so a smaller margin would decide on sensor steps.
 * - 3 °C cooler outside: enough for airing to cool noticeably.
 */
export const CONDITIONS = {
  co2High: { enter: 1000, leave: 900 },
  humid: { enter: 60, leave: 58 },
  warm: { enter: 24, leave: 23.5 },
  drierOutside: { enter: 1, leave: 0.5 },
  wetterOutside: { enter: 1, leave: 0.5 },
  coolerOutside: { enter: 3, leave: 2 },
  warmerOutside: { enter: 0.5, leave: 0 },
};

/** How far apart a room's point and the outdoor point it is compared with may lie. */
export const PAIR_S = 10 * 60;

/**
 * Values, oldest first → whether the condition is on now. The newest value
 * that lies outside the band between `leave` and `enter` decides; values in
 * the band keep whatever was before. Nulls are skipped. Nothing outside the
 * band at all means off.
 */
export function latched(values, { enter, leave }) {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value === null || value === undefined) continue;
    if (value >= enter) return true;
    if (value < leave) return false;
  }
  return false;
}

const has = (sample, ...keys) => keys.every((key) => typeof sample[key] === 'number');

/**
 * Each room point with temperature and humidity, paired with the nearest
 * outdoor point within PAIR_S that has both too. Both series ascend by time.
 */
export function pairs(room, outdoor) {
  const outside = outdoor.filter((sample) => has(sample, 'temperature', 'humidity'));
  const result = [];
  let j = 0;
  for (const inside of room) {
    if (!has(inside, 'temperature', 'humidity')) continue;
    while (j + 1 < outside.length && outside[j + 1].time_utc <= inside.time_utc) j++;
    const nearest = [outside[j], outside[j + 1]]
      .filter((sample) => sample && Math.abs(sample.time_utc - inside.time_utc) <= PAIR_S)
      .sort((a, b) => Math.abs(a.time_utc - inside.time_utc) - Math.abs(b.time_utc - inside.time_utc))[0];
    if (nearest) result.push({ inside, outside: nearest });
  }
  return result;
}

const water = ({ temperature, humidity }) => absoluteHumidity(temperature, humidity);

/**
 * Everything the rules and the question below look at: each condition as the
 * hysteresis leaves it, and the newest paired values. Null without a pair.
 */
function assess(room, outdoor) {
  const paired = pairs(room, outdoor);
  const newest = paired.at(-1);
  if (!newest) return null;

  const on = (name, values) => latched(values, CONDITIONS[name]);
  const inWater = paired.map((p) => water(p.inside));
  const outWater = paired.map((p) => water(p.outside));
  const latestCo2 = room.findLast((sample) => has(sample, 'co2'))?.co2;
  return {
    co2High: on('co2High', room.map((sample) => sample.co2)),
    humid: on('humid', room.map((sample) => sample.humidity)),
    warm: on('warm', room.map((sample) => sample.temperature)),
    drier: on('drierOutside', inWater.map((w, i) => w - outWater[i])),
    wetter: on('wetterOutside', outWater.map((w, i) => w - inWater[i])),
    cooler: on('coolerOutside', paired.map((p) => p.inside.temperature - p.outside.temperature)),
    warmer: on('warmerOutside', paired.map((p) => p.outside.temperature - p.inside.temperature)),
    values: {
      inside: {
        temperature: newest.inside.temperature,
        humidity: newest.inside.humidity,
        water: inWater.at(-1),
        ...(latestCo2 !== undefined && { co2: latestCo2 }),
      },
      outside: {
        temperature: newest.outside.temperature,
        humidity: newest.outside.humidity,
        water: outWater.at(-1),
        // The outside air at the room's temperature.
        inRoom: humidityAt(newest.outside.temperature, newest.outside.humidity, newest.inside.temperature),
      },
      atUtc: Math.min(newest.inside.time_utc, newest.outside.time_utc),
    },
  };
}

/**
 * A room's series and the outdoor series (24 hours, oldest first) → the
 * recommendation, or null. `action` is `air`, `brief` or `dont`; `reason` is
 * `co2`, `humid`, `hot`, `cool` or `dry`; a brief airing names the rule that
 * shortened it as `caveat`. `inside` and `outside` carry the newest paired
 * values the decision rests on, and `atUtc` the older of that pair's two
 * points, so the caller can drop a recommendation that is stale.
 */
export function airingRecommendation(room, outdoor) {
  const state = assess(room, outdoor);
  const decision = state && rule(state);
  return decision ? { ...decision, ...state.values } : null;
}

/** The five rules in order, or null when none applies. */
function rule({ co2High, humid, warm, drier, wetter, cooler, warmer }) {
  const trap = humid && wetter;
  const hot = warm && warmer;
  if (co2High) {
    const caveat = trap ? 'humid' : hot ? 'hot' : undefined;
    return { action: caveat ? 'brief' : 'air', reason: 'co2', ...(caveat && { caveat }) };
  }
  if (trap) return { action: 'dont', reason: 'humid' };
  if (hot) return { action: 'dont', reason: 'hot' };
  if (warm && cooler) return { action: 'air', reason: 'cool' };
  if (humid && drier) return { action: 'air', reason: 'dry' };
  return null;
}

/**
 * The answer to "should I air now?": the recommendation while a rule
 * applies, and otherwise what airing would do to the room — `action` `ask`.
 * That answer uses the rules' own margins, so a difference within sensor steps
 * is "about the same": `water` is `drier`, `wetter` or null and `temperature`
 * `cooler`, `warmer` or null, the outside compared with the room. `humid` and
 * `warm` say the room is past a rule's threshold without the outside to act on
 * it. Null without a pair.
 */
export function airingAnswer(room, outdoor) {
  const state = assess(room, outdoor);
  if (!state) return null;
  const decision = rule(state);
  if (decision) return { ...decision, ...state.values };
  const { humid, warm, drier, wetter, cooler, warmer } = state;
  return {
    action: 'ask',
    humid,
    warm,
    water: drier ? 'drier' : wetter ? 'wetter' : null,
    temperature: cooler ? 'cooler' : warmer ? 'warmer' : null,
    ...state.values,
  };
}
