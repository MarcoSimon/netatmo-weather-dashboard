import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The file uploaded to the plug, run as it is against a stand-in for the
// plug's script runtime: its switch, its key-value store, its HTTP client and
// its timer.
const SOURCE = readFileSync(new URL('../shelly/charge.js', import.meta.url), 'utf8');
const URL_KEY = 'charge_fully_url';
const FULLY_URL = 'http://192.0.2.27:2323/?cmd=deviceInfo&type=json&password=p%26w';

function plug({ output = true, kvs = { [URL_KEY]: FULLY_URL } } = {}) {
  const state = { output, calls: [], timers: [], printed: [], pending: [] };
  const Shelly = {
    getComponentStatus: (key) => (key === 'switch:0' ? { id: 0, output: state.output } : null),
    call(method, params, callback) {
      // Copied into this realm: objects made inside the script carry its prototypes.
      state.calls.push({ method, params: { ...params } });
      if (method === 'KVS.Get') {
        if (params.key in kvs) callback({ value: kvs[params.key] }, 0, '');
        else callback(null, -105, 'Argument \'key\', value \'' + params.key + '\' not found!');
      } else if (method === 'Switch.Set') {
        state.output = params.on;
      } else if (method === 'HTTP.GET') {
        state.pending.push(callback);
      }
    },
  };
  const Timer = { set: (ms, repeat, fn) => state.timers.push({ ms, repeat, fn }) };
  vm.runInNewContext(SOURCE, { Shelly, Timer, print: (s) => state.printed.push(s), JSON });
  return {
    state,
    /** Answers the oldest request the script has out. */
    answer(result, errorCode = 0, errorMessage = '') {
      state.pending.shift()(result, errorCode, errorMessage);
    },
    level(batteryLevel, extra = {}) {
      this.answer({ code: 200, body: JSON.stringify({ batteryLevel, isPlugged: state.output, ...extra }) });
    },
    tick() {
      state.timers[0].fn();
    },
    switched: () => state.calls.filter((c) => c.method === 'Switch.Set').map((c) => c.params),
    gets: () => state.calls.filter((c) => c.method === 'HTTP.GET'),
  };
}

test('it reads the URL from the key-value store and checks at once, then every minute', () => {
  const p = plug();
  assert.deepEqual(p.gets().map((c) => c.params), [{ url: FULLY_URL, timeout: 10 }]);
  assert.equal(p.state.timers.length, 1);
  assert.equal(p.state.timers[0].ms, 60_000);
  assert.equal(p.state.timers[0].repeat, true);
});

test('at the top of the band it switches the plug off', () => {
  const p = plug();
  p.level(75);
  assert.deepEqual(p.switched(), [{ id: 0, on: false }]);
  assert.equal(p.state.output, false);
});

test('below the top it leaves the plug on', () => {
  const p = plug();
  p.level(74);
  p.tick();
  p.level(30);
  assert.deepEqual(p.switched(), []);
});

test('it never switches the plug on, at any level', () => {
  const p = plug();
  for (const level of [100, 75, 20, 0]) {
    p.state.output = true;
    p.tick();
    p.level(level);
  }
  assert.ok(p.switched().every((s) => s.on === false));
});

test('while the plug is off it does not ask the tablet at all', () => {
  const p = plug({ output: false });
  p.tick();
  p.tick();
  assert.equal(p.gets().length, 0);
});

test('the auto-on timer switches the plug on above the top: off again at the next check', () => {
  const p = plug({ output: false });
  p.state.output = true; // the plug's own timer
  p.tick();
  p.level(78);
  assert.deepEqual(p.switched(), [{ id: 0, on: false }]);
});

test('a plug switched off while the request was out is not switched again', () => {
  const p = plug();
  p.state.output = false;
  p.level(90);
  assert.deepEqual(p.switched(), []);
});

test('anything but a level it can trust leaves the plug on', () => {
  const cases = [
    [null, -104, 'Timeout'],
    [{ code: 401, body: '{"status":"Error","statustext":"Please login"}' }, 0, ''],
    [{ code: 200, body: '{"status":"Error","statustext":"Please login"}' }, 0, ''],
    [{ code: 200, body: '<html>' }, 0, ''],
    [{ code: 200, body: '{"isPlugged":true}' }, 0, ''],
    [{ code: 200, body: '{"batteryLevel":"80"}' }, 0, ''],
    [{ code: 200, body: 'null' }, 0, ''],
  ];
  for (const [result, code, message] of cases) {
    const p = plug();
    p.answer(result, code, message);
    assert.deepEqual(p.switched(), [], JSON.stringify(result));
    assert.equal(p.state.output, true);
  }
});

test('without its URL in the key-value store the loop stays idle and the plug on', () => {
  const p = plug({ kvs: {} });
  assert.equal(p.gets().length, 0);
  assert.equal(p.state.timers.length, 0);
  assert.match(p.state.printed.join('\n'), /no charge_fully_url in KVS/);
});
