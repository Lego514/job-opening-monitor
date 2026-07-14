import { type Posting } from "./types";
import { postedDays } from "./recency";
import { isDelaware, salaryFloor } from "./rank";

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

  // Order mirrors the job-hunt strategy: never lead with a dead-end, then
  // DE-local > cap-exempt > higher wage (better lottery odds) > fresher.
  const flagged = (p: Posting) => (p.sponsorship === "no" ? 1 : 0);
  const notDE = (p: Posting) => (isDelaware(p.location) ? 0 : 1);
  const notCapExempt = (p: Posting) => (p.capExempt ? 0 : 1);
  const age = (p: Posting) => postedDays(p.postedOn) ?? 999;

  return [...out].sort(
    (a, b) =>
      flagged(a) - flagged(b) || // sponsorable before flagged
      notDE(a) - notDE(b) || // Delaware-local first
      notCapExempt(a) - notCapExempt(b) || // cap-exempt (no lottery) next
      (salaryFloor(b.salary) ?? 0) - (salaryFloor(a.salary) ?? 0) || // higher wage first
      age(a) - age(b), // fresher first
  );
}
