/**
 * Absolute humidity and dew point from temperature and relative humidity —
 * the calculation the airing recommendation stands on. Pure, so it is
 * unit-tested from `src/humidity.test.js`.
 *
 * Relative humidity says how full the air is *at its own temperature*, so two
 * relative values at different temperatures cannot be compared: 90 % at 5 °C
 * outside holds less water than 55 % at 21 °C inside. Absolute humidity, in
 * grams of water per cubic metre, can be compared directly.
 */

/**
 * Magnus formula for the saturation vapour pressure over water, with the
 * constants of Sonntag (1990), valid from −45 to 60 °C. Netatmo's relative
 * humidity is relative to water below 0 °C too, so there is no ice branch.
 */
const MAGNUS = { a: 17.62, b: 243.12, e0: 6.112 };

/** R / M of water vapour, scaled so that hPa and kelvin give g/m³. */
const VAPOUR_GRAMS = 216.7;
const KELVIN = 273.15;

/** Saturation vapour pressure in hPa at `temperature` °C. */
export function saturationPressure(temperature) {
  return MAGNUS.e0 * Math.exp((MAGNUS.a * temperature) / (MAGNUS.b + temperature));
}

/** Grams of water per cubic metre of air. */
export function absoluteHumidity(temperature, humidity) {
  const vapourPressure = (humidity / 100) * saturationPressure(temperature);
  return (VAPOUR_GRAMS * vapourPressure) / (KELVIN + temperature);
}

/**
 * The relative humidity the air would have at `target` °C: the outside
 * air in the room's terms. Warming or cooling air keeps its vapour pressure,
 * not its grams per cubic metre — the air expands — so this goes through the
 * pressure. Above 100 % the air could not hold it and would condense; the
 * value is returned as is.
 */
export function humidityAt(temperature, humidity, target) {
  return (humidity * saturationPressure(temperature)) / saturationPressure(target);
}

/** The temperature, in °C, at which the air would be saturated. */
export function dewPoint(temperature, humidity) {
  const gamma = Math.log(humidity / 100) + (MAGNUS.a * temperature) / (MAGNUS.b + temperature);
  return (MAGNUS.b * gamma) / (MAGNUS.a - gamma);
}
