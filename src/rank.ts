// Shared ranking/geography helpers used by both index.ts (display) and select.ts
// (ordering). Kept in their own module so select doesn't have to import index
// (which imports select — that would be a cycle). Pure + tested.

/**
 * Delaware commutable ring — the top-choice location, so DE-local roles rank
 * first and get the wider LOCAL_FILTERS. NOTE (backlog C1): this also matches
 * Newark NJ / Wilmington NC/MA; a state-aware guard is a separate follow-up.
 */
export const DE_AREA = /\b(?:delaware|wilmington|newark|philadelphia)\b/i;
export const isDelaware = (loc: string | null | undefined): boolean => DE_AREA.test(loc ?? "");

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
