/**
 * The dashboard on invented data, for a look without a station:
 *
 *   npm run demo
 *
 * Seeds a fresh database in a temporary directory from `src/demoData.js` and
 * serves it on http://localhost:8090 with an invented forecast, so it needs no
 * Netatmo account, no `.env` and no network. The values end at the moment
 * of the start and do not grow: after 35 minutes the tiles turn stale, as
 * they would with a station that stopped. Ctrl-C stops it and removes the
 * database. The screenshots in the README come from here.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSettings } from './config.js';
import { demoForecastBody, demoStation, DEMO } from './demoData.js';
import { log } from './log.js';
import { createForecast } from './openMeteo.js';
import { openReader } from './reader.js';
import { createHandler } from './server.js';
import { openStore } from './store.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const PORT = Number(process.env.DEMO_PORT || 8090);

async function main() {
  const nowUtc = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), 'netatmo-demo-'));
  const file = join(dir, 'demo.sqlite');

  const store = openStore(file);
  for (const { module, columns, rows, status } of demoStation(nowUtc)) {
    const id = store.upsertModule(module, rows[0].timeUtc);
    store.insertSamples(id, columns, rows);
    store.insertStatus(id, rows.at(-1).timeUtc, status);
  }
  store.close();

  // The real forecast path, fed a made-up answer instead of Open-Meteo's.
  const body = demoForecastBody(nowUtc);
  const forecast = createForecast({
    place: DEMO.place,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    fetchImpl: async () => new Response(JSON.stringify(body)),
  });
  await forecast.refresh();

  // The defaults, not this install's `.env`: the demo is the same everywhere.
  const settings = installSettings({});
  const reader = openReader(file);
  const server = createServer(createHandler({ reader, publicDir: PUBLIC_DIR, forecast, settings }));
  const stop = () => {
    server.closeAllConnections();
    server.close(() => {
      reader.close();
      rmSync(dir, { recursive: true, force: true });
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.listen(PORT, () => log.info(`demo on http://localhost:${PORT} — invented data, Ctrl-C to stop`));
}

main().catch((error) => {
  log.error(error.message);
  process.exitCode = 1;
});
