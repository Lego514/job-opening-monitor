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
  it("returns null for empty / unrecognized", () => {
    expect(postedDays("")).toBeNull();
    expect(postedDays("recently")).toBeNull();
  });
});
