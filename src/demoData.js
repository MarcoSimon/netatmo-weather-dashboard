/**
 * Invented data for `npm run demo`: a station with an outdoor module and two
 * rooms, eight days up to a given moment, and a forecast for the same place.
 * Pure and seeded, so it is unit-tested from `src/demoData.test.js` and the
 * same moment always gives the same house.
 *
 * Nothing here is measured. The values come from a small model of a house —
 * people breathing CO₂ and moisture into a room of a given size, air leaking
 * out, a window now and then, rooms anchored to their walls — so the curves
 * look like a station's, staircase and all, and the derived values (airing,
 * the window guess, the pressure tendency) have something to work on.
 *
 * The last hours are a scene, anchored to `nowUtc` rather than to the clock,
 * so the demo shows the same things at any time of day: the living room has
 * had guests in it without airing and asks to be aired, and the kitchen's
 * window was opened 25 minutes ago.
 */
import { absoluteHumidity } from '../public/humidity.js';

export const DEMO = {
  /** How far back the series reach: a week for the CO₂ baseline, and a day more. */
  days: 8,
  stepS: 5 * 60,
  /** The outside's CO₂, which every room decays towards. */
  outsideCo2: 420,
  /** The kitchen's window, opened this long before `nowUtc`. */
  windowOpenS: 25 * 60,
  /** Where the forecast's sun rises and sets: Berlin, as in the Open-Meteo samples. */
  place: { lat: 52.52, lon: 13.42 },
};

const HOUR = 3600;
const DAY = 24 * HOUR;

/** A small seeded generator (mulberry32): the same seed, the same house. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Hours after local midnight, fractional. */
const localHour = (utc) => {
  const date = new Date(utc * 1000);
  return date.getHours() + date.getMinutes() / 60;
};
const localMidnight = (utc, dayOffset = 0) => {
  const date = new Date(utc * 1000);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset).getTime() / 1000;
};
/** 0 at `from`, 1 at `to`, a cosine in between: the shape of a day's warming. */
const ease = (x) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2;
/** The relative humidity of air holding `grams` per m³ at `temperature`. */
const relative = (temperature, grams) => Math.min(98, (100 * grams) / absoluteHumidity(temperature, 100));

/**
 * The outside temperature: each day its own low around 07:00 and high around
 * 15:00, joined by cosines, with a little weather on top. The morning of
 * `frostDay` (a local midnight) dips below zero, so the outdoor tile's week
 * has a frost to mark.
 */
function outdoorTemperature(rand, frostDay) {
  const days = new Map();
  const extremes = (midnight) => {
    if (!days.has(midnight)) {
      const day = { low: 6 + rand() * 4, high: 12.5 + rand() * 4.5 };
      days.set(midnight, midnight === frostDay ? { low: -1.6, high: 9 } : day);
    }
    return days.get(midnight);
  };
  let weather = 0;
  return (t) => {
    const h = localHour(t);
    const today = extremes(localMidnight(t));
    let value;
    if (h < 7) value = extremes(localMidnight(t, -1)).high - (extremes(localMidnight(t, -1)).high - today.low) * ease((h + 9) / 16);
    else if (h < 15) value = today.low + (today.high - today.low) * ease((h - 7) / 8);
    else value = today.high - (today.high - extremes(localMidnight(t, 1)).low) * ease((h - 15) / 16);
    weather = 0.97 * weather + (rand() - 0.5) * 0.12;
    return value + weather;
  };
}

/**
 * One room as a few state variables stepped every five minutes: CO₂ and
 * moisture from the people in it, both leaking out at the air change rate,
 * and a temperature drawn to the walls and, with the window open, to the
 * outside.
 */
function room({ volume, walls, people, airing, moisture, perPerson = 40 }) {
  let co2 = DEMO.outsideCo2 + 150;
  let grams = null;
  let temperature = walls;
  return (t, outside, outsideGrams, rand) => {
    const dtH = DEMO.stepS / HOUR;
    const inside = people(t);
    const open = airing(t);
    const changes = open ? 6 : 0.7;
    co2 += dtH * ((inside * 18000) / volume - changes * (co2 - DEMO.outsideCo2));
    grams ??= outsideGrams + moisture / volume / 0.7;
    grams += dtH * ((moisture + inside * perPerson) / volume - changes * (grams - outsideGrams));
    const warmth = walls + 0.4 * inside + 0.1 * (outside - 12);
    temperature += dtH * (0.6 * (warmth - temperature) + (open ? 0.4 : 0.02) * (outside - temperature));
    return {
      temperature: round(temperature + (rand() - 0.5) * 0.08, 1),
      humidity: Math.round(relative(temperature, grams) + (rand() - 0.5) * 0.8),
      co2: Math.round(co2 + (rand() - 0.5) * 16),
    };
  };
}

/**
 * The station's series up to `nowUtc`, oldest first, as the poller would have
 * stored them, plus each module's status.
 */
export function demoStation(nowUtc, seed = 7) {
  const rand = random(seed);
  const end = nowUtc - (nowUtc % DEMO.stepS);
  const start = end - DEMO.days * DAY;
  const scene = (t, from, to = 0) => t > end - from && t <= end - to;

  const outdoor = outdoorTemperature(rand, localMidnight(end, -4));
  const living = room({
    volume: 80,
    walls: 20.6,
    moisture: 60,
    // Breakfast, lunch and the evening; this afternoon, guests and no airing.
    people: (t) => {
      if (scene(t, 3 * HOUR)) return 3;
      const h = localHour(t);
      return (h >= 7 && h < 8) || (h >= 12.5 && h < 13.5) || (h >= 18 && h < 23) ? 2 : 0;
    },
    airing: (t) => !scene(t, 3 * HOUR) && localHour(t) >= 8 && localHour(t) < 8.15,
  });
  const kitchen = room({
    volume: 45,
    walls: 20.1,
    moisture: 25,
    // The cooks breathe, and the pots steam.
    perPerson: 60,
    // Cooking three times a day, the window open after lunch; today, cooking
    // for the guests until the window was opened just now.
    people: (t) => {
      if (scene(t, 3 * HOUR, DEMO.windowOpenS)) return 2;
      const h = localHour(t);
      return (h >= 7 && h < 8) || (h >= 11.5 && h < 13) || (h >= 17.5 && h < 19) ? 2 : 0;
    },
    airing: (t) => scene(t, DEMO.windowOpenS) || (!scene(t, 3 * HOUR) && localHour(t) >= 13 && localHour(t) < 13.2),
  });

  const rows = { base: [], outdoor: [], indoor: [] };
  for (let t = start; t <= end; t += DEMO.stepS) {
    const outside = outdoor(t);
    // The outside air's water changes slowly, with the weather rather than the hour.
    const outsideGrams = 7 + 0.8 * Math.sin((t - start) / (2.7 * DAY));
    const behind = (end - t) / HOUR;
    // A low on its way: falling for a day, and faster over the last hours.
    const pressure = 1019 - Math.max(0, 24 - behind) * 0.12 - Math.max(0, 6 - behind) * 0.3
      + 0.4 * Math.sin((2 * Math.PI * localHour(t)) / 12);

    const base = living(t, outside, outsideGrams, rand);
    rows.base.push({ timeUtc: t, values: [base.temperature, base.humidity, base.co2, round(pressure + (rand() - 0.5) * 0.15, 1), Math.round(36 + rand() * 9)] });
    rows.outdoor.push({ timeUtc: t, values: [round(outside, 1), Math.round(relative(outside, outsideGrams) + (rand() - 0.5) * 1.5)] });
    const indoor = kitchen(t, outside, outsideGrams, rand);
    rows.indoor.push({ timeUtc: t, values: [indoor.temperature, indoor.humidity, indoor.co2] });
  }

  const status = { reachable: true, batteryVp: 5600, firmware: 50 };
  const device = '70:ee:50:00:00:01';
  return [
    {
      module: { id: device, deviceId: device, type: 'base', name: 'Wohnzimmer' },
      columns: ['temperature', 'humidity', 'co2', 'pressure', 'noise'],
      rows: rows.base,
      status: { ...status, batteryPercent: null, batteryVp: null, rfStatus: null, wifiStatus: 52 },
    },
    {
      module: { id: '02:00:00:00:00:02', deviceId: device, type: 'outdoor', name: 'Draußen' },
      columns: ['temperature', 'humidity'],
      rows: rows.outdoor,
      status: { ...status, batteryPercent: 64, rfStatus: 71, wifiStatus: null },
    },
    {
      module: { id: '03:00:00:00:00:03', deviceId: device, type: 'indoor', name: 'Küche' },
      columns: ['temperature', 'humidity', 'co2'],
      rows: rows.indoor,
      status: { ...status, batteryPercent: 81, rfStatus: 66, wifiStatus: null },
    },
  ];
}

/**
 * Sunrise and sunset in unix seconds for the local day that contains
 * `dayUtc`, from the usual approximation of the sun's declination and the
 * equation of time — a few minutes off at most, which is plenty for a demo.
 */
export function sunTimes(dayUtc, { lat, lon }) {
  const noonLocal = localMidnight(dayUtc) + 12 * HOUR;
  const date = new Date(noonLocal * 1000);
  const dayOfYear = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const rad = Math.PI / 180;
  const declination = 23.44 * rad * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const equationMin = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const noonUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000
    + (12 - lon / 15) * HOUR - equationMin * 60;
  const cosHour = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(declination)) / (Math.cos(lat * rad) * Math.cos(declination));
  const halfDayS = (Math.acos(Math.min(1, Math.max(-1, cosHour))) / rad / 15) * HOUR;
  return { sunrise: Math.round(noonUtc - halfDayS), sunset: Math.round(noonUtc + halfDayS) };
}

/**
 * A forecast in Open-Meteo's own response shape, so it goes through the same
 * parser as the real one: three local days from today's midnight. Sunshine by
 * day until a front arrives in the evening with rain into the night, a cooler
 * and showery day after.
 */
export function demoForecastBody(nowUtc, seed = 7) {
  const rand = random(seed + 1);
  const first = localMidnight(nowUtc);
  const hourly = { time: [], temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], sunshine_duration: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [] };
  const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [], sunshine_duration: [], weather_code: [], sunrise: [], sunset: [] };

  for (let d = 0; d < 3; d++) {
    const midnight = localMidnight(nowUtc, d);
    const next = localMidnight(nowUtc, d + 1);
    const sun = sunTimes(midnight, DEMO.place);
    const low = [8, 9, 7][d];
    const high = [15, 12, 13][d];
    const day = { temperatures: [], rain: 0, chance: 0, sunshine: 0 };
    for (let t = midnight; t < next; t += HOUR) {
      const h = localHour(t);
      const hoursIn = (t - first) / HOUR;
      // The front: rain from 19:00 today until 03:00, showers the next afternoon.
      const front = hoursIn >= 19 && hoursIn < 27;
      const showers = d === 1 && h >= 13 && h < 18;
      const temperature = round(low + (high - low) * (h < 15 ? ease((h - 6) / 9) : 1 - ease((h - 15) / 15)), 1);
      const daylight = Math.max(0, Math.min(t + HOUR, sun.sunset) - Math.max(t, sun.sunrise));
      const sunshine = front || showers ? 0 : Math.round(daylight * (d === 0 ? 0.85 : 0.4) * (0.8 + 0.2 * rand()));
      const chance = front ? 70 + Math.round(rand() * 15) : showers ? 40 : 5;
      const rain = front ? round(0.2 + rand() * 0.4, 1) : showers ? 0.1 : 0;
      hourly.time.push(t);
      hourly.temperature_2m.push(temperature);
      hourly.apparent_temperature.push(round(temperature - 1.5, 1));
      hourly.precipitation_probability.push(chance);
      hourly.precipitation.push(rain);
      hourly.sunshine_duration.push(sunshine);
      hourly.weather_code.push(front ? 61 : showers ? 80 : sunshine > 1800 ? 1 : 3);
      hourly.wind_speed_10m.push(front ? 22 : 12);
      hourly.wind_gusts_10m.push(front ? 41 : 25);
      day.temperatures.push(temperature);
      day.rain += rain;
      day.chance = Math.max(day.chance, chance);
      day.sunshine += sunshine;
    }
    daily.time.push(midnight);
    daily.temperature_2m_max.push(Math.max(...day.temperatures));
    daily.temperature_2m_min.push(Math.min(...day.temperatures));
    daily.precipitation_sum.push(round(day.rain, 1));
    daily.precipitation_probability_max.push(day.chance);
    daily.sunshine_duration.push(day.sunshine);
    daily.weather_code.push(day.rain > 1 ? 61 : 3);
    daily.sunrise.push(sun.sunrise);
    daily.sunset.push(sun.sunset);
  }
  return { hourly, daily };
}
