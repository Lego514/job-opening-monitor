import { describe, it, expect } from "vitest";
import { dollarValue, salaryFloor, isDelaware, h1bWageHint } from "../src/rank";

describe("dollarValue / salaryFloor", () => {
  it("parses plain, comma'd, and K-suffixed amounts", () => {
    expect(dollarValue("$64,491")).toBe(64491);
    expect(dollarValue("$95K")).toBe(95000);
    expect(dollarValue("$95k–$120k")).toBe(95000); // floor of a range
    expect(dollarValue("$130,000-$160,000")).toBe(130000);
    expect(salaryFloor("$120K")).toBe(120000);
  });
  it("returns null when there's no amount", () => {
    expect(dollarValue("competitive")).toBeNull();
    expect(dollarValue(null)).toBeNull();
  });
});

describe("h1bWageHint uses the K-aware floor", () => {
  it("flags a $130K+ role as strong, $105–130K as decent", () => {
    expect(h1bWageHint("$180,000")).toMatch(/strong/);
    expect(h1bWageHint("$130K")).toMatch(/strong/);
    expect(h1bWageHint("$110K")).toMatch(/decent/);
    expect(h1bWageHint("$90,000")).toBeNull();
  });
});

describe("isDelaware", () => {
  it("matches DE commutable-ring cities", () => {
    expect(isDelaware("Wilmington, DE")).toBe(true);
    expect(isDelaware("Newark, DE")).toBe(true);
    expect(isDelaware("Philadelphia, PA")).toBe(true);
    expect(isDelaware("Delaware, United States")).toBe(true);
    expect(isDelaware("San Francisco, CA")).toBe(false);
    expect(isDelaware("")).toBe(false);
  });
  it("rejects same-named cities in other states (C1)", () => {
    expect(isDelaware("Newark, NJ")).toBe(false);
    expect(isDelaware("Newark, New Jersey")).toBe(false);
    expect(isDelaware("Wilmington, NC")).toBe(false);
    expect(isDelaware("Wilmington, Massachusetts")).toBe(false);
  });
  it("keeps a DE role even when a second location names another state", () => {
    expect(isDelaware("Wilmington, DE · Jersey City, NJ")).toBe(true);
  });
});
