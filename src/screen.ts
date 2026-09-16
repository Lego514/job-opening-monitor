/**
 * The "worth classifying" gate — the cost lever on the LLM stage.
 *
 * The pre-filter is deliberately wide (2,900+ matches a run) and the `seen` diff
 * still leaves 200–350 genuinely new roles every run. Classifying all of them
 * cost $3–6/day against a ~$0.40/day design target, and it bought almost
 * nothing: the vast majority are roles Ray would never apply to first — an
 * Austin SWE req at an employer with no H-1B history can be the best-written JD
 * in the world and it still sorts below every Delaware, cap-exempt, NYC and
 * proven-sponsor role in the alert list and never reaches the daily queue.
 *
 * So the model is only paid for postings that could *plausibly reach the daily
 * queue*. Everything the gate needs is already computed before the LLM stage
 * runs: location tiers (rank.ts), `capExempt` (config), USCIS filing history
 * (sponsors.ts, attached in index.ts before this point) and the remote flag
 * (the adapter's, or remote.ts's JD scan).
 *
 * The roles that fail the gate are NOT dropped — they stay in the alert set,
 * regex-judged exactly as they were before the LLM stage existed, and they sort
 * below the gated-in ones automatically: failing the gate means failing every
 * tier `selectAlertable` orders on. The only thing they lose is the verdict.
 *
 * Pure + unit-tested.
 */
import { isDelaware, isNycMetro } from "./rank";
import { type Posting } from "./types";

/** Why a posting earned a classification — the strongest reason, best first. */
export type ClassifyReason = "de-local" | "cap-exempt" | "nyc-metro" | "remote-us";

/** Display order + labels for the `[gate]` log line. */
const REASONS: ClassifyReason[] = ["de-local", "cap-exempt", "nyc-metro", "remote-us"];

/**
 * The strongest reason to spend a Claude call on this posting, or null.
 *
 * Checked in `selectAlertable`'s own tier order, so the reason reported is the
 * one that actually carries the role: DE-local > cap-exempt > NYC metro >
 * remote-US.
 *
 * USCIS filing history is deliberately NOT a reason on its own. It reads like
 * one — a proven sponsor is exactly who Ray needs — but it fails as a filter
 * here, because the source list was *built* out of big sponsors: measured
 * 2026-09-16, it alone admitted 1,300 of 2,667 matches and left the gate
 * keeping 77%, which is not a cost lever at all. It stays where it is useful,
 * as a ranking tier in `selectAlertable` and a line in the alert.
 *
 * What survives is geography and the lottery: with the queue taking five roles
 * a day, ordered DE-local > cap-exempt > NYC > sponsor > wage, a Boston or
 * Austin role does not reach it even when its employer files hundreds of
 * petitions. Those roles still alert — regex-judged, one tier down — they just
 * don't get a paid verdict.
 */
export function classifyReason(p: Posting): ClassifyReason | null {
  // A role whose JD already rules out sponsorship is a dead end no verdict can
  // reopen: `applyVerdict` can only ever ADD a "no", `selectAlertable` sorts it
  // into the bottom tier regardless, and the daily queue drops it outright. So
  // the classification could not change a single decision — never pay for it.
  if (p.sponsorship === "no") return null;
  if (isDelaware(p.location)) return "de-local";
  if (p.capExempt) return "cap-exempt";
  if (isNycMetro(p.location)) return "nyc-metro";
  if (p.remote === true) return "remote-us";
  return null;
}

/** Is this posting worth an API call? See `classifyReason`. */
export function worthClassifying(p: Posting): boolean {
  return classifyReason(p) !== null;
}

/**
 * `[gate]` log line: how much of the queue the gate kept, and on what grounds.
 *
 * The per-reason breakdown is the tuning signal — if one reason dominates (and
 * "remote-us" is the one most likely to), that is where the next cost cut is.
 */
export function gateSummary(posts: Posting[]): string {
  const counts = new Map<ClassifyReason, number>();
  let kept = 0;
  for (const p of posts) {
    const r = classifyReason(p);
    if (!r) continue;
    kept++;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const detail = REASONS.filter((r) => counts.has(r))
    .map((r) => `${r} ${counts.get(r)}`)
    .join(", ");
  return (
    `[gate] ${kept}/${posts.length} worth classifying` +
    (detail ? ` (${detail})` : "") +
    ` — the other ${posts.length - kept} stay regex-judged.`
  );
}
