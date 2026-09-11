/**
 * Alert-rendering helpers shared by the 15-minute monitor (src/index.ts) and the
 * daily apply queue (src/digest.ts).
 *
 * These lived in index.ts until the digest needed the same "why this role" line;
 * copying them would have let the two alert styles drift apart, which is exactly
 * the thing a queue built out of the monitor's own ranking must not do.
 */
import { h1bWageHint } from "./rank";
import { sponsorLine } from "./sponsors";
import { type Posting } from "./types";

/** Escape the three characters Telegram's HTML parse mode reacts to. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

// How the LLM's new-grad verdict reads in an alert. "yes" is the expected case
// once rejects are filtered out, so it gets no badge — only a hedge is worth
// the line space.
export const FIT_BADGE: Record<string, string> = {
  maybe: "🤔 maybe a fit",
  no: "🚫 not a new-grad fit",
};

/** The one-line "why this role" summary under a posting in an alert. */
export function metaLine(p: Posting): string {
  const v = p.llm;
  return [
    p.capExempt ? "✅ cap-exempt — no H-1B lottery" : null,
    p.via ? `via ${p.via}` : null,
    p.remote ? "🏠 remote-eligible" : null,
    p.salary ? `💲${p.salary}` : null,
    h1bWageHint(p.salary),
    sponsorLine(p.sponsorHistory, p.company, p.capExempt),
    p.postedOn || null,
    p.sponsorship === "no"
      ? `⛔ no sponsorship${p.sponsorshipReason ? ` — ${p.sponsorshipReason}` : ""}`
      : null,
    // The LLM's read of the JD — the part that saves actually opening it.
    v?.sponsorship === "will-sponsor" ? "🛂 mentions sponsorship" : null,
    v ? FIT_BADGE[v.newGradFit] ?? null : null,
    v ? `🎓 ${v.seniority} · ${v.roleFamily}` : null,
    v?.summary ? `📝 ${v.summary}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
