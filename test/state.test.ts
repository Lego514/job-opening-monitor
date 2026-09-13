import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sbFetch, sbInsert, isTransient, MissingTableError } from "../src/state";

// Supabase's gateway 504s now and then (loadSeen 2026-09-10, a 400-row markSeen
// 2026-09-12). These pin the transport behaviour that keeps one of those from
// killing a run: retry transient statuses, chunk large writes, and still fail
// loudly on a real error.

const fast = { baseDelayMs: 0 };
const res = (status: number, body = "") => new Response(body, { status });

beforeEach(() => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("isTransient", () => {
  it("retries gateway errors and rate limits, not client errors", () => {
    expect(isTransient(504)).toBe(true);
    expect(isTransient(503)).toBe(true);
    expect(isTransient(429)).toBe(true);
    expect(isTransient(404)).toBe(false);
    expect(isTransient(409)).toBe(false);
    expect(isTransient(200)).toBe(false);
  });
});

describe("sbFetch", () => {
  it("retries a 504 and returns the eventual success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(504)).mockResolvedValueOnce(res(200, "[]"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sbFetch("https://x/y", {}, "t", fast);
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured attempts and returns the last response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(504));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sbFetch("https://x/y", {}, "t", { ...fast, attempts: 3 });
    expect(r.status).toBe(504);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(404));
    vi.stubGlobal("fetch", fetchMock);
    await sbFetch("https://x/y", {}, "t", fast);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network error, then rethrows it", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sbFetch("https://x/y", {}, "t", { ...fast, attempts: 2 })).rejects.toThrow("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("sbInsert", () => {
  it("splits a large write into chunks of 100", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(201));
    vi.stubGlobal("fetch", fetchMock);
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
    await sbInsert("monitor_seen_jobs", rows, "resolution=ignore-duplicates", "markSeen", fast);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("treats 409 as success (ignore-duplicates)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(409)));
    await expect(sbInsert("t", [{ id: "a" }], "resolution=ignore-duplicates", "l", fast)).resolves.toBeUndefined();
  });

  it("surfaces a missing table as MissingTableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(res(404, '{"code":"PGRST205","message":"Could not find the table"}')),
    );
    await expect(sbInsert("monitor_digest", [{ id: "a" }], "p", "l", fast)).rejects.toBeInstanceOf(
      MissingTableError,
    );
  });

  it("fails loudly on a persistent 504 rather than silently dropping rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(504, "Gateway Timeout")));
    await expect(sbInsert("t", [{ id: "a" }], "p", "markSeen", fast)).rejects.toThrow("markSeen HTTP 504");
  });
});
