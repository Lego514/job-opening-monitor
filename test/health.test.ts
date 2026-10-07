import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  classifyFailure,
  failuresByLayer,
  healthLine,
  healthMarkdown,
  instrumentFetch,
  lastStatusFor,
  nextState,
  percentile,
  recordedRequests,
  resetRecords,
  summarize,
  transitionMessage,
  UNHEALTHY_AFTER,
  withSource,
  type HealthState,
  type SourceHealth,
} from "../src/health";

/** The shape undici throws: TypeError("fetch failed") with the real error as `cause`. */
function fetchFailed(code: string): TypeError {
  const cause = Object.assign(new Error(code), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

describe("classifyFailure", () => {
  it("finds the layer in undici's cause chain", () => {
    expect(classifyFailure(fetchFailed("ENOTFOUND"))).toBe("dns");
    expect(classifyFailure(fetchFailed("EAI_AGAIN"))).toBe("dns");
    expect(classifyFailure(fetchFailed("ECONNREFUSED"))).toBe("tcp");
    expect(classifyFailure(fetchFailed("ECONNRESET"))).toBe("tcp");
    expect(classifyFailure(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe("tcp");
    expect(classifyFailure(fetchFailed("CERT_HAS_EXPIRED"))).toBe("tls");
    expect(classifyFailure(fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID"))).toBe("tls");
    expect(classifyFailure(fetchFailed("UNABLE_TO_VERIFY_LEAF_SIGNATURE"))).toBe("tls");
  });

  it("treats our own deadline as a timeout, not a TCP failure", () => {
    const e = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(classifyFailure(e)).toBe("timeout");
  });

  it("reads the status from the adapters' `HTTP nnn` messages", () => {
    expect(classifyFailure(new Error("Workday Acme HTTP 429"))).toBe("rate_limited");
    expect(classifyFailure(new Error("Greenhouse Acme HTTP 503"))).toBe("http_5xx");
    expect(classifyFailure(new Error("Lever Acme HTTP 404"))).toBe("http_4xx");
  });

  it("falls back to the last status the source received", () => {
    expect(classifyFailure(new Error("no postings array"), 403)).toBe("http_4xx");
    expect(classifyFailure(new Error("no postings array"), 200)).toBe("unknown");
  });

  it("calls a bad body on a good answer a parse failure", () => {
    expect(classifyFailure(new SyntaxError("Unexpected token < in JSON"), 200)).toBe("parse");
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("fetch instrumentation", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.statusCode = req.url === "/limited" ? 429 : 200;
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    instrumentFetch();
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => resetRecords());

  it("attributes each request to the source it ran under, even interleaved", async () => {
    await Promise.all([
      withSource("A", async () => {
        await fetch(`${base}/ok`);
        await fetch(`${base}/ok`);
      }),
      withSource("B", () => fetch(`${base}/limited`)),
    ]);
    const recs = recordedRequests();
    expect(recs.filter((r) => r.source === "A")).toHaveLength(2);
    const b = recs.filter((r) => r.source === "B");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ status: 429, layer: "rate_limited" });
    expect(lastStatusFor("B")).toBe(429);
  });

  it("does not record requests made outside a source", async () => {
    await fetch(`${base}/ok`);
    expect(recordedRequests()).toHaveLength(0);
  });

  it("records a connection failure with its layer", async () => {
    // Open a port, then close it: nothing listens there, so the connection is refused.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    await expect(withSource("C", () => fetch(`http://127.0.0.1:${port}/`))).rejects.toThrow();
    expect(recordedRequests()).toEqual([expect.objectContaining({ source: "C", layer: "tcp" })]);
  });
});

describe("summarize and report", () => {
  const rows: SourceHealth[] = summarize(
    [
      { source: "Fast", ok: true },
      { source: "Slow", ok: true },
      { source: "Gone", ok: false, layer: "dns" },
      { source: "Busy", ok: false, layer: "rate_limited" },
    ],
    [
      { source: "Fast", ms: 100, status: 200 },
      { source: "Fast", ms: 300, status: 200 },
      { source: "Slow", ms: 2000, status: 200 },
      { source: "Busy", ms: 50, status: 429, layer: "rate_limited" },
      { source: "Gone", ms: 5, layer: "dns" },
    ],
  );

  it("builds one row per source with latency from answered requests only", () => {
    const fast = rows.find((r) => r.source === "Fast")!;
    expect(fast).toMatchObject({ ok: true, requests: 2, errors: 0, p50Ms: 100, p95Ms: 300 });
    const gone = rows.find((r) => r.source === "Gone")!;
    expect(gone).toMatchObject({ ok: false, layer: "dns", requests: 1, errors: 1, p95Ms: null });
  });

  it("counts failures by layer and says so in one line", () => {
    expect(failuresByLayer(rows)).toEqual([
      ["dns", 1],
      ["rate_limited", 1],
    ]);
    expect(healthLine(rows)).toMatch(/^\[health\] 2\/4 sources ok, .* failed by layer: dns 1, rate_limited 1$/);
  });

  it("lists failures first, then the slowest, in the job summary", () => {
    const table = healthMarkdown(rows).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Source"));
    expect(table.map((l) => l.split("|")[1].trim())).toEqual(["Busy", "Gone", "Slow", "Fast"]);
  });
});

describe("state across runs", () => {
  const ok: SourceHealth = { source: "S", ok: true, requests: 1, errors: 0, p50Ms: 120, p95Ms: 150 };
  const down: SourceHealth = { source: "S", ok: false, layer: "tls", requests: 1, errors: 1, p50Ms: null, p95Ms: null };

  /** Fold a sequence of runs, collecting transitions. */
  function play(runs: SourceHealth[]) {
    let state: HealthState | undefined;
    const transitions: (string | null)[] = [];
    runs.forEach((r, i) => {
      const n = nextState(state, r, `2026-10-07T00:${String(i).padStart(2, "0")}:00Z`);
      state = n.state;
      transitions.push(n.transition);
    });
    return { state: state!, transitions };
  }

  it("alerts once when a source stays down, not on every failed run", () => {
    const { state, transitions } = play(Array(UNHEALTHY_AFTER + 2).fill(down));
    expect(transitions.filter((t) => t === "became_unhealthy")).toHaveLength(1);
    expect(transitions[UNHEALTHY_AFTER - 1]).toBe("became_unhealthy");
    expect(state).toMatchObject({ consecutiveFailures: UNHEALTHY_AFTER + 2, lastFailureLayer: "tls" });
  });

  it("does not alert for a short blip", () => {
    const { transitions } = play([down, down, ok, down]);
    expect(transitions.every((t) => t === null)).toBe(true);
  });

  it("reports recovery only after it had been reported down", () => {
    const { state, transitions } = play([...Array(UNHEALTHY_AFTER).fill(down), ok]);
    expect(transitions.at(-1)).toBe("recovered");
    expect(state).toMatchObject({ consecutiveFailures: 0, lastFailureLayer: "tls", lastP95Ms: 150 });
  });

  it("formats the transitions for Telegram", () => {
    const changes = [
      { state: { ...play(Array(UNHEALTHY_AFTER).fill(down)).state }, transition: "became_unhealthy" as const },
      { state: { ...play([ok]).state, source: "T" }, transition: "recovered" as const },
    ];
    const msg = transitionMessage(changes)!;
    expect(msg).toContain("S — tls");
    expect(msg).toContain("recovered: T");
    expect(transitionMessage([{ state: play([ok]).state, transition: null }])).toBeNull();
  });
});
