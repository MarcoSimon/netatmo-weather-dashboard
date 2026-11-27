/**
 * What the window guess saw, day by day — for comparing it with the
 * openings someone noted down while they happened.
 *
 *   npm run windows -- 2025-06-02            one day
 *   npm run windows -- 2025-06-02 2025-06-04  a span of days, inclusive
 *
 * Each day is judged the way the wall page judges it: from the room's and the
 * outdoor module's series through the read-only reader (faulty points
 * dropped), with the CO₂ baseline of the week before the day's end. The
 * series starts three hours before midnight, so an opening that began the
 * evening before is still followed.
 */
import { loadServerConfig } from './config.js';
import { openReader } from './reader.js';
import { windowEpisodes, WINDOW } from '../public/window.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function localMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getTime() / 1000;
}

const clock = (t) => new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function main() {
  const [first, last = first] = process.argv.slice(2);
  if (!DATE.test(first ?? '') || !DATE.test(last)) {
    throw new Error('usage: npm run windows -- <YYYY-MM-DD> [<YYYY-MM-DD>]');
  }
  const reader = openReader(loadServerConfig().databaseFile);
  try {
    const modules = reader.modules();
    const outdoor = modules.find((m) => m.type === 'outdoor');
    if (!outdoor) throw new Error('no outdoor module');
    const rooms = modules.filter((m) => m.type === 'base' || m.type === 'indoor');
    for (let day = localMidnight(first); day <= localMidnight(last); ) {
      // Midnight to midnight in local time, which is 23 or 25 hours on DST days.
      const date = new Date(day * 1000);
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() / 1000;
      const from = day - WINDOW.maxOpenS;
      const outside = reader.series(outdoor.id, from, next).samples;
      console.log(date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }));
      for (const room of rooms) {
        const series = reader.series(room.id, from, next);
        const episodes = windowEpisodes(series.samples, outside, series.co2_baseline)
          .filter((e) => e.since >= day && e.since < next);
        const text = episodes.length === 0
          ? '—'
          : episodes.map((e) => `${clock(e.since)}–${e.until === null ? 'offen' : clock(e.until)} (${e.why === 'co2' ? 'CO₂' : 'Temperatur'})`).join(', ');
        console.log(`  ${room.name.padEnd(14)} ${text}`);
      }
      day = next;
    }
  } finally {
    reader.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
