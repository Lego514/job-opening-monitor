import { describe, it, expect } from "vitest";
import { selectAlertable } from "../src/select";
import { type Posting } from "../src/types";

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
});
