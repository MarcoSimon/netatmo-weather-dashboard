/**
 * Pure parsing of a `getstationsdata` response into a flat list of modules.
 *
 * Netatmo nests the base unit and its modules differently — the base carries
 * its fields directly, the modules sit in a `modules` array — and the store
 * wants one uniform shape. Keeping this pure means the shape can be pinned by
 * tests without ever calling the API.
 *
 * The measured values in `dashboard_data` are deliberately not read: the
 * series come from `getmeasure` (see measure.js), which delivers every point
 * rather than the newest one. What only this call has is the module list and
 * each module's status — battery, radio, Wi-Fi, reachability, firmware.
 */

/** Netatmo module types, by what they actually are. */
export const MODULE_TYPES = {
  NAMain: 'base',
  NAModule1: 'outdoor',
  NAModule2: 'wind',
  NAModule3: 'rain',
  NAModule4: 'indoor',
};

const numberOrNull = (value) => (typeof value === 'number' ? value : null);

function toModule(raw, { deviceId, isBase }) {
  return {
    id: raw._id,
    deviceId,
    name: raw.module_name ?? raw.station_name ?? raw._id,
    type: MODULE_TYPES[raw.type] ?? raw.type,
    dataTypes: Array.isArray(raw.data_type) ? raw.data_type : [],
    // The base unit is mains-powered and always "reachable"; only add-on
    // modules report a battery and a radio link, only the base a Wi-Fi link.
    reachable: isBase ? raw.reachable !== false : raw.reachable === true,
    batteryPercent: numberOrNull(raw.battery_percent),
    batteryVp: numberOrNull(raw.battery_vp),
    rfStatus: numberOrNull(raw.rf_status),
    wifiStatus: numberOrNull(raw.wifi_status),
    firmware: numberOrNull(raw.firmware),
  };
}

/**
 * @returns {{stationName: string|null, timeServer: number|null, modules: Array}}
 * one entry per module, base unit first, in the order Netatmo returned them.
 */
export function parseStations(body) {
  const devices = body?.body?.devices;
  if (!Array.isArray(devices)) {
    throw new Error('getstationsdata response has no body.devices array');
  }
  const modules = [];
  let stationName = null;
  for (const device of devices) {
    stationName ??= device.station_name ?? null;
    modules.push(toModule(device, { deviceId: device._id, isBase: true }));
    for (const module of device.modules ?? []) {
      modules.push(toModule(module, { deviceId: device._id, isBase: false }));
    }
  }
  return { stationName, timeServer: numberOrNull(body.time_server), modules };
}

/** One-line summary for the poll log — the outcome, not the data. */
export function summarize({ modules }) {
  const offline = modules.filter((m) => !m.reachable);
  const low = modules.filter((m) => m.batteryPercent !== null && m.batteryPercent < 20);
  const parts = [`${modules.length} modules`];
  if (offline.length) parts.push(`offline: ${offline.map((m) => m.name).join(', ')}`);
  if (low.length) {
    parts.push(`low battery: ${low.map((m) => `${m.name} ${m.batteryPercent}%`).join(', ')}`);
  }
  return parts.join(' | ');
}
