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

/** Set of already-seen posting keys (company-namespaced). */
export async function loadSeenKeys(): Promise<Set<string>> {
  const res = await fetch(`${restBase()}/monitor_seen_jobs?select=id`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`loadSeen HTTP ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as { id: string }[];
  return new Set(rows.map((r) => r.id));
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
