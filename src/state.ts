import {
  type Candidate,
  type CandidateRow,
  rowToCandidate,
  toCandidateRow,
} from "./candidates";
import { type LlmVerdict, type Posting, postingKey } from "./types";
import { normalizedUrlKey } from "./urlkey";

// Seen-job state lives in Supabase table `monitor_seen_jobs` (see
// supabase/0002_monitor.sql). Uses the REST API with the service_role key
// (bypasses RLS). We deliberately do NOT use supabase-js: its createClient
// eagerly inits a realtime WebSocket client that throws on Node 20.

function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function restBase(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set");
  return `${url.replace(/\/$/, "")}/rest/v1`;
}

/**
 * Set of already-seen posting keys (company-namespaced).
 * Paginates: PostgREST caps a response at 1000 rows by default, so a single GET
 * silently drops older keys once the table grows past 1000 — which would make
 * old roles look "new" and re-alert. We page with the Range header until a short
 * page signals the end.
 */
export async function loadSeenKeys(): Promise<Set<string>> {
  const PAGE = 1000;
  const keys = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const res = await fetch(`${restBase()}/monitor_seen_jobs?select=id`, {
      headers: { ...sbHeaders(), "Range-Unit": "items", Range: `${from}-${to}` },
    });
    // PostgREST returns 200 for a full result, 206 for a partial (ranged) one.
    if (!res.ok && res.status !== 206) throw new Error(`loadSeen HTTP ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as { id: string }[];
    for (const r of rows) keys.add(r.id);
    if (rows.length < PAGE) break;
  }
  return keys;
}

/** Record postings as seen (idempotent — duplicate keys are ignored). */
export async function markSeen(postings: Posting[]): Promise<void> {
  if (postings.length === 0) return;
  const rows = postings.map((p) => ({ id: postingKey(p), company: p.company, title: p.title }));
  const res = await fetch(`${restBase()}/monitor_seen_jobs`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`markSeen HTTP ${res.status}: ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// LLM verdict cache (`monitor_llm_verdicts`, see supabase/0003_llm_verdicts.sql).
// Every cached row is a Claude call that doesn't have to be paid for again.

/**
 * Fetch cached verdicts for the given posting keys.
 *
 * Queried by key rather than loaded whole: unlike `seen`, this table carries a
 * JSON blob per row, and a run only ever needs verdicts for the handful of
 * postings it is about to classify. Keys are chunked because they travel in the
 * URL, and quoted because a company name or req id may contain a comma.
 *
 * A cache read is an optimization, never a requirement — a failure here is
 * logged and the run pays for those classifications instead of dying.
 */
export async function loadLlmVerdicts(keys: string[]): Promise<Map<string, LlmVerdict>> {
  const out = new Map<string, LlmVerdict>();
  const CHUNK = 50;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const list = chunk.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
    const url = `${restBase()}/monitor_llm_verdicts?select=id,verdict&id=in.(${encodeURIComponent(list)})`;
    try {
      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const rows = (await res.json()) as { id: string; verdict: LlmVerdict }[];
      for (const r of rows) if (r.verdict) out.set(r.id, r.verdict);
    } catch (e) {
      console.error(`[llm] verdict cache read failed: ${(e as Error).message}`);
      return out; // partial cache is still worth using; the rest just get classified
    }
  }
  return out;
}

/** Persist newly-obtained verdicts (idempotent — an existing key is replaced). */
export async function saveLlmVerdicts(
  verdicts: Map<string, LlmVerdict>,
  model: string,
): Promise<void> {
  if (verdicts.size === 0) return;
  const rows = [...verdicts].map(([id, verdict]) => ({ id, verdict, model }));
  try {
    const res = await fetch(`${restBase()}/monitor_llm_verdicts`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  } catch (e) {
    // Losing the cache write costs money next run, not correctness — never fatal.
    console.error(`[llm] verdict cache write failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Daily apply queue: candidate snapshots (`monitor_candidates`) and the record
// of what each day's digest already showed (`monitor_digest`).
// See supabase/0004_digest.sql.

/**
 * Thrown when PostgREST says the table isn't there.
 *
 * These migrations can only be applied by hand in the Supabase SQL editor, so
 * "the table doesn't exist yet" is a genuinely expected state for a freshly
 * pushed feature — and it deserves an instruction, not a stack trace.
 */
export class MissingTableError extends Error {
  constructor(public table: string) {
    super(
      `Supabase table "${table}" does not exist yet. ` +
        `Paste supabase/0004_digest.sql into the Supabase SQL editor and run it.`,
    );
    this.name = "MissingTableError";
  }
}

/** PostgREST reports an unknown relation as 404 + PGRST205 (or PG's 42P01). */
function missingTable(status: number, body: string): boolean {
  return status === 404 && /PGRST205|42P01|Could not find the table/i.test(body);
}

async function sbGet(path: string, table: string, range?: [number, number]): Promise<unknown[]> {
  const headers = range
    ? { ...sbHeaders(), "Range-Unit": "items", Range: `${range[0]}-${range[1]}` }
    : sbHeaders();
  const res = await fetch(`${restBase()}/${path}`, { headers });
  if (!res.ok && res.status !== 206) {
    const body = await res.text();
    if (missingTable(res.status, body)) throw new MissingTableError(table);
    throw new Error(`GET ${table} HTTP ${res.status}: ${body}`);
  }
  return (await res.json()) as unknown[];
}

/** Page through a PostgREST collection (it caps a response at 1000 rows). */
async function sbGetAll(path: string, table: string, maxRows = 20_000): Promise<unknown[]> {
  const PAGE = 1000;
  const out: unknown[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const rows = await sbGet(path, table, [from, from + PAGE - 1]);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Snapshot this run's alertable postings for the daily digest.
 *
 * `ignore-duplicates`, not `merge-duplicates`: the first capture is the one that
 * matters, because `first_seen` is what ages a relative "Posted 2 Days Ago" text
 * correctly days later. A re-insert would reset that clock and make an old role
 * look fresh forever.
 *
 * Never fatal: the digest is a downstream convenience, and losing a snapshot must
 * not cost the alert that the monitor exists to send.
 */
export async function saveCandidates(postings: Posting[]): Promise<void> {
  if (postings.length === 0) return;
  const rows = postings.map((p) => toCandidateRow(p));
  try {
    const res = await fetch(`${restBase()}/monitor_candidates`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error(`[candidates] save failed (digest pool not updated): ${(e as Error).message}`);
  }
}

/** Load the candidate pool: everything captured within `windowDays`. */
export async function loadCandidates(windowDays = 30): Promise<Candidate[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const path =
    `monitor_candidates?select=*&first_seen=gte.${encodeURIComponent(since)}` +
    `&order=first_seen.desc`;
  const rows = (await sbGetAll(path, "monitor_candidates")) as CandidateRow[];
  return rows.map(rowToCandidate);
}

/** Posting keys any previous digest already put in front of Ray. */
export async function loadDigestedKeys(): Promise<Set<string>> {
  const rows = (await sbGetAll("monitor_digest?select=posting_key", "monitor_digest")) as {
    posting_key: string;
  }[];
  return new Set(rows.map((r) => r.posting_key));
}

/** Record today's queue so tomorrow's picks fresh roles. Idempotent per key. */
export async function recordDigested(
  entries: { key: string; rank: number }[],
  digestedOn: string,
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    posting_key: e.key,
    digested_on: digestedOn,
    rank: e.rank,
  }));
  const res = await fetch(`${restBase()}/monitor_digest`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    if (missingTable(res.status, body)) throw new MissingTableError("monitor_digest");
    throw new Error(`recordDigested HTTP ${res.status}: ${body}`);
  }
}

/**
 * Normalized URLs of tracker rows Ray has already acted on (anything past
 * Wishlist — Applied, Screen, Interview, Offer, Accepted, Rejected).
 *
 * This is the one place the queue listens back to the tracker app: a role he
 * applied to this morning must not reappear tomorrow, and one he was rejected
 * from must never come back at all. Matched on the application URL because that
 * is what the monitor writes into `applications.link`.
 *
 * Degrades to "nothing acted on" rather than failing — worst case the queue
 * repeats a role, which is recoverable; a crashed digest is not.
 */
export async function loadActedUrlKeys(): Promise<Set<string>> {
  const userId = process.env.TRACKER_USER_ID;
  if (!userId) {
    console.warn("[digest] TRACKER_USER_ID not set — can't tell which roles were applied to.");
    return new Set();
  }
  try {
    const path =
      `applications?select=link,status&user_id=eq.${encodeURIComponent(userId)}` +
      `&status=neq.Wishlist`;
    const rows = (await sbGetAll(path, "applications")) as { link: string; status: string }[];
    const keys = new Set<string>();
    for (const r of rows) {
      const k = normalizedUrlKey(r.link ?? "");
      if (k) keys.add(k);
    }
    return keys;
  } catch (e) {
    console.error(`[digest] tracker status read failed: ${(e as Error).message}`);
    return new Set();
  }
}
