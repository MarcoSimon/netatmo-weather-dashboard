/**
 * What the charge loop did, from outside the plug: once a minute the
 * tablet's battery level and whether it is plugged in, the plug's output and
 * the power it measures, one line each.
 *
 *   npm run -s charge:log >> charge.log 2>&1
 *
 * The loop on the plug keeps no record, so this is how the band is checked
 * after the fact. Read-only: it never switches anything. Gaps while the host
 * sleeps are harmless; the loop does not depend on this.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { log } from './log.js';
import { fullyDeviceInfo, loadChargeConfig, shellyCall } from './shelly.js';

export const CHARGE_LOG = {
  everyMs: 60 * 1000,
  /**
   * Below this, a plug that is on delivers nothing. Charging draws about
   * 10 W and a full tablet on power 1.3–3.6 W; a charger that has given up
   * reads 0.
   */
  deadW: 1,
};

/** One reading → the line, and whether the charger looks dead: the plug is on, but the tablet does not charge. */
export function describe({ level, plugged, output, apower }) {
  const fault = output === true && (plugged === false || (Number.isFinite(apower) && apower < CHARGE_LOG.deadW));
  const parts = [
    `level ${Number.isFinite(level) ? `${level} %` : '?'}`,
    `plugged ${plugged === true ? 'yes' : plugged === false ? 'no' : '?'}`,
    `plug ${output === true ? 'on' : output === false ? 'off' : '?'}`,
    `${Number.isFinite(apower) ? apower.toFixed(1) : '?'} W`,
  ];
  return { line: parts.join('  '), fault };
}

async function read(config) {
  const [tablet, plug] = await Promise.allSettled([
    fullyDeviceInfo(config.fully),
    shellyCall({ ...config.shelly, method: 'Switch.GetStatus', params: { id: 0 } }),
  ]);
  for (const r of [tablet, plug]) if (r.status === 'rejected') log.warn(r.reason.message);
  return {
    level: tablet.value?.batteryLevel,
    plugged: tablet.value?.isPlugged,
    output: plug.value?.output,
    apower: plug.value?.apower,
  };
}

async function main() {
  const config = loadChargeConfig();
  // One reading right after the plug switches on can still show the tablet
  // unplugged; only a second one in a row counts.
  let faults = 0;
  for (;;) {
    const { line, fault } = describe(await read(config));
    faults = fault ? faults + 1 : 0;
    if (faults >= 2) log.warn(`${line}  the plug is on and the tablet does not charge`);
    else log.info(line);
    await sleep(CHARGE_LOG.everyMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
