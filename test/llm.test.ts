import { describe, it, expect, vi } from "vitest";
import {
  buildUserPrompt,
  parseVerdict,
  applyVerdict,
  classifyAll,
  isCreditExhausted,
  llmFailureWarning,
  creditAlarm,
  creditEscalationMessage,
  LLM_HEALTH_SOURCE,
  LLM_MODEL,
  llmEnabled,
} from "../src/llm";
import { type HealthState, UNHEALTHY_AFTER } from "../src/health";
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
    // Held keys must be kept out of `seen` so they come round again.
    expect([...r.held]).toEqual(["Acme:c"]);
    expect(r.deferred).toBe(1);
  });

  it("survives an API outage — and holds the unscreened roles back", async () => {
    const client = {
      messages: { create: vi.fn(async () => { throw new Error("529 overloaded"); }) },
    } as never;
    const posts = [mk({ id: "a" }), mk({ id: "b" })];
    const r = await classifyAll(posts, { max: 10, client });

    expect(r.failed).toBe(2);
    expect(r.classified).toBe(0);
    expect(posts.every((p) => p.llm === undefined)).toBe(true);
    // Fail closed: an unscreened role must never be alerted as if it had passed.
    expect([...r.held].sort()).toEqual(["Acme:a", "Acme:b"]);
    expect(r.creditExhausted).toBe(false);
  });

  it("counts an unusable response as a failure, not a verdict", async () => {
    const { client } = fakeClient(() => ({ newGradFit: "yes" })); // missing everything else
    const posts = [mk({ id: "a" })];
    const r = await classifyAll(posts, { max: 10, client });

    expect(r.failed).toBe(1);
    expect(posts[0].llm).toBeUndefined();
    expect(r.held.has("Acme:a")).toBe(true);
  });

  it("does nothing (and costs nothing) for an empty batch", async () => {
    const r = await classifyAll([], { max: 10 });
    expect(r).toMatchObject({ classified: 0, cached: 0, failed: 0, skipped: 0, costUsd: 0 });
    expect(r.held.size).toBe(0);
  });
});

describe("classifyAll — the gate", () => {
  it("only sends what the gate keeps, and never holds the rest back", async () => {
    const { client, create } = fakeClient(() => VERDICT);
    const posts = [mk({ id: "keep" }), mk({ id: "skip" }), mk({ id: "keep2" })];
    const r = await classifyAll(posts, {
      max: 10,
      client,
      gate: (p) => p.id.startsWith("keep"),
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(r.classified).toBe(2);
    expect(r.skipped).toBe(1);
    // A gated-out role is regex-judged on purpose — it is NOT a degradation, so
    // it stays in the alert set and gets recorded as seen like any other.
    expect(r.held.size).toBe(0);
  });

  it("still applies a cached verdict to a posting the gate would skip", async () => {
    const { client, create } = fakeClient(() => VERDICT);
    const posts = [mk({ id: "skip" })];
    const r = await classifyAll(posts, {
      max: 10,
      client,
      gate: () => false,
      cache: new Map([["Acme:skip", { ...VERDICT, newGradFit: "no" as const }]]),
    });

    expect(create).not.toHaveBeenCalled();
    expect(r.cached).toBe(1);
    // A verdict already paid for is free to reuse — and this one rejects the role.
    expect(posts[0].llm?.newGradFit).toBe("no");
  });
});

describe("isCreditExhausted", () => {
  // The literal shape the API returned on 2026-09-16, when this whole failure
  // mode was discovered.
  const REAL = Object.assign(
    new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit ' +
        'balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade."}}',
    ),
    { status: 400 },
  );

  it("recognizes the billing 400", () => {
    expect(isCreditExhausted(REAL)).toBe(true);
    // Same error reached through the SDK's structured body instead of the message.
    expect(
      isCreditExhausted({
        status: 400,
        error: { error: { type: "invalid_request_error", message: "Your credit balance is too low" } },
      }),
    ).toBe(true);
  });

  it("does not mistake a transient failure for a billing one", () => {
    expect(isCreditExhausted(new Error("529 overloaded"))).toBe(false);
    expect(isCreditExhausted(new Error("429 rate_limit_error"))).toBe(false);
    expect(isCreditExhausted({ status: 429, message: "rate limited" })).toBe(false);
    // A 400 about something else must not stop the run either.
    expect(
      isCreditExhausted({ status: 400, message: '400 {"type":"invalid_request_error"} max_tokens too large' }),
    ).toBe(false);
    expect(isCreditExhausted(null)).toBe(false);
    expect(isCreditExhausted("400 credit balance")).toBe(false);
  });
});

describe("classifyAll — credit exhaustion", () => {
  const creditError = () =>
    Object.assign(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit ' +
          'balance is too low to access the Anthropic API."}}',
      ),
      { status: 400 },
    );

  it("short-circuits after a few identical failures instead of hammering the API", async () => {
    const create = vi.fn(async () => { throw creditError(); });
    const posts = Array.from({ length: 50 }, (_, i) => mk({ id: `p${i}` }));
    const r = await classifyAll(posts, {
      max: 100,
      client: { messages: { create } } as never,
      concurrency: 1, // deterministic: one lane, so the abort lands on call 3
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(r.creditExhausted).toBe(true);
    expect(r.classified).toBe(0);
    // Every one of the 50 is held back: 3 attempted-and-failed, 47 abandoned.
    expect(r.held.size).toBe(50);
    expect(r.failed).toBe(3);
    expect(r.deferred).toBe(47);
  });

  it("keeps retrying a transient error — only billing stops the run", async () => {
    const create = vi.fn(async () => { throw new Error("529 overloaded"); });
    const posts = Array.from({ length: 8 }, (_, i) => mk({ id: `p${i}` }));
    const r = await classifyAll(posts, {
      max: 100,
      client: { messages: { create } } as never,
      concurrency: 1,
    });

    // No short-circuit: every posting was attempted (the SDK's own retry policy
    // is what handles 429/529, and it is untouched here).
    expect(create).toHaveBeenCalledTimes(8);
    expect(r.creditExhausted).toBe(false);
    expect(r.failed).toBe(8);
    expect(r.held.size).toBe(8);
  });

  it("holds back only the failures when some calls succeed", async () => {
    let n = 0;
    const create = vi.fn(async () => {
      if (++n === 2) throw new Error("529 overloaded");
      return {
        content: [{ type: "tool_use", name: "record_classification", input: VERDICT }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      };
    });
    const posts = [mk({ id: "a" }), mk({ id: "b" }), mk({ id: "c" })];
    const r = await classifyAll(posts, {
      max: 10,
      client: { messages: { create } } as never,
      concurrency: 1,
    });

    expect(r.classified).toBe(2);
    expect(r.failed).toBe(1);
    expect([...r.held]).toEqual(["Acme:b"]); // the other two alert as normal
    expect(posts[0].llm).toBeDefined();
    expect(posts[1].llm).toBeUndefined();
    expect(posts[2].llm).toBeDefined();
  });
});

describe("llmFailureWarning", () => {
  it("says nothing when nothing failed", () => {
    expect(llmFailureWarning({ failed: 0, held: new Set(["x"]), creditExhausted: false })).toBeNull();
  });

  it("names the credit case and the number of roles held back", () => {
    const msg = llmFailureWarning({
      failed: 3,
      held: new Set(["a", "b", "c", "d"]),
      creditExhausted: true,
    });
    expect(msg).toContain("⚠️ LLM classification unavailable (credit/API error)");
    expect(msg).toContain("4 role(s) held back");
    expect(msg).toContain("regex-only this run");
  });

  it("distinguishes a partial failure from a dead API", () => {
    const msg = llmFailureWarning({ failed: 2, held: new Set(["a", "b"]), creditExhausted: false });
    expect(msg).toContain("partly failed (2 call(s))");
    expect(msg).toContain("2 role(s) held back");
  });
});

describe("creditAlarm", () => {
  /** Run `outcomes` through the alarm in order, `hoursApart` between runs. */
  function play(outcomes: ("ok" | "exhausted")[], start: string, hoursApart: number) {
    let state: HealthState | undefined;
    const actions = outcomes.map((o, i) => {
      const now = new Date(Date.parse(start) + i * hoursApart * 3_600_000).toISOString();
      const r = creditAlarm(state, o, now);
      state = r.state;
      return r.action;
    });
    return { actions, state: state! };
  }

  it("warns per run early in an outage, then escalates at UNHEALTHY_AFTER", () => {
    const { actions, state } = play(Array(UNHEALTHY_AFTER).fill("exhausted"), "2026-10-20T12:00:00Z", 1);
    expect(actions).toEqual([...Array(UNHEALTHY_AFTER - 1).fill("warn"), "escalate"]);
    expect(state.source).toBe(LLM_HEALTH_SOURCE);
    expect(state.consecutiveFailures).toBe(UNHEALTHY_AFTER);
  });

  it("goes quiet for the rest of that day instead of repeating the warning", () => {
    // 12:00..18:00 UTC = 08:00..14:00 in New York: one day.
    const { actions } = play(Array(UNHEALTHY_AFTER + 3).fill("exhausted"), "2026-10-20T12:00:00Z", 1);
    expect(actions.slice(UNHEALTHY_AFTER)).toEqual(["quiet", "quiet", "quiet"]);
  });

  it("escalates again on the first failing run of the next New York day", () => {
    // Regression: the 2026-09-16..10-21 outage sent ~200 identical ⚠️ and nothing louder.
    // Four runs a day, 6h apart, at 09/15/21/03 ET from 10/20 09:00 ET.
    const { actions } = play(Array(10).fill("exhausted"), "2026-10-20T13:00:00Z", 6);
    expect(UNHEALTHY_AFTER).toBe(4); // the sequence below is written for 4
    expect(actions).toEqual([
      "warn", "warn", "warn", // 10/20
      "escalate", "quiet", "quiet", "quiet", // 10/21 03:00 ET reaches the threshold
      "escalate", "quiet", "quiet", // 10/22: first failing run of the day
    ]);
  });

  it("reads the day in New York, not UTC", () => {
    const { state } = play(Array(UNHEALTHY_AFTER).fill("exhausted"), "2026-10-20T20:00:00Z", 1);
    // Last failure was 2026-10-20T23:00Z (19:00 ET); 03:00Z the next UTC day is still 10/20 ET.
    expect(creditAlarm(state, "exhausted", "2026-10-21T03:00:00Z").action).toBe("quiet");
    expect(creditAlarm(state, "exhausted", "2026-10-21T05:00:00Z").action).toBe("escalate");
  });

  it("announces recovery once, only after an escalation", () => {
    const down = play(Array(UNHEALTHY_AFTER).fill("exhausted"), "2026-10-20T12:00:00Z", 1).state;
    const back = creditAlarm(down, "ok", "2026-10-20T20:00:00Z");
    expect(back.action).toBe("recovered");
    expect(back.state.consecutiveFailures).toBe(0);
    expect(back.state.lastOkAt).toBe("2026-10-20T20:00:00Z");
    expect(creditAlarm(back.state, "ok", "2026-10-20T21:00:00Z").action).toBeNull();

    const blip = play(["exhausted", "ok"], "2026-10-20T12:00:00Z", 1);
    expect(blip.actions).toEqual(["warn", null]);
  });
});

describe("creditEscalationMessage", () => {
  const state: HealthState = {
    source: LLM_HEALTH_SOURCE,
    consecutiveFailures: 31,
    lastOkAt: "2026-10-15T14:00:00Z",
    lastFailureAt: "2026-10-21T14:00:00Z",
    lastFailureLayer: "http_4xx",
    lastP95Ms: null,
  };

  it("says what is lost, how to fix it, and why the run is red", () => {
    const msg = creditEscalationMessage(state, 777);
    expect(msg).toContain("🚨🚨 LLM SCREENING IS DOWN");
    expect(msg).toContain("31 runs in a row (last worked Thu, Oct 15)");
    expect(msg).toContain("777 best-fit role(s)");
    expect(msg).toContain("console.anthropic.com → Settings → Billing");
    expect(msg).toContain("marked FAILED on purpose");
    expect(msg).not.toMatch(/[<>&]/); // sent with parse_mode HTML
  });

  it("copes with no recorded success", () => {
    expect(creditEscalationMessage({ ...state, lastOkAt: null }, 1)).toContain(
      "down since before this alarm existed",
    );
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
