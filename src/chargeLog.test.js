import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARGE_LOG, describe } from './chargeLog.js';

test('the line names level, plug and power', () => {
  assert.deepEqual(describe({ level: 62, plugged: true, output: true, apower: 10.4 }), {
    line: 'level 62 %  plugged yes  plug on  10.4 W',
    fault: false,
  });
  assert.deepEqual(describe({}), { line: 'level ?  plugged ?  plug ?  ? W', fault: false });
});

test('a dead charger is one the plug feeds while the tablet does not charge', () => {
  // An old 10 W charger stopped delivering, the plug still on.
  assert.equal(describe({ level: 69, plugged: false, output: true, apower: 0 }).fault, true);
  assert.equal(describe({ level: 69, plugged: true, output: true, apower: CHARGE_LOG.deadW - 0.1 }).fault, true);
  // Off power on purpose, and full on power, are not.
  assert.equal(describe({ level: 62, plugged: false, output: false, apower: 0 }).fault, false);
  assert.equal(describe({ level: 100, plugged: true, output: true, apower: 1.3 }).fault, false);
});
