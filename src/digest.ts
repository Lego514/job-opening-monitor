/**
 * The daily apply queue — pure half.
 *
 * The monitor's problem was never recall, it was triage: several firehose alerts
 * a day, 300 open matches, and no answer to "which five do I actually apply to
 * this morning". This module answers exactly that, once a day, off the candidate
 * snapshots the monitor already wrote — no fetching, no LLM calls, no network.
 *
 * Everything here is deterministic and unit-tested; all I/O lives in
 * src/run-digest.ts and src/state.ts.
 */
import { type Candidate, candidateToPosting, effectiveAgeDays } from "./candidates";
import { escapeHtml } from "./format";
import { h1bWageHint, isDelaware, isNycMetro } from "./rank";
import { selectAlertable } from "./select";
import { sponsorLine } from "./sponsors";
import { type NewGradFit } from "./types";
import { normalizedUrlKey } from "./urlkey";

export interface DigestOpts {
  /** How many roles the queue holds (env DIGEST_SIZE, default 5). */
  size: number;
  /** Drop candidates older than this many days (env DIGEST_MAX_AGE_DAYS, default 10). */
  maxAgeDays: number;
  /** Posting keys already shown in an earlier digest. */
  digestedKeys: Set<string>;
  /** Normalized URL keys of tracker rows that have moved past Wishlist. */
  actedUrlKeys: Set<string>;
  now?: number;
}

export interface DigestResult {
  chosen: Candidate[];
  counts: {
    /** Candidates in the pool before any digest-specific filtering. */
    pool: number;
    /** Eligible candidates the LLM read as an outright new-grad fit. */
    fit: number;
    /** How many made today's queue. */
    shown: number;
  };
  /** True when the queue had to reach past `newGradFit: "yes"` to fill up. */
  usedFallback: boolean;
}

/** Fit tiers, best first. A role the LLM rejected outright never appears. */
const TIERS: (NewGradFit | "unclassified")[] = ["yes", "maybe", "unclassified"];

function tierOf(c: Candidate): NewGradFit | "unclassified" {
  return c.llm ? c.llm.newGradFit : "unclassified";
}

/**
 * Would applying to this be a waste of the morning? Either the JD itself rules
 * out sponsorship (the regex pass) or the LLM read the JD and said the same.
 * Silence is fine — most JDs say nothing, and that is the normal case.
 */
function sponsorshipRuledOut(c: Candidate): boolean {
  return c.sponsorship === "no" || c.llm?.sponsorship === "no-sponsorship";
}

/**
 * Pick today's queue.
 *
 * Fills from the best fit tier and only reaches down when a tier can't fill the
 * quota — an empty morning is worse than a "maybe", but a "maybe" shown above a
 * "yes" would quietly devalue the whole list. Within a tier the monitor's own
 * `selectAlertable` does the ordering (DE-local > cap-exempt > NYC > proven
 * sponsor > wage > fresh), so the queue and the firehose never disagree about
 * what "best" means.
 */
export function selectDigest(candidates: Candidate[], opts: DigestOpts): DigestResult {
  const now = opts.now ?? Date.now();
  const eligible = candidates.filter((c) => {
    if (opts.digestedKeys.has(c.key)) return false; // shown on an earlier day
    const u = normalizedUrlKey(c.url);
    if (u && opts.actedUrlKeys.has(u)) return false; // already applied / rejected
    if (sponsorshipRuledOut(c)) return false;
    if (tierOf(c) === "no") return false;
    const age = effectiveAgeDays(c, now);
    return age == null || age <= opts.maxAgeDays; // unknown age passes
  });

  const chosen: Candidate[] = [];
  for (const tier of TIERS) {
    if (chosen.length >= opts.size) break;
    const inTier = eligible.filter((c) => tierOf(c) === tier);
    // Rank via the shared ordering: selectAlertable returns the very same objects,
    // so object identity maps each ranked posting back to its candidate.
    const byPosting = new Map<object, Candidate>();
    const postings = inTier.map((c) => {
      const p = candidateToPosting(c, now);
      byPosting.set(p, c);
      return p;
    });
    const ranked = selectAlertable(postings, {
      skipNoSponsorship: true,
      skipLlmReject: false, // the tier split already encodes the LLM's verdict
    });
    for (const p of ranked) {
      if (chosen.length >= opts.size) break;
      const c = byPosting.get(p);
      if (c) chosen.push(c);
    }
  }

  return {
    chosen,
    counts: {
      pool: candidates.length,
      fit: eligible.filter((c) => tierOf(c) === "yes").length,
      shown: chosen.length,
    },
    usedFallback: chosen.some((c) => tierOf(c) !== "yes"),
  };
}

// ---------------------------------------------------------------------------
// Dates. The queue's identity is "today in Ray's timezone" — a UTC date key
// would roll over at 8pm ET and hand him a second queue the same evening.

/** `YYYY-MM-DD` for the given instant in America/New_York. */
export function todayKeyNY(now: number = Date.now()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the Postgres `date` literal.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** Human date for the message header, e.g. "Thu, Sep 11". */
export function todayLabelNY(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(now));
}

// ---------------------------------------------------------------------------
// Rendering.

/** The why-it-ranks tags under a queue entry — the reason it beat 300 others. */
export function digestTags(c: Candidate, now: number = Date.now()): string[] {
  const age = effectiveAgeDays(c, now);
  return [
    c.capExempt ? "✅ cap-exempt — no H-1B lottery" : null,
    isDelaware(c.location) ? "🏠 DE-local" : isNycMetro(c.location) ? "🗽 NYC metro" : null,
    c.remote ? "💻 remote-eligible" : null,
    c.salary ? `💲${c.salary}` : null,
    h1bWageHint(c.salary),
    sponsorLine(c.sponsorHistory ?? undefined, c.company, c.capExempt),
    c.llm?.sponsorship === "will-sponsor" ? "🛂 JD mentions sponsorship" : null,
    c.llm?.newGradFit === "maybe" ? "🤔 maybe a fit" : null,
    c.llm ? `🎓 ${c.llm.seniority} · ${c.llm.roleFamily}` : "🎓 unclassified",
    age == null ? c.postedOn || null : age === 0 ? "posted today" : `${age}d old`,
  ].filter((x): x is string => !!x);
}

/**
 * The whole queue as one Telegram HTML message.
 *
 * A checklist, not a feed: numbered, one ☐ per role, apply link last so the
 * thumb lands on it. Sent as a single message so it can be scrolled once and
 * worked top-down (the sender splits it only if it somehow overruns 4096).
 */
export function digestMessage(r: DigestResult, now: number = Date.now()): string {
  if (r.chosen.length === 0) {
    return (
      `📋 <b>Daily apply queue — ${escapeHtml(todayLabelNY(now))}</b>\n\n` +
      `Nothing new to apply to today. ${r.counts.pool} candidate(s) in the pool were ` +
      `already shown, already applied to, aged out, or aren't a new-grad fit.`
    );
  }

  const entries = r.chosen.map((c, i) => {
    const tags = digestTags(c, now).join(" · ");
    return (
      `<b>${i + 1}. ☐ ${escapeHtml(c.company)}</b> — ${escapeHtml(c.title)}\n` +
      `   📍 ${escapeHtml(c.location)}\n` +
      (tags ? `   ${escapeHtml(tags)}\n` : "") +
      (c.llm?.summary ? `   📝 ${escapeHtml(c.llm.summary)}\n` : "") +
      `   ${c.url}`
    );
  });

  const header =
    `📋 <b>Daily apply queue — ${escapeHtml(todayLabelNY(now))}</b>\n` +
    `Apply to these ${r.chosen.length} today, top first. Mark them Applied in the tracker.` +
    (r.usedFallback ? `\n<i>(thin day — the list reaches past the sure-fit roles)</i>` : "");

  const footer =
    `${r.counts.pool} in pool · ${r.counts.fit} new-grad-fit · ${r.counts.shown} shown`;

  return `${header}\n\n${entries.join("\n\n")}\n\n${footer}`;
}
