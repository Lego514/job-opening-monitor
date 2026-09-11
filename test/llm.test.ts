import { describe, it, expect, vi } from "vitest";
import {
  buildUserPrompt,
  parseVerdict,
  applyVerdict,
  classifyAll,
  LLM_MODEL,
  llmEnabled,
} from "../src/llm";
import { type LlmVerdict, type Posting } from "../src/types";

const mk = (over: Partial<Posting> = {}): Posting => ({
  id: "R-1",
  company: "Acme",
  title: "Data Analyst",
  location: "Wilmington, DE",
  url: "https://example.test/1",
  postedOn: "Posted Today",
  ...over,
});

const VERDICT: LlmVerdict = {
  newGradFit: "yes",
  seniority: "new-grad",
  roleFamily: "data-analyst",
  sponsorship: "silent",
  remoteUS: false,
  summary: "Entry-level reporting role on the finance analytics team.",
};

/** Minimal stand-in for the SDK client — no network is touched in `npm test`. */
function fakeClient(handler: (prompt: string) => unknown) {
  const create = vi.fn(async (params: { messages: { content: string }[] }) => ({
    content: [
      { type: "tool_use", name: "record_classification", input: handler(params.messages[0].content) },
    ],
    usage: { input_tokens: 1000, output_tokens: 100 },
  }));
  return { client: { messages: { create } } as never, create };
}

describe("buildUserPrompt", () => {
  it("carries the three things the model has to judge on", () => {
    const prompt = buildUserPrompt(mk({ jdText: "We are hiring a junior analyst." }));
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("Data Analyst");
    expect(prompt).toContain("Wilmington, DE");
    expect(prompt).toContain("junior analyst");
  });

  it("truncates the JD and collapses whitespace (the cost lever)", () => {
    const prompt = buildUserPrompt(mk({ jdText: "word ".repeat(5000) }));
    expect(prompt.length).toBeLessThan(4400);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it("falls back to the adapter-supplied description (Lever/Ashby)", () => {
    expect(buildUserPrompt(mk({ description: "inline JD text" }))).toContain("inline JD text");
  });

  it("still produces a usable prompt when there is no JD at all", () => {
    const prompt = buildUserPrompt(mk({ title: "", location: "", company: "" }));
    expect(prompt).toContain("no description available");
    expect(prompt).toContain("unknown");
  });
});

describe("parseVerdict", () => {
  it("accepts a well-formed verdict", () => {
    expect(parseVerdict({ ...VERDICT, sponsorshipReason: "" })).toEqual(VERDICT);
  });

  it("rejects malformed output rather than trusting it", () => {
    expect(parseVerdict(null)).toBeNull();
    expect(parseVerdict("not an object")).toBeNull();
    expect(parseVerdict({})).toBeNull();
    // An enum the schema doesn't define would otherwise silently pass the
    // seniority gate in select.ts.
    expect(parseVerdict({ ...VERDICT, seniority: "super-senior" })).toBeNull();
    expect(parseVerdict({ ...VERDICT, newGradFit: "probably" })).toBeNull();
    expect(parseVerdict({ ...VERDICT, roleFamily: 7 })).toBeNull();
    expect(parseVerdict({ ...VERDICT, sponsorship: undefined })).toBeNull();
  });

  it("defaults the soft fields instead of failing on them", () => {
    const v = parseVerdict({ ...VERDICT, remoteUS: "yes", summary: undefined });
    expect(v).not.toBeNull();
    expect(v!.remoteUS).toBe(false); // only a real boolean true counts
    expect(v!.summary).toBe("");
  });

  it("drops a quoted reason attached to a 'silent' verdict (invented evidence)", () => {
    const v = parseVerdict({ ...VERDICT, sponsorship: "silent", sponsorshipReason: "no sponsorship" });
    expect(v!.sponsorshipReason).toBeUndefined();
  });

  it("keeps the reason when the JD actually said something", () => {
    const v = parseVerdict({
      ...VERDICT,
      sponsorship: "no-sponsorship",
      sponsorshipReason: "must be authorized to work without sponsorship",
    });
    expect(v!.sponsorshipReason).toContain("without sponsorship");
  });
});

describe("applyVerdict", () => {
  it("promotes a no-sponsorship verdict onto the posting", () => {
    const p = mk();
    applyVerdict(p, { ...VERDICT, sponsorship: "no-sponsorship", sponsorshipReason: "US citizens only" });
    expect(p.sponsorship).toBe("no");
    expect(p.sponsorshipReason).toBe("US citizens only");
  });

  it("never un-flags a role the regex classifier already ruled out", () => {
    const p = mk({ sponsorship: "no", sponsorshipReason: "requires security clearance" });
    applyVerdict(p, { ...VERDICT, sponsorship: "will-sponsor" });
    expect(p.sponsorship).toBe("no");
    expect(p.sponsorshipReason).toBe("requires security clearance");
  });

  it("marks remote when the model saw US-remote language", () => {
    const p = mk();
    applyVerdict(p, { ...VERDICT, remoteUS: true });
    expect(p.remote).toBe(true);
  });
});

describe("classifyAll", () => {
  it("classifies each posting and estimates the spend", async () => {
    const { client } = fakeClient(() => ({ ...VERDICT, sponsorshipReason: "" }));
    const posts = [mk({ id: "a" }), mk({ id: "b" })];
    const r = await classifyAll(posts, { max: 10, client });

    expect(r.classified).toBe(2);
    expect(r.failed).toBe(0);
    expect(posts.every((p) => p.llm?.seniority === "new-grad")).toBe(true);
    // 2 x (1000 in @ $1/MTok + 100 out @ $5/MTok).
    expect(r.costUsd).toBeCloseTo(0.003, 6);
    expect(r.fresh.get("Acme:a")).toEqual(VERDICT);
  });

  it("serves cache hits without calling the API", async () => {
    const { client, create } = fakeClient(() => VERDICT);
    const posts = [mk({ id: "a" }), mk({ id: "b" })];
    const cache = new Map([["Acme:a", VERDICT]]);
    const r = await classifyAll(posts, { max: 10, client, cache });

    expect(r.cached).toBe(1);
    expect(r.classified).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("honours the per-run ceiling and defers, rather than discards, the overflow", async () => {
    const { client } = fakeClient(() => VERDICT);
    const posts = [mk({ id: "a" }), mk({ id: "b" }), mk({ id: "c" })];
    const r = await classifyAll(posts, { max: 2, client });

    expect(r.classified).toBe(2);
    expect(posts.filter((p) => p.llm).length).toBe(2);
    // Deferred keys must be held back from `seen` so they come round again.
    expect([...r.deferred]).toEqual(["Acme:c"]);
  });

  it("survives an API outage — the postings just keep the regex verdict", async () => {
    const client = {
      messages: { create: vi.fn(async () => { throw new Error("529 overloaded"); }) },
    } as never;
    const posts = [mk({ id: "a" }), mk({ id: "b" })];
    const r = await classifyAll(posts, { max: 10, client });

    expect(r.failed).toBe(2);
    expect(r.classified).toBe(0);
    expect(posts.every((p) => p.llm === undefined)).toBe(true);
    // An outage is not a ceiling: these were attempted, so they are not held back.
    expect(r.deferred.size).toBe(0);
  });

  it("counts an unusable response as a failure, not a verdict", async () => {
    const { client } = fakeClient(() => ({ newGradFit: "yes" })); // missing everything else
    const posts = [mk({ id: "a" })];
    const r = await classifyAll(posts, { max: 10, client });

    expect(r.failed).toBe(1);
    expect(posts[0].llm).toBeUndefined();
  });

  it("does nothing (and costs nothing) for an empty batch", async () => {
    const r = await classifyAll([], { max: 10 });
    expect(r).toMatchObject({ classified: 0, cached: 0, failed: 0, costUsd: 0 });
    expect(r.deferred.size).toBe(0);
  });
});

describe("llmEnabled", () => {
  it("is off without a key — that is the regex fallback path", () => {
    expect(llmEnabled({})).toBe(false);
    expect(llmEnabled({ ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(llmEnabled({ ANTHROPIC_API_KEY: "sk-ant-test" })).toBe(true);
  });
});

describe("LLM_MODEL", () => {
  it("is the cheap model — this stage runs on every new posting", () => {
    expect(LLM_MODEL).toBe("claude-haiku-4-5");
  });
});
