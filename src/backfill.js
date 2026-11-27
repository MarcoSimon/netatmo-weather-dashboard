import { PAGE_LIMIT, parseMeasure } from './measure.js';

/**
 * Brings one module's stored series up to date with Netatmo's.
 *
 * It always continues after the newest stored point (or from 0, which Netatmo
 * answers with its very first point). The stored series is therefore always a
 * gapless prefix of Netatmo's, and "gap detection on start" needs no scan:
 * after an outage of any length the next run starts exactly where the last
 * one stopped. The first run imports the whole history the same way, just
 * spread over more cycles.
 *
 * A full page means there is more; a short one means the module has caught
 * up. Each page is committed before the next is requested, so a failure or a
 * stop loses at most the page in flight.
 *
 * A failure is returned, not thrown: the pages committed before it are real
 * progress, and the caller has to be able to report them. (The first real run
 * logged "+0 samples" after storing 34 pages, because a 503 on the 35th threw
 * the count away.)
 *
 * @param {object} args
 * @param {number} args.budget most pages this call may request; a failed
 *   request counts, because it was sent
 * @param {() => Promise<unknown>} args.pause waits before each request — the
 *   only rate limiting the import needs
 * @returns {Promise<{pages: number, added: number, last: number|null, caughtUp: boolean, error?: Error}>}
 */
export async function backfillModule({ store, moduleId, series, fetchPage, budget, pause, signal }) {
  let last = store.lastSampleTime(moduleId);
  let pages = 0;
  let added = 0;
  // Nothing we know how to ask for: requesting it anyway would only return an
  // empty page.
  if (series.length === 0) return { pages, added, last, caughtUp: true };

  const types = series.map((s) => s.type);
  const columns = series.map((s) => s.column);
  try {
    while (pages < budget) {
      await pause();
      if (signal?.aborted) break;
      pages += 1;
      const rows = parseMeasure(await fetchPage({ types, dateBegin: last === null ? 0 : last + 1 }), series);
      if (rows.length > 0) {
        added += store.insertSamples(moduleId, columns, rows);
        last = rows.at(-1).timeUtc;
      }
      if (rows.length < PAGE_LIMIT) return { pages, added, last, caughtUp: true };
    }
  } catch (error) {
    return { pages, added, last, caughtUp: false, error };
  }
  return { pages, added, last, caughtUp: false };
}
