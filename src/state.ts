import { type Posting, postingKey } from "./types";

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
