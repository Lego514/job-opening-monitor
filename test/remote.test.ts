import { describe, it, expect } from "vitest";
import { detectRemote } from "../src/remote";

describe("detectRemote", () => {
  it("detects role-level remote phrasing", () => {
    expect(detectRemote("This position is fully remote.")).toBe(true);
    expect(detectRemote("Remote-eligible role open to candidates across the US.")).toBe(true);
    expect(detectRemote("You may work from home.")).toBe(true);
    expect(detectRemote("Open to remote within the United States.")).toBe(true);
  });
  it("does not fire on incidental mentions", () => {
    expect(detectRemote("Collaborate with remote teams across time zones.")).toBe(false);
    expect(detectRemote("On-site in Wilmington, DE.")).toBe(false);
    expect(detectRemote("")).toBe(false);
  });
});
