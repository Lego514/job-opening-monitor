/**
 * Parse Workday's relative "postedOn" text into a day count, or null if it
 * can't be parsed. Pure + tested.
 *   "Posted Today"        -> 0
 *   "Posted Yesterday"    -> 1
 *   "Posted 5 Days Ago"   -> 5
 *   "Posted 30+ Days Ago" -> 30
 */
export function postedDays(postedOn: string): number | null {
  const s = (postedOn || "").toLowerCase();
  if (!s) return null;
  if (s.includes("today")) return 0;
  if (s.includes("yesterday")) return 1;
  const m = /(\d+)\+?\s+days?\s+ago/.exec(s);
  return m ? Number(m[1]) : null;
}
