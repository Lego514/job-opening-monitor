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
  // Seniority words no longer exclude: the LLM stage reads the JD and decides.
  // The pre-filter's job is only to get plausible roles in front of it.
  it("lets seniority-worded titles through for the LLM to judge", () => {
    expect(matches(mk("Senior Data Analyst", "Delaware"))).toBe(true);
    expect(matches(mk("Data Analyst Manager", "Delaware"))).toBe(true);
    expect(matches(mk("Lead Data Analyst", "Remote"))).toBe(true);
  });
  it("still excludes unmistakably executive titles by whole word", () => {
    expect(matches(mk("Director of Data Analytics", "Delaware"))).toBe(false);
    expect(matches(mk("Chief Data Scientist", "Remote"))).toBe(false);
    expect(matches(mk("Principal Software Engineer", "Austin, TX"))).toBe(false);
  });
  it("does not let 'head' match inside 'headcount'", () => {
    expect(matches(mk("Analyst, Headcount Planning", "Delaware"))).toBe(true);
  });
  it("rejects unrelated titles — wrong discipline, not wrong level", () => {
    expect(matches(mk("Registered Nurse", "Delaware"))).toBe(false);
    // "engineer" is a bare include now, so the discipline excludes carry the load.
    expect(matches(mk("Mechanical Engineer", "Wilmington, DE"))).toBe(false);
    expect(matches(mk("Process Chemical Engineer", "Newark, DE"))).toBe(false);
    expect(matches(mk("HVAC Technician", "Wilmington, DE"))).toBe(false);
  });
  it("catches the new-grad titles the old keyword list missed", () => {
    expect(matches(mk("Technology Development Program", "Wilmington, DE"))).toBe(true);
    expect(matches(mk("Early Career Rotational Program", "Remote, US"))).toBe(true);
    expect(matches(mk("Graduate Engineer", "Austin, TX"))).toBe(true);
    expect(matches(mk("Quantitative Researcher", "New York, NY"))).toBe(true);
    expect(matches(mk("Applied Scientist", "Seattle, WA"))).toBe(true);
    expect(matches(mk("Solutions Engineer", "Remote, US"))).toBe(true);
    expect(matches(mk("Analytics Associate", "Wilmington, DE"))).toBe(true);
    expect(matches(mk("2027 Analyst Program", "New York, NY"))).toBe(true);
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
  it("keeps 'Senior Associate' — an early-career tier at Capital One et al.", () => {
    expect(matches(mk("Senior Associate Data Analyst", "Delaware"))).toBe(true);
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
  it("LOCAL_FILTERS widens DE matching (broader role vocabulary), still blocks execs/foreign", () => {
    const role = mk("Reporting Insights Specialist", "Wilmington, DE");
    expect(matches(role)).toBe(false); // strict: no include hits "reporting"/"insights"
    expect(matches(role, LOCAL_FILTERS)).toBe(true); // local net covers the DE-only vocabulary
    expect(matches(mk("VP, Data Analytics", "Wilmington, DE"), LOCAL_FILTERS)).toBe(false);
    expect(matches(mk("Data Analyst", "Remote, India"), LOCAL_FILTERS)).toBe(false);
  });
});
