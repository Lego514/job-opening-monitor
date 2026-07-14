import { describe, it, expect } from "vitest";
import { postedDays } from "../src/recency";

describe("postedDays", () => {
  it("parses Workday relative dates", () => {
    expect(postedDays("Posted Today")).toBe(0);
    expect(postedDays("Posted Yesterday")).toBe(1);
    expect(postedDays("Posted 5 Days Ago")).toBe(5);
    expect(postedDays("Posted 30+ Days Ago")).toBe(30);
    expect(postedDays("Posted 1 Day Ago")).toBe(1);
  });
  it("parses ISO dates (Greenhouse/Lever) into days since posting", () => {
    const now = Date.UTC(2026, 6, 14); // 2026-07-14
    expect(postedDays("2026-07-14", now)).toBe(0);
    expect(postedDays("2026-07-04", now)).toBe(10);
    expect(postedDays("2026-06-14", now)).toBe(30);
    expect(postedDays("2026-04-15", now)).toBe(90); // the stale Figma-style posting
    expect(postedDays("2026-06-18T12:00:00Z", now)).toBe(26); // ISO with time component
    expect(postedDays("2026-07-20", now)).toBe(0); // future date clamps to 0, never negative
  });
  it("returns null for empty / unrecognized", () => {
    expect(postedDays("")).toBeNull();
    expect(postedDays("recently")).toBeNull();
  });
});
