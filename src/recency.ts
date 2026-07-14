/**
 * Parse a posting's age (in days) from either Workday's relative text or an
 * ISO date, or null if it can't be parsed. Pure + tested.
 *   "Posted Today"        -> 0
 *   "Posted Yesterday"    -> 1
 *   "Posted 5 Days Ago"   -> 5
 *   "Posted 30+ Days Ago" -> 30
 *   "2026-06-18"          -> days since that date (Greenhouse updated_at, Lever createdAt)
 *
 * The ISO branch matters: without it, ~31 Greenhouse/Lever employers return
 * dates that parsed to null and slipped past the recency filter as "unknown age".
 */
export function postedDays(postedOn: string, now: number = Date.now()): number | null {
  const s = (postedOn || "").toLowerCase().trim();
  if (!s) return null;
  if (s.includes("today")) return 0;
  if (s.includes("yesterday")) return 1;
  const rel = /(\d+)\+?\s+days?\s+ago/.exec(s);
  if (rel) return Number(rel[1]);
  // ISO date (optionally with a time component we ignore). Use (?!\d) rather
  // than \b so "2026-06-18t12:00:00z" still matches (no word boundary before "t").
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
  if (iso) {
    const then = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(then)) return Math.max(0, Math.floor((now - then) / 86_400_000));
  }
  return null;
}
