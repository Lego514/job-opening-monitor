/**
 * The candidate record: what the daily apply queue reads instead of re-fetching
 * ~22k postings from every ATS.
 *
 * The monitor already does all the expensive work (fetch → filter → enrich → LLM
 * → sponsor match) every 15 minutes, but until now the only thing that survived a
 * run was the *seen key* and a tracker row — and a tracker row carries neither the
 * LLM verdict nor the sponsor history, so a digest built off it couldn't rank or
 * explain anything. So each alertable posting is snapshotted here, once, on the
 * run that first found it. The digest then reads one table and finishes in
 * seconds.
 *
 * This module is the pure half (row ⇄ posting mapping, age arithmetic); the
 * Supabase reads/writes live in state.ts with the rest of the REST layer.
 */
import { postedDays } from "./recency";
import type { SponsorHistory } from "./sponsors";
import { type LlmVerdict, type Posting, postingKey } from "./types";

/** A snapshot of one alertable posting, as stored in `monitor_candidates`. */
export interface Candidate {
  key: string; // company-namespaced posting key
  company: string;
  title: string;
  location: string;
  url: string;
  postedOn: string; // the raw ATS text/date, for display
  /** Age in days *at the moment it was captured*, or null if unparseable. */
  postedDaysAtCapture: number | null;
  firstSeen: string; // ISO timestamp of the run that captured it
  salary: string | null;
  remote: boolean;
  capExempt: boolean;
  via: string | null;
  sponsorship: "no" | "unknown" | null;
  sponsorshipReason: string | null;
  llm: LlmVerdict | null;
  sponsorHistory: SponsorHistory | null;
}

/** The wire shape of a `monitor_candidates` row (snake_case, as PostgREST wants). */
export interface CandidateRow {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  posted_on: string;
  posted_days: number | null;
  first_seen?: string;
  salary: string | null;
  remote: boolean;
  cap_exempt: boolean;
  via: string | null;
  sponsorship: string | null;
  sponsorship_reason: string | null;
  llm: LlmVerdict | null;
  sponsor_history: SponsorHistory | null;
}

/** Snapshot a posting for storage. `postedDays` is resolved NOW because Workday
 *  reports a *relative* age ("Posted 5 Days Ago") that would otherwise stay
 *  frozen at 5 forever; pairing it with `first_seen` lets the digest age it. */
export function toCandidateRow(p: Posting, now: number = Date.now()): CandidateRow {
  return {
    id: postingKey(p),
    company: p.company,
    title: p.title,
    location: p.location,
    url: p.url,
    posted_on: p.postedOn ?? "",
    posted_days: postedDays(p.postedOn, now),
    salary: p.salary ?? null,
    remote: p.remote ?? false,
    cap_exempt: p.capExempt ?? false,
    via: p.via ?? null,
    sponsorship: p.sponsorship ?? null,
    sponsorship_reason: p.sponsorshipReason ?? null,
    llm: p.llm ?? null,
    sponsor_history: p.sponsorHistory ?? null,
  };
}

export function rowToCandidate(r: CandidateRow): Candidate {
  return {
    key: r.id,
    company: r.company ?? "",
    title: r.title ?? "",
    location: r.location ?? "",
    url: r.url ?? "",
    postedOn: r.posted_on ?? "",
    postedDaysAtCapture: r.posted_days ?? null,
    firstSeen: r.first_seen ?? "",
    salary: r.salary ?? null,
    remote: !!r.remote,
    capExempt: !!r.cap_exempt,
    via: r.via ?? null,
    sponsorship: r.sponsorship === "no" || r.sponsorship === "unknown" ? r.sponsorship : null,
    sponsorshipReason: r.sponsorship_reason ?? null,
    llm: r.llm ?? null,
    sponsorHistory: r.sponsor_history ?? null,
  };
}

const DAY_MS = 86_400_000;

/**
 * How old the posting is *today*, not on the day it was captured.
 *
 * A candidate captured three days ago as "Posted 2 Days Ago" is five days old
 * now. Without this the age filter would let a role linger in the queue forever;
 * with it, an unapplied role ages out on schedule. Unknown age stays unknown
 * (and, per the monitor's convention everywhere else, passes the filter).
 */
export function effectiveAgeDays(c: Candidate, now: number = Date.now()): number | null {
  if (c.postedDaysAtCapture == null) return null;
  const captured = Date.parse(c.firstSeen);
  const elapsed = Number.isNaN(captured) ? 0 : Math.max(0, Math.floor((now - captured) / DAY_MS));
  return c.postedDaysAtCapture + elapsed;
}

/**
 * Re-hydrate a candidate into the `Posting` shape so the digest can rank it with
 * the monitor's own `selectAlertable` rather than a second, drifting ordering.
 *
 * `postedOn` is rewritten to the *effective* date so the ordering's freshness tie-
 * break stays honest for a candidate that has been sitting in the pool; the
 * original text is kept on the Candidate for display.
 */
export function candidateToPosting(c: Candidate, now: number = Date.now()): Posting {
  const age = effectiveAgeDays(c, now);
  const postedOn =
    age == null ? "" : new Date(now - age * DAY_MS).toISOString().slice(0, 10);
  return {
    id: c.key.slice(c.company.length + 1) || c.key,
    company: c.company,
    title: c.title,
    location: c.location,
    url: c.url,
    postedOn,
    salary: c.salary,
    remote: c.remote,
    capExempt: c.capExempt,
    via: c.via ?? undefined,
    sponsorship: c.sponsorship ?? undefined,
    sponsorshipReason: c.sponsorshipReason ?? undefined,
    llm: c.llm ?? undefined,
    sponsorHistory: c.sponsorHistory ?? undefined,
  };
}
