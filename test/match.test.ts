import { describe, it, expect } from "vitest";
import { matches } from "../src/match";
import { LOCAL_FILTERS } from "../src/config";
import { type Posting } from "../src/types";

const mk = (title: string, location: string): Posting => ({
  id: title,
  company: "X",
  title,
  location,
  url: "u",
  postedOn: "",
});

describe("matches", () => {
  it("accepts an entry-level data analyst in Delaware", () => {
    expect(matches(mk("Data Analyst", "USA - Delaware - Wilmington"))).toBe(true);
  });
  it("accepts a remote business analyst", () => {
    expect(matches(mk("Business Analyst", "Remote - US"))).toBe(true);
  });
  it("excludes senior / manager / lead by whole word", () => {
    expect(matches(mk("Senior Data Analyst", "Delaware"))).toBe(false);
    expect(matches(mk("Data Analyst Manager", "Delaware"))).toBe(false);
    expect(matches(mk("Lead Data Analyst", "Remote"))).toBe(false);
  });
  it("does not let 'lead' match inside 'leadership'", () => {
    expect(matches(mk("Data Analyst, Leadership Program", "Delaware"))).toBe(true);
  });
  it("rejects unrelated titles", () => {
    expect(matches(mk("Registered Nurse", "Delaware"))).toBe(false);
    expect(matches(mk("Mechanical Engineer", "Wilmington, DE"))).toBe(false);
  });
  it("matches software / data engineering roles (MS-CS targets)", () => {
    expect(matches(mk("Software Engineer", "Remote, US"))).toBe(true);
    expect(matches(mk("Data Engineer", "Wilmington, DE"))).toBe(true);
    expect(matches(mk("Machine Learning Engineer", "Remote, US"))).toBe(true);
  });
  it("all-US net: accepts US states/abbreviations, rejects foreign cities", () => {
    expect(matches(mk("Software Engineer", "Austin, TX"))).toBe(true);
    expect(matches(mk("Data Engineer", "VA - Reston"))).toBe(true);
    expect(matches(mk("Software Engineer", "Morocco - Casablanca"))).toBe(false);
    expect(matches(mk("Software Engineer", "Bucharest"))).toBe(false);
    expect(matches(mk("Data Engineer", "Hyderabad, Telangana"))).toBe(false);
  });
  it("rejects out-of-area locations", () => {
    expect(matches(mk("Data Analyst", "London, UK"))).toBe(false);
    expect(matches(mk("Data Analyst", "India - Chennai"))).toBe(false);
  });
  it("is case-insensitive on title and location", () => {
    expect(matches(mk("DATA ANALYST", "DELAWARE"))).toBe(true);
  });
  it("lets through unknown/multi-location roles (Workday's 'N Locations')", () => {
    expect(matches(mk("Data Analyst", "2 Locations"))).toBe(true);
    expect(matches(mk("Data Analyst", "10 locations"))).toBe(true);
    expect(matches(mk("Data Analyst", ""))).toBe(true);
  });
  it("still excludes a clearly out-of-area multi-word location", () => {
    expect(matches(mk("Data Analyst", "Poland - Warsaw"))).toBe(false);
  });
  it("keeps 'Senior Associate' (entry tier) but still drops plain 'Senior'", () => {
    expect(matches(mk("Senior Associate Data Analyst", "Delaware"))).toBe(true);
    expect(matches(mk("Senior Data Analyst", "Delaware"))).toBe(false);
  });
  it("does not throw on malformed postings (missing title/location)", () => {
    const bad = { id: "x", company: "C", url: "", postedOn: "" } as unknown as Posting;
    expect(() => matches(bad)).not.toThrow();
    expect(matches(bad)).toBe(false);
  });
  it("blocks foreign regions even when tagged remote", () => {
    expect(matches(mk("Data Analyst", "Remote, India"))).toBe(false);
    expect(matches(mk("Business Analyst", "Remote - United Kingdom"))).toBe(false);
    expect(matches(mk("Data Analyst", "Remote, US"))).toBe(true);
  });
  it("LOCAL_FILTERS widens DE matching (senior + broader roles), still blocks execs/foreign", () => {
    const role = mk("Senior Financial Analyst", "Wilmington, DE");
    expect(matches(role)).toBe(false); // strict: no bare-'analyst' include, 'senior' excluded
    expect(matches(role, LOCAL_FILTERS)).toBe(true); // local: 'analyst' include + senior allowed
    expect(matches(mk("VP, Data Analytics", "Wilmington, DE"), LOCAL_FILTERS)).toBe(false);
    expect(matches(mk("Data Analyst", "Remote, India"), LOCAL_FILTERS)).toBe(false);
  });
});
