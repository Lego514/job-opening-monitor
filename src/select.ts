import { type Posting } from "./types";
import { postedDays } from "./recency";

export interface SelectOpts {
  /** Drop roles whose JD rules out sponsorship (don't alert on them at all). */
  skipNoSponsorship: boolean;
  /** Only keep roles posted within this many days (undefined = no age limit). */
  maxAgeDays?: number;
}

/**
 * Filter + order the postings to alert on: applies the optional age limit and
 * sponsorship skip, then sorts sponsorable roles first and freshest first.
 * Pure + tested.
 */
export function selectAlertable(postings: Posting[], opts: SelectOpts): Posting[] {
  let out = postings;

  if (opts.maxAgeDays != null) {
    const limit = opts.maxAgeDays;
    out = out.filter((p) => {
      const d = postedDays(p.postedOn);
      return d == null || d <= limit; // unknown age passes
    });
  }

  if (opts.skipNoSponsorship) {
    out = out.filter((p) => p.sponsorship !== "no");
  }

  return [...out].sort((a, b) => {
    const aFlagged = a.sponsorship === "no" ? 1 : 0;
    const bFlagged = b.sponsorship === "no" ? 1 : 0;
    if (aFlagged !== bFlagged) return aFlagged - bFlagged; // sponsorable first
    return (postedDays(a.postedOn) ?? 999) - (postedDays(b.postedOn) ?? 999); // fresher first
  });
}
