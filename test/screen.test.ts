import { describe, it, expect } from "vitest";
import { classifyReason, gateSummary, worthClassifying } from "../src/screen";
import { type Posting } from "../src/types";

const mk = (over: Partial<Posting> = {}): Posting => ({
  id: "R-1",
  company: "Acme",
  title: "Data Analyst",
  location: "Austin, TX",
  url: "https://example.test/1",
  postedOn: "Posted Today",
  sponsorship: "unknown",
  ...over,
});

const history = (initial: number): Posting["sponsorHistory"] => ({
  matched: "ACME CORP",
  initialApprovals: initial,
  continuingApprovals: 0,
  lastFy: 2023,
  fyRange: [2021, 2023],
  confidence: "exact",
  states: ["DE"],
  nearMiss: false,
});

describe("worthClassifying", () => {
  it("keeps every tier that can reach the daily queue", () => {
    expect(classifyReason(mk({ location: "Wilmington, DE" }))).toBe("de-local");
    expect(classifyReason(mk({ capExempt: true }))).toBe("cap-exempt");
    expect(classifyReason(mk({ location: "Brooklyn, NY" }))).toBe("nyc-metro");
    expect(classifyReason(mk({ remote: true }))).toBe("remote-us");
  });

  // Filing history is not a gate reason on its own: the source list is built out
  // of big sponsors, so it admitted 1,300 of 2,667 matches (measured 2026-09-16)
  // and left the gate keeping 77% — no cost lever at all. It still ranks the
  // role in selectAlertable and still shows up in the alert.
  it("does not pay for an out-of-area role just because its employer sponsors", () => {
    expect(classifyReason(mk({ location: "Austin, TX", sponsorHistory: history(1200) }))).toBeNull();
  });

  it("drops the roles that would rank below all of them anyway", () => {
    // An out-of-area role at an employer with no filing history: a verdict
    // could not lift it above a single DE / cap-exempt / NYC / proven-sponsor
    // role, so the call would buy nothing.
    expect(worthClassifying(mk())).toBe(false);
    expect(worthClassifying(mk({ remote: false, capExempt: false }))).toBe(false);
  });

  it("treats an employer the index could not place as unproven", () => {
    const none: Posting["sponsorHistory"] = {
      matched: null,
      initialApprovals: 0,
      continuingApprovals: 0,
      lastFy: null,
      fyRange: [2021, 2023],
      confidence: "none",
      states: [],
      nearMiss: true,
    };
    expect(worthClassifying(mk({ sponsorHistory: none }))).toBe(false);
  });

  it("never pays to read a JD that already ruled sponsorship out", () => {
    // The strongest possible gate reason, cancelled: applyVerdict can only ever
    // ADD a "no", so there is no verdict that changes what happens to this role.
    expect(worthClassifying(mk({ location: "Wilmington, DE", sponsorship: "no" }))).toBe(false);
    expect(worthClassifying(mk({ capExempt: true, sponsorship: "no" }))).toBe(false);
  });

  it("reports the strongest reason, in selectAlertable's own tier order", () => {
    const everything = mk({
      location: "Wilmington, DE",
      capExempt: true,
      remote: true,
      sponsorHistory: history(9),
    });
    expect(classifyReason(everything)).toBe("de-local");
    expect(classifyReason({ ...everything, location: "Austin, TX" })).toBe("cap-exempt");
  });

  it("handles a posting with no location at all", () => {
    expect(worthClassifying(mk({ location: "" }))).toBe(false);
    expect(worthClassifying(mk({ location: "", capExempt: true }))).toBe(true);
  });
});

describe("gateSummary", () => {
  it("counts the kept postings and breaks them down by reason", () => {
    const line = gateSummary([
      mk({ id: "a", location: "Newark, DE" }),
      mk({ id: "b", location: "New York, NY" }),
      mk({ id: "c" }),
      mk({ id: "d" }),
    ]);
    expect(line).toContain("[gate] 2/4 worth classifying");
    expect(line).toContain("de-local 1");
    expect(line).toContain("nyc-metro 1");
    expect(line).toContain("the other 2 stay regex-judged");
  });

  it("says something sane for an empty queue", () => {
    expect(gateSummary([])).toContain("0/0");
  });
});
