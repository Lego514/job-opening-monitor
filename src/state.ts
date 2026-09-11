import { type LlmVerdict, type Posting, postingKey } from "./types";

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
