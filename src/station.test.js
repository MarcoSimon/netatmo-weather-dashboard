import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStations, summarize } from './station.js';

/** Shaped after a real getstationsdata response, trimmed to what we read. */
const RESPONSE = {
  status: 'ok',
  body: {
    devices: [
      {
        _id: '70:ee:50:00:00:01',
        type: 'NAMain',
        station_name: 'Zuhause',
        module_name: 'Wohnzimmer',
        reachable: true,
        firmware: 300,
        wifi_status: 56,
        data_type: ['Temperature', 'CO2', 'Humidity', 'Noise', 'Pressure'],
        dashboard_data: {
          time_utc: 1757400000,
          Temperature: 21.0,
          Humidity: 55,
          CO2: 1240,
          Noise: 38,
          Pressure: 1013.4,
          AbsolutePressure: 1001.2,
          temp_trend: 'up',
          max_temp: 22.4,
        },
        modules: [
          {
            _id: '02:00:00:00:00:02',
            type: 'NAModule1',
            module_name: 'Außen',
            reachable: true,
            battery_percent: 68,
            battery_vp: 5684,
            rf_status: 62,
            firmware: 53,
            data_type: ['Temperature', 'Humidity'],
            dashboard_data: { time_utc: 1757399880, Temperature: 5.0, Humidity: 90 },
          },
          {
            _id: '03:00:00:00:00:03',
            type: 'NAModule4',
            module_name: 'Schlafzimmer',
            reachable: false,
            battery_percent: 12,
            rf_status: 86,
          },
        ],
      },
    ],
  },
  time_server: 1757400300,
};

test('the base unit and its modules end up in one flat list', () => {
  const { stationName, modules } = parseStations(RESPONSE);
  assert.equal(stationName, 'Zuhause');
  assert.deepEqual(
    modules.map((m) => [m.name, m.type]),
    [
      ['Wohnzimmer', 'base'],
      ['Außen', 'outdoor'],
      ['Schlafzimmer', 'indoor'],
    ],
  );
});

test('every module knows the device it reports through and what it measures', () => {
  const [base, outdoor] = parseStations(RESPONSE).modules;
  assert.equal(base.deviceId, '70:ee:50:00:00:01');
  assert.equal(outdoor.deviceId, '70:ee:50:00:00:01');
  assert.deepEqual(outdoor.dataTypes, ['Temperature', 'Humidity']);
});

test('the status fields are read, the measured values are not', () => {
  const [base, outdoor] = parseStations(RESPONSE).modules;
  assert.deepEqual(
    { wifi: base.wifiStatus, firmware: base.firmware, vp: outdoor.batteryVp, rf: outdoor.rfStatus },
    { wifi: 56, firmware: 300, vp: 5684, rf: 62 },
  );
  // The series come from getmeasure; dashboard_data would be a second path.
  assert.equal('readings' in base, false);
});

test('the server time is kept as the moment of the status snapshot', () => {
  assert.equal(parseStations(RESPONSE).timeServer, 1757400300);
});

test('the base unit reports no battery or radio link', () => {
  const [base] = parseStations(RESPONSE).modules;
  assert.equal(base.batteryPercent, null);
  assert.equal(base.rfStatus, null);
  assert.equal(base.reachable, true);
});

test('a module without data_type or battery survives with empty defaults', () => {
  const bedroom = parseStations(RESPONSE).modules[2];
  assert.deepEqual(bedroom.dataTypes, []);
  assert.equal(bedroom.batteryVp, null);
  assert.equal(bedroom.reachable, false);
});

test('an unknown module type is passed through rather than dropped', () => {
  const { modules } = parseStations({
    body: { devices: [{ _id: 'x', type: 'NAMain', modules: [{ _id: 'y', type: 'NAModule9' }] }] },
  });
  assert.equal(modules[1].type, 'NAModule9');
});

test('a module falls back to its id when it has no name', () => {
  const { modules } = parseStations({ body: { devices: [{ _id: 'bare', type: 'NAMain' }] } });
  assert.equal(modules[0].name, 'bare');
});

test('a response without devices is an error, not an empty list', () => {
  assert.throws(() => parseStations({ status: 'ok', body: {} }), /no body\.devices/);
});

test('the summary names offline modules and low batteries', () => {
  const summary = summarize(parseStations(RESPONSE));
  assert.equal(summary, '3 modules | offline: Schlafzimmer | low battery: Schlafzimmer 12%');
});

test('a healthy station summarizes to the module count alone', () => {
  const summary = summarize({
    modules: [{ name: 'a', reachable: true, batteryPercent: 90 }],
  });
  assert.equal(summary, '1 modules');
});
