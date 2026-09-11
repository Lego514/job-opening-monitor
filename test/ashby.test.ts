import { describe, it, expect } from "vitest";
import { normalizeAshby } from "../src/adapters/ashby";
import { type CompanySource } from "../src/types";

const ramp: CompanySource = { name: "Ramp", ats: "ashby", ashbyToken: "ramp" };

// Shape copied from the live api.ashbyhq.com board response.
const raw = {
  jobs: [
    {
      id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
      title: "Security Engineer, Cloud",
      location: "New York, NY (HQ)",
      secondaryLocations: [{ location: "Remote (US)" }, { location: "Miami, FL" }],
      publishedAt: "2026-04-07T17:12:35.753+00:00",
      jobUrl: "https://jobs.ashbyhq.com/ramp/34413f8d",
      descriptionPlain: "ABOUT RAMP\n\nWe are hiring a cloud security engineer.",
      isListed: true,
      compensation: { scrapeableCompensationSalarySummary: "$211.4K - $290.6K" },
    },
    {
      id: "unlisted-1",
      title: "Draft role",
      location: "New York, NY",
      publishedAt: "2026-04-07T17:12:35.753+00:00",
      isListed: false,
    },
  ],
};

describe("normalizeAshby", () => {
  it("maps a job, joining primary and secondary locations", () => {
    const out = normalizeAshby(ramp, raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
      company: "Ramp",
      title: "Security Engineer, Cloud",
      location: "New York, NY (HQ) · Remote (US) · Miami, FL",
      url: "https://jobs.ashbyhq.com/ramp/34413f8d",
    });
  });

  it("drops unlisted roles", () => {
    expect(normalizeAshby(ramp, raw).map((p) => p.id)).not.toContain("unlisted-1");
  });

  // postedDays() parses ISO dates, so the recency filter applies to these.
  it("reduces publishedAt to an ISO date", () => {
    expect(normalizeAshby(ramp, raw)[0].postedOn).toBe("2026-04-07");
  });

  // Ashby keeps pay out of the JD, so it's appended for findSalary to read.
  it("appends the pay range to the description", () => {
    const d = normalizeAshby(ramp, raw)[0].description ?? "";
    expect(d).toContain("We are hiring a cloud security engineer.");
    expect(d).toContain("Compensation: $211.4K - $290.6K");
  });

  it("falls back to a constructed url when jobUrl is absent", () => {
    const out = normalizeAshby(ramp, { jobs: [{ id: "abc", title: "T" }] });
    expect(out[0].url).toBe("https://jobs.ashbyhq.com/ramp/abc");
  });

  it("handles an empty board", () => {
    expect(normalizeAshby(ramp, {})).toEqual([]);
  });
});
