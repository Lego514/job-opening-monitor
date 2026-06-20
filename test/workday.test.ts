import { describe, it, expect } from "vitest";
import { normalizeWorkday, type WorkdayResponse } from "../src/adapters/workday";
import { type CompanySource } from "../src/types";

const az: CompanySource = {
  name: "AstraZeneca",
  ats: "workday",
  tenant: "astrazeneca",
  wd: "wd3",
  site: "Careers",
};

const fixture: WorkdayResponse = {
  total: 2,
  jobPostings: [
    {
      title: "Data Analyst",
      externalPath: "/job/USA-Delaware/Data-Analyst_R-1",
      locationsText: "USA - Delaware",
      postedOn: "Posted Today",
      bulletFields: ["R-1"],
    },
    {
      title: "BI Analyst",
      externalPath: "/job/Remote/BI-Analyst_R-2",
      locationsText: "Remote",
      postedOn: "Posted Yesterday",
      bulletFields: [],
    },
  ],
};

describe("normalizeWorkday", () => {
  it("maps postings and builds absolute URLs", () => {
    const out = normalizeWorkday(az, fixture);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "R-1",
      company: "AstraZeneca",
      title: "Data Analyst",
      location: "USA - Delaware",
      url: "https://astrazeneca.wd3.myworkdayjobs.com/Careers/job/USA-Delaware/Data-Analyst_R-1",
      postedOn: "Posted Today",
    });
  });
  it("falls back to externalPath as id when bulletFields is empty", () => {
    const out = normalizeWorkday(az, fixture);
    expect(out[1].id).toBe("/job/Remote/BI-Analyst_R-2");
  });
  it("handles an empty response", () => {
    expect(normalizeWorkday(az, {})).toEqual([]);
  });
});
