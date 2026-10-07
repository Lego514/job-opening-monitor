import { AsyncLocalStorage } from "node:async_hooks";

// Per-source health: how fast each of the 115 sources answers, and when one
// fails, which layer failed. "Workday X: FAILED" used to be all a run said, and
// it could mean the DNS name stopped resolving, the host refused the TCP
// connection, its TLS certificate broke, it rate-limited the runner, or it
// answered fine and changed its JSON. Each of those needs a different fix, so
// the run now says which one it was, and tracks failures across runs so a
// source that stays broken alerts once instead of hiding in the log.

/** Where a request failed, ordered roughly from the bottom of the stack up. */
export type FailureLayer =
  | "dns" // the hostname did not resolve
  | "tcp" // no connection: refused, reset, unreachable, connect timeout
  | "tls" // connected, but the certificate or handshake failed
  | "timeout" // connected, but no complete answer before our deadline
  | "rate_limited" // HTTP 429
  | "http_4xx" // the server answered with a client error (moved, gone, forbidden)
  | "http_5xx" // the server answered with a server error
  | "parse" // a 2xx answer whose body was not what the adapter expected
  | "unknown";

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME"]);
const TCP_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Error codes along `e` and its `cause` chain (undici wraps the real one). */
function codesOf(e: unknown): string[] {
  const out: string[] = [];
  for (let cur = e, depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") out.push(code);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

function isTlsCode(code: string): boolean {
  return (
    code.startsWith("ERR_TLS") ||
    code.startsWith("ERR_SSL") ||
    code.startsWith("CERT_") ||
    code.includes("CERT") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
  );
}

/** HTTP status → layer, or null for a success status. */
export function layerForStatus(status: number): FailureLayer | null {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "http_5xx";
  if (status >= 400) return "http_4xx";
  return null;
}

/**
 * Which layer a thrown error points at. `lastStatus` is the last HTTP status this
 * source received, for adapters whose error message doesn't carry it.
 */
export function classifyFailure(e: unknown, lastStatus?: number): FailureLayer {
  const codes = codesOf(e);
  if (codes.some((c) => DNS_CODES.has(c))) return "dns";
  if (codes.some(isTlsCode)) return "tls";
  if (codes.some((c) => TCP_CODES.has(c))) return "tcp";

  const name = (e as { name?: unknown })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";

  // Adapters throw `${source} HTTP ${status}` on a non-2xx answer.
  const message = e instanceof Error ? e.message : String(e);
  const m = /\bHTTP (\d{3})\b/.exec(message);
  const fromStatus = layerForStatus(m ? Number(m[1]) : (lastStatus ?? 200));
  if (fromStatus) return fromStatus;

  if (e instanceof SyntaxError) return "parse";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Recording. Every adapter calls the global `fetch`, so one wrapper sees every
// request without touching the adapters. AsyncLocalStorage tells the wrapper
// which source a request belongs to; requests made outside a source (Supabase,
// Telegram) carry no source and are not recorded.

export interface RequestRecord {
  source: string;
  ms: number;
  status?: number; // set when the server answered
  layer?: FailureLayer; // set when the request failed or answered with an error status
}

const current = new AsyncLocalStorage<string>();
const records: RequestRecord[] = [];
let installed = false;

/** Run `fn` with every fetch inside it attributed to `source`. */
export function withSource<T>(source: string, fn: () => Promise<T>): Promise<T> {
  return current.run(source, fn);
}

/** Wrap the global fetch once so requests made inside `withSource` are timed. */
export function instrumentFetch(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const source = current.getStore();
    if (!source) return original(input, init);
    const start = performance.now();
    try {
      const res = await original(input, init);
      const layer = layerForStatus(res.status) ?? undefined;
      records.push({ source, ms: performance.now() - start, status: res.status, layer });
      return res;
    } catch (e) {
      records.push({ source, ms: performance.now() - start, layer: classifyFailure(e) });
      throw e;
    }
  };
}

/** Everything recorded so far (a copy). */
export function recordedRequests(): RequestRecord[] {
  return [...records];
}

/** Last HTTP status recorded for `source`, if any. */
export function lastStatusFor(source: string): number | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].source === source && records[i].status !== undefined) return records[i].status;
  }
  return undefined;
}

/** Test hook. */
export function resetRecords(): void {
  records.length = 0;
}

// ---------------------------------------------------------------------------
// Per-run summary.

export interface SourceOutcome {
  source: string;
  ok: boolean;
  layer?: FailureLayer; // why it failed, when !ok
  message?: string;
}

export interface SourceHealth {
  source: string;
  ok: boolean;
  layer?: FailureLayer;
  requests: number;
  errors: number; // requests that failed or answered with an error status
  p50Ms: number | null;
  p95Ms: number | null;
}

/** Nearest-rank percentile of `values` (p in 0..100), or null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Join the run's outcomes with its request records into one row per source. */
export function summarize(outcomes: SourceOutcome[], reqs: RequestRecord[]): SourceHealth[] {
  return outcomes.map((o) => {
    const mine = reqs.filter((r) => r.source === o.source);
    const answered = mine.filter((r) => r.status !== undefined).map((r) => r.ms);
    return {
      source: o.source,
      ok: o.ok,
      layer: o.layer,
      requests: mine.length,
      errors: mine.filter((r) => r.layer).length,
      p50Ms: round(percentile(answered, 50)),
      p95Ms: round(percentile(answered, 95)),
    };
  });
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}

/** Count of failed sources per layer, most common first. */
export function failuresByLayer(rows: SourceHealth[]): [FailureLayer, number][] {
  const counts = new Map<FailureLayer, number>();
  for (const r of rows) if (!r.ok) counts.set(r.layer ?? "unknown", (counts.get(r.layer ?? "unknown") ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** One console line for the whole run. */
export function healthLine(rows: SourceHealth[]): string {
  const failed = rows.filter((r) => !r.ok).length;
  const p95s = rows.map((r) => r.p95Ms).filter((n): n is number => n !== null);
  const layers = failuresByLayer(rows)
    .map(([l, n]) => `${l} ${n}`)
    .join(", ");
  return (
    `[health] ${rows.length - failed}/${rows.length} sources ok` +
    (p95s.length ? `, median source p95 ${percentile(p95s, 50)} ms` : "") +
    (failed ? ` — failed by layer: ${layers}` : "")
  );
}

/** Markdown table for the GitHub Actions job summary: failures first, then the slowest. */
export function healthMarkdown(rows: SourceHealth[]): string {
  const sorted = [...rows].sort(
    (a, b) => Number(a.ok) - Number(b.ok) || (b.p95Ms ?? -1) - (a.p95Ms ?? -1),
  );
  const lines = [
    "## Source health",
    "",
    healthLine(rows).replace(/^\[health\] /, ""),
    "",
    "| Source | Status | Failed layer | Requests | Errors | p50 ms | p95 ms |",
    "|---|---|---|---:|---:|---:|---:|",
    ...sorted.map(
      (r) =>
        `| ${r.source} | ${r.ok ? "ok" : "FAILED"} | ${r.layer ?? ""} | ${r.requests} | ${r.errors} | ` +
        `${r.p50Ms ?? ""} | ${r.p95Ms ?? ""} |`,
    ),
  ];
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Across runs. The monitor runs every ~15 minutes, so one failed run is noise
// (a blip, a deploy on their side). A source alerts once it has failed
// UNHEALTHY_AFTER runs in a row, once, and again when it recovers.

export const UNHEALTHY_AFTER = 4; // about an hour of consecutive failures

export interface HealthState {
  source: string;
  consecutiveFailures: number;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  lastFailureLayer: FailureLayer | null;
  lastP95Ms: number | null;
}

export type Transition = "became_unhealthy" | "recovered" | null;

/** Fold one run's result into a source's stored state. Pure. */
export function nextState(
  prev: HealthState | undefined,
  run: SourceHealth,
  now: string,
): { state: HealthState; transition: Transition } {
  const before = prev?.consecutiveFailures ?? 0;
  const state: HealthState = {
    source: run.source,
    consecutiveFailures: run.ok ? 0 : before + 1,
    lastOkAt: run.ok ? now : (prev?.lastOkAt ?? null),
    lastFailureAt: run.ok ? (prev?.lastFailureAt ?? null) : now,
    lastFailureLayer: run.ok ? (prev?.lastFailureLayer ?? null) : (run.layer ?? "unknown"),
    lastP95Ms: run.p95Ms ?? prev?.lastP95Ms ?? null,
  };
  let transition: Transition = null;
  if (!run.ok && state.consecutiveFailures === UNHEALTHY_AFTER) transition = "became_unhealthy";
  if (run.ok && before >= UNHEALTHY_AFTER) transition = "recovered";
  return { state, transition };
}

/** Telegram text for this run's transitions, or null when nothing changed. */
export function transitionMessage(
  changes: { state: HealthState; transition: Transition }[],
): string | null {
  const down = changes.filter((c) => c.transition === "became_unhealthy");
  const up = changes.filter((c) => c.transition === "recovered");
  if (!down.length && !up.length) return null;
  const parts: string[] = [];
  if (down.length) {
    parts.push(
      `🔴 ${down.length} source(s) failing ${UNHEALTHY_AFTER}+ runs in a row:\n` +
        down.map((c) => `  • ${c.state.source} — ${c.state.lastFailureLayer}`).join("\n"),
    );
  }
  if (up.length) {
    parts.push(`🟢 recovered: ${up.map((c) => c.state.source).join(", ")}`);
  }
  return parts.join("\n\n");
}
