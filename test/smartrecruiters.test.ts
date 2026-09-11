import { describe, it, expect } from "vitest";
import { normalizeSmartRecruiters } from "../src/adapters/smartrecruiters";
import { type CompanySource } from "../src/types";

const experian: CompanySource = {
  name: "Experian",
  ats: "smartrecruiters",
  srCompany: "Experian",
};

// Shape copied from the live api.smartrecruiters.com list response.
const raw = {
  totalFound: 37,
  content: [
    {
      id: "744000148867839",
      name: "Distinguished Platform Solutions Architect - Remote",
      releasedDate: "2026-09-10T23:17:31.675Z",
      location: {
        city: "Costa Mesa",
        region: "CA",
        country: "us",
        fullLocation: "Costa Mesa, CA, United States",
      },
    },
  ],
};

describe("normalizeSmartRecruiters", () => {
  it("maps a posting to the public job url", () => {
    const out = normalizeSmartRecruiters(experian, raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "744000148867839",
      company: "Experian",
      title: "Distinguished Platform Solutions Architect - Remote",
      location: "Costa Mesa, CA, United States",
      url: "https://jobs.smartrecruiters.com/Experian/744000148867839",
    });
    expect(out[0].srDetail).toBe(
      "https://api.smartrecruiters.com/v1/companies/Experian/postings/744000148867839",
    );
  });

  // postedDays() parses ISO dates, so the recency filter applies to these.
  it("reduces releasedDate to an ISO date", () => {
    expect(normalizeSmartRecruiters(experian, raw)[0].postedOn).toBe("2026-09-10");
  });

  it("rebuilds the location when fullLocation is missing", () => {
    const out = normalizeSmartRecruiters(experian, {
      content: [{ id: "1", name: "T", location: { city: "Allen", region: "TX", country: "us" } }],
    });
    expect(out[0].location).toBe("Allen, TX, us");
  });

  it("handles an empty page", () => {
    expect(normalizeSmartRecruiters(experian, { totalFound: 0, content: [] })).toEqual([]);
  });
});
