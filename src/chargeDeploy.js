/**
 * Puts the charge loop on the Shelly plug: the plug's fail-safe, the
 * kiosk browser's URL in the plug's key-value store, and `shelly/charge.js`
 * as a script that starts with the plug.
 *
 *   npm run charge:deploy
 *
 * Safe to run again: it finds the script by name, replaces its code and
 * restarts it. Needs SHELLY_HOST, SHELLY_PASSWORD, FULLY_HOST and
 * FULLY_PASSWORD in `.env`.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fullyDeviceInfoUrl, loadChargeConfig, shellyCall } from './shelly.js';

export const DEPLOY = {
  name: 'charge',
  source: new URL('../shelly/charge.js', import.meta.url),
  urlKey: 'charge_fully_url',
  /**
   * The fail-safe, owned by the plug rather than the script. The delay has to
   * outlast the band at the fastest drain — 30 points at about 7 %/h is about
   * four hours — or the timer charges before the band is used; much longer,
   * and a script that died at the top leaves the tablet low by the afternoon.
   */
  switchConfig: { initial_state: 'on', auto_on: true, auto_on_delay: 4.5 * 3600 },
  // Script.PutCode takes the code in pieces; well below the plug's frame limit.
  chunk: 1024,
};

export function chunks(text, size) {
  const pieces = [];
  for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
  return pieces.length > 0 ? pieces : [''];
}

/** Every step against an injected `call(method, params)`, so a test can follow it. */
export async function deploy({ call, code, fullyUrl }) {
  await call('Switch.SetConfig', { id: 0, config: DEPLOY.switchConfig });
  await call('KVS.Set', { key: DEPLOY.urlKey, value: fullyUrl });

  const { scripts } = await call('Script.List');
  let script = scripts.find((s) => s.name === DEPLOY.name);
  if (!script) {
    const { id } = await call('Script.Create', { name: DEPLOY.name });
    script = { id, running: false };
  }
  if (script.running) await call('Script.Stop', { id: script.id });
  for (const [i, piece] of chunks(code, DEPLOY.chunk).entries()) {
    await call('Script.PutCode', { id: script.id, code: piece, append: i > 0 });
  }
  await call('Script.SetConfig', { id: script.id, config: { enable: true } });
  await call('Script.Start', { id: script.id });
  return call('Script.GetStatus', { id: script.id });
}

async function main() {
  const config = loadChargeConfig();
  const call = (method, params) => shellyCall({ ...config.shelly, method, params });
  const code = await readFile(DEPLOY.source, 'utf8');
  const status = await deploy({ call, code, fullyUrl: fullyDeviceInfoUrl(config.fully) });
  console.log(`script ${status.id} running: ${status.running}${status.errors?.length ? `, errors: ${status.errors.join(', ')}` : ''}`);
  if (!status.running) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
