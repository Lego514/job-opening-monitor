// Shared ranking/geography helpers used by both index.ts (display) and select.ts
// (ordering). Kept in their own module so select doesn't have to import index
// (which imports select — that would be a cycle). Pure + tested.

/**
 * Delaware commutable ring — the top-choice location, so DE-local roles rank
 * first and get the wider LOCAL_FILTERS. State-aware: Newark is also NJ and
 * Wilmington is also NC/MA/OH, so a bare ring city only counts when no *other*
 * US state is named alongside it (DE and PA are fine — PA = Philadelphia ring).
 */
const DE_PA_SIGNAL = /\b(?:delaware|philadelphia|pennsylvania)\b|,\s*(?:de|pa)\b/i;
const RING_CITY = /\b(?:wilmington|newark)\b/i;
// A US state other than DE/PA disqualifies a bare ring city. Abbrevs must be
// comma-preceded ("Newark, NJ") so 2-letter state codes don't match English
// words like "in"/"or"/"me"; spelled-out state names match directly.
const OTHER_STATE =
  /,\s*(?:al|ak|az|ar|ca|co|ct|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b|\b(?:new jersey|north carolina|massachusetts|ohio|new york|maryland|virginia)\b/i;

export function isDelaware(loc: string | null | undefined): boolean {
  const s = loc ?? "";
  if (DE_PA_SIGNAL.test(s)) return true;
  return RING_CITY.test(s) && !OTHER_STATE.test(s);
}

/**
 * NYC commutable metro — the second-choice location, so these rank above the
 * rest of the country but below Delaware and below cap-exempt employers (the
 * lottery matters more than the city).
 *
 * "New York" alone would drag in the whole state, so upstate metros are
 * excluded: Buffalo and Newark NJ are both "NY-ish" strings that mean very
 * different commutes. The NJ/CT ring cities are listed only where the name is
 * unambiguous (Hoboken) or the state is spelled out (Newark, NJ) — plain
 * "Newark" is Delaware's ring city and is already claimed by isDelaware.
 */
const NYC_SIGNAL =
  /\b(?:new york city|nyc|manhattan|brooklyn|the bronx|long island city)\b|,\s*ny\b|\bnew york\b/i;
const NYC_RING = /\b(?:jersey city|hoboken|stamford|white plains|yonkers|greenwich)\b|\bnewark\s*,\s*(?:nj|new jersey)\b/i;
const UPSTATE = /\b(?:buffalo|rochester|syracuse|albany|ithaca|binghamton|utica)\b/i;

export function isNycMetro(loc: string | null | undefined): boolean {
  const s = loc ?? "";
  if (UPSTATE.test(s)) return false;
  return NYC_SIGNAL.test(s) || NYC_RING.test(s);
}

/**
 * Numeric value of the first dollar amount in a string, expanding a `K` suffix
 * (e.g. "$95,000" -> 95000, "$95K" -> 95000, "$95k–$120k" -> 95000).
 */
export function dollarValue(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?([kK])?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

/** Lower bound of a parsed salary string (e.g. "$95,000 - $120,000" -> 95000). */
export const salaryFloor = dollarValue;

// Under the FY2027+ wage-weighted H-1B lottery, higher pay = more lottery entries.
// Rough heuristic from the salary floor (real OEWS wage levels vary by role/metro).
export function h1bWageHint(salary: string | null | undefined): string | null {
  const floor = salaryFloor(salary);
  if (floor == null) return null;
  if (floor >= 130000) return "📈 high wage → strong H-1B lottery odds";
  if (floor >= 105000) return "📈 mid wage → decent H-1B odds";
  return null;
}
