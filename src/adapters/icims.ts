import { type CompanySource, type Posting } from "../types";

/**
 * iCIMS adapter — intentionally a no-op stub (returns nothing).
 *
 * Investigated for Incyte (careers-incyte.icims.com): the site is a Jibe-on-iCIMS
 * single-page app (assets.jibecdn.com). A plain fetch gets only the ~300 KB JS
 * shell — GET /jobs/search returns 405, there's no RSS feed, no embedded job
 * JSON (`__NEXT_DATA__`/initial-state), and titles aren't in the HTML. The jobs
 * load via client-side XHR after the SPA boots, so reading them would require a
 * headless browser (e.g. Playwright) — a heavy dependency for a single company,
 * which would break this monitor's zero-dependency design.
 *
 * Decision: not worth it for one employer; the Workday adapter covers the rest.
 * If revived later, the path is headless-browser rendering or reverse-engineering
 * the Jibe job-search XHR endpoint.
 */
export async function fetchIcims(_c: CompanySource): Promise<Posting[]> {
  return [];
}
