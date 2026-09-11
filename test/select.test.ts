import { describe, it, expect } from "vitest";
import { selectAlertable, llmRejects } from "../src/select";
import { type LlmVerdict, type Posting } from "../src/types";

const mk = (id: string, sponsorship: "no" | "unknown", postedOn: string): Posting => ({
  id,
  company: "C",
  title: id,
  location: "Remote",
  url: "u",
  postedOn,
  sponsorship,
});

const sample: Posting[] = [
  mk("flagged-fresh", "no", "Posted Today"),
  mk("ok-old", "unknown", "Posted 20 Days Ago"),
  mk("ok-fresh", "unknown", "Posted Today"),
  mk("flagged-old", "no", "Posted 40+ Days Ago"),
];

describe("selectAlertable", () => {
  it("puts sponsorable roles first, then freshest first", () => {
    const out = selectAlertable(sample, { skipNoSponsorship: false });
    expect(out.map((p) => p.id)).toEqual(["ok-fresh", "ok-old", "flagged-fresh", "flagged-old"]);
  });
  it("drops flagged roles when skipNoSponsorship is set", () => {
    const out = selectAlertable(sample, { skipNoSponsorship: true });
    expect(out.every((p) => p.sponsorship !== "no")).toBe(true);
    expect(out).toHaveLength(2);
  });
  it("applies a max age limit (unknown age passes)", () => {
    const withUnknown = [...sample, mk("ok-unknown-age", "unknown", "whenever")];
    const out = selectAlertable(withUnknown, { skipNoSponsorship: false, maxAgeDays: 7 });
    const ids = out.map((p) => p.id);
    expect(ids).toContain("ok-fresh"); // 0 days
    expect(ids).toContain("ok-unknown-age"); // unparseable -> passes
    expect(ids).not.toContain("ok-old"); // 20 days > 7
    expect(ids).not.toContain("flagged-old"); // 40 days > 7
  });
  it("ranks DE-local, then cap-exempt, then higher wage, above a fresher remote role", () => {
    const de = { ...mk("de-old", "unknown", "Posted 20 Days Ago"), location: "Wilmington, DE" };
    const capExempt = { ...mk("cap-old", "unknown", "Posted 20 Days Ago"), location: "Remote", capExempt: true };
    const highWage = { ...mk("wage-old", "unknown", "Posted 20 Days Ago"), location: "Remote", salary: "$180,000" };
    const remoteFresh = mk("remote-fresh", "unknown", "Posted Today");
    const flagged = { ...mk("flagged-de", "no", "Posted Today"), location: "Newark, DE" };
    const out = selectAlertable([remoteFresh, highWage, capExempt, de, flagged], { skipNoSponsorship: false });
    expect(out.map((p) => p.id)).toEqual(["de-old", "cap-old", "wage-old", "remote-fresh", "flagged-de"]);
  });
});

describe("selectAlertable — location tiers", () => {
  const at = (id: string, location: string, capExempt = false): Posting => ({
    id,
    company: "C",
    title: id,
    location,
    url: "u",
    postedOn: "Posted Today",
    sponsorship: "unknown",
    capExempt,
  });

  it("orders DE-local, then cap-exempt, then NYC metro, then the rest", () => {
    const out = selectAlertable(
      [
        at("elsewhere", "Austin, TX"),
        at("nyc", "New York, NY"),
        at("capexempt", "Boston, MA", true),
        at("delaware", "Wilmington, DE"),
      ],
      { skipNoSponsorship: false },
    );
    expect(out.map((p) => p.id)).toEqual(["delaware", "capexempt", "nyc", "elsewhere"]);
  });

  // Skipping the H-1B lottery outranks the second-choice city.
  it("puts a cap-exempt role above a NYC one", () => {
    const out = selectAlertable(
      [at("nyc", "Brooklyn, NY"), at("capexempt", "Newark, DE", true)],
      { skipNoSponsorship: false },
    );
    expect(out[0].id).toBe("capexempt");
  });
});

describe("selectAlertable — LLM verdicts", () => {
  const verdict = (over: Partial<LlmVerdict> = {}): LlmVerdict => ({
    newGradFit: "yes",
    seniority: "new-grad",
    roleFamily: "data-analyst",
    sponsorship: "silent",
    remoteUS: false,
    summary: "",
    ...over,
  });
  const withLlm = (id: string, over: Partial<LlmVerdict> = {}): Posting => ({
    id,
    company: "C",
    title: id,
    location: "Remote",
    url: "u",
    postedOn: "Posted Today",
    sponsorship: "unknown",
    llm: verdict(over),
  });

  it("keeps a role with no verdict — the LLM never silently swallows one it didn't see", () => {
    const unseen: Posting = { id: "unseen", company: "C", title: "t", location: "Remote", url: "u", postedOn: "" };
    expect(llmRejects(unseen)).toBe(false);
    expect(selectAlertable([unseen], { skipNoSponsorship: false })).toHaveLength(1);
  });

  it("rejects newGradFit:no and anything mid or above", () => {
    expect(llmRejects(withLlm("x", { newGradFit: "no" }))).toBe(true);
    expect(llmRejects(withLlm("x", { seniority: "mid" }))).toBe(true);
    expect(llmRejects(withLlm("x", { seniority: "senior" }))).toBe(true);
    expect(llmRejects(withLlm("x", { seniority: "exec" }))).toBe(true);
    expect(llmRejects(withLlm("x", { newGradFit: "maybe" }))).toBe(false);
    expect(llmRejects(withLlm("x", { seniority: "entry" }))).toBe(false);
    expect(llmRejects(withLlm("x", { seniority: "intern" }))).toBe(false);
  });

  it("drops rejected roles from the alert set by default", () => {
    const out = selectAlertable(
      [withLlm("fit"), withLlm("too-senior", { seniority: "senior" }), withLlm("no-fit", { newGradFit: "no" })],
      { skipNoSponsorship: false },
    );
    expect(out.map((p) => p.id)).toEqual(["fit"]);
  });

  it("sorts rejects to the bottom, alongside no-sponsorship, when kept", () => {
    const de = { ...withLlm("de-reject", { newGradFit: "no" }), location: "Wilmington, DE" };
    const out = selectAlertable([de, withLlm("remote-fit")], {
      skipNoSponsorship: false,
      skipLlmReject: false,
    });
    // DE-local would normally win; a dead end never leads.
    expect(out.map((p) => p.id)).toEqual(["remote-fit", "de-reject"]);
  });
});
