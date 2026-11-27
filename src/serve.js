/**
 * The HTTP server as a program. It runs next to the poller as its own process:
 * a crash here must never be able to take the token file with it.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './config.js';
import { createForecast } from './openMeteo.js';
import { log } from './log.js';
import { openReader } from './reader.js';
import { createHandler } from './server.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function main() {
  const config = loadServerConfig();
  const reader = openReader(config.databaseFile);
  const forecast = config.forecastPlace ? createForecast({ place: config.forecastPlace, timeZone: config.settings.timeZone }) : null;
  if (!forecast) log.info('no FORECAST_LAT/FORECAST_LON — running without a forecast');
  const server = createServer(createHandler({ reader, publicDir: PUBLIC_DIR, forecast, settings: config.settings }));

  server.on('error', (error) => {
    log.error(`server failed: ${error.message}`);
    forecast?.stop();
    reader.close();
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      log.info(`${signal} — stopping`);
      // The tablet keeps its connection open; without this, close() would
      // wait for it to time out.
      forecast?.stop();
      server.closeAllConnections();
      server.close(() => reader.close());
    });
  }

  server.listen(config.port, config.host, () => {
    log.info(`serving ${config.databaseFile} on http://${config.host}:${config.port} — Ctrl-C to stop`);
    forecast?.start();
  });
}

try {
  main();
} catch (error) {
  log.error(error.message);
  process.exitCode = 1;
}
