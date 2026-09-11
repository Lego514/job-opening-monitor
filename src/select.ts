import { type Posting } from "./types";
import { postedDays } from "./recency";
import { isDelaware, isNycMetro, salaryFloor } from "./rank";
import { hasSponsorHistory } from "./sponsors";

export interface SelectOpts {
  /** Drop roles whose JD rules out sponsorship (don't alert on them at all). */
  skipNoSponsorship: boolean;
  /** Only keep roles posted within this many days (undefined = no age limit). */
  maxAgeDays?: number;
  /** Drop roles the LLM read as out of reach for a new grad (default: true). */
  skipLlmReject?: boolean;
}

/**
 * Did the LLM read this role as out of reach for a new MS grad?
 *
 * Only ever true for a posting that actually got a verdict. With no API key, a
 * failed call, or a run that hit the classification ceiling, `llm` is undefined
 * and the role stays in on the regex path — the LLM can demote a role, never
 * silently swallow one it never looked at.
 */
export function llmRejects(p: Posting): boolean {
  const v = p.llm;
  if (!v) return false;
  return (
    v.newGradFit === "no" ||
    v.seniority === "mid" ||
    v.seniority === "senior" ||
    v.seniority === "exec"
  );
}

/**
 * Filter + order the postings to alert on: applies the optional age limit, the
 * sponsorship skip and the LLM's new-grad-fit verdict, then sorts sponsorable
 * roles first and freshest first. Pure + tested.
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

  // The point of the wide pre-filter is that the LLM does the rejecting; if we
  // kept everything it rejects, the alerts would be noisier than before.
  if (opts.skipLlmReject !== false) {
    out = out.filter((p) => !llmRejects(p));
  }

  // Order mirrors the job-hunt strategy: never lead with a dead-end, then
  // DE-local > cap-exempt > NYC metro > proven sponsor > higher wage (better
  // lottery odds) > fresher. Cap-exempt sits ABOVE the NYC preference on
  // purpose: skipping the H-1B lottery outranks a preferred city. An LLM
  // rejection is a dead end in the same sense as a no-sponsorship flag, so it
  // shares the bottom tier — it only shows up here when skipLlmReject is
  // explicitly off.
  const deadEnd = (p: Posting) => (p.sponsorship === "no" || llmRejects(p) ? 1 : 0);
  const notDE = (p: Posting) => (isDelaware(p.location) ? 0 : 1);
  const notCapExempt = (p: Posting) => (p.capExempt ? 0 : 1);
  const notNyc = (p: Posting) => (isNycMetro(p.location) ? 0 : 1);
  // Employers with real H-1B approvals on file beat ones with none or unknown.
  // A cap-exempt employer is exempt from this too: its petitions skip the
  // lottery, so a thin cap-subject filing history says nothing against it (and
  // universities often file under a legal name the index can't reach anyway).
  const unproven = (p: Posting) => (p.capExempt || hasSponsorHistory(p.sponsorHistory) ? 0 : 1);
  const age = (p: Posting) => postedDays(p.postedOn) ?? 999;

  return [...out].sort(
    (a, b) =>
      deadEnd(a) - deadEnd(b) || // sponsorable + plausible before flagged
      notDE(a) - notDE(b) || // Delaware-local first
      notCapExempt(a) - notCapExempt(b) || // cap-exempt (no lottery) next
      notNyc(a) - notNyc(b) || // then the second-choice metro
      unproven(a) - unproven(b) || // then employers that demonstrably sponsor
      (salaryFloor(b.salary) ?? 0) - (salaryFloor(a.salary) ?? 0) || // higher wage first
      age(a) - age(b), // fresher first
  );
}
