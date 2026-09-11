import { describe, it, expect } from "vitest";
import {
  normalizeWorkday,
  workdayHost,
  workdayPublicPrefix,
  workdayDetailUrl,
  type WorkdayResponse,
} from "../src/adapters/workday";
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

// Some tenants (universities especially — UPenn) are hosted on the shared
// wd1.myworkdaysite.com rather than a dedicated {tenant}.{wd}.myworkdayjobs.com.
// The CXS API path is the same on both; only the PUBLIC url shape differs.
const penn: CompanySource = {
  name: "University of Pennsylvania",
  ats: "workday",
  wdHost: "wd1.myworkdaysite.com",
  tenant: "upenn",
  site: "careers-at-penn",
};

describe("workday host shapes", () => {
  it("defaults the host to the dedicated myworkdayjobs tenant host", () => {
    expect(workdayHost(az)).toBe("astrazeneca.wd3.myworkdayjobs.com");
    expect(workdayPublicPrefix(az)).toBe("https://astrazeneca.wd3.myworkdayjobs.com/Careers");
  });

  it("uses wdHost and the /recruiting/{tenant}/{site} public path when set", () => {
    expect(workdayHost(penn)).toBe("wd1.myworkdaysite.com");
    expect(workdayPublicPrefix(penn)).toBe(
      "https://wd1.myworkdaysite.com/recruiting/upenn/careers-at-penn",
    );
  });

  it("builds myworkdaysite job URLs from the shared host", () => {
    const out = normalizeWorkday(penn, {
      total: 1,
      jobPostings: [
        {
          title: "Data Analyst",
          externalPath: "/job/Med-Sch/Data-Analyst_JR1",
          locationsText: "Med Sch Richards Building",
          postedOn: "Posted Yesterday",
          bulletFields: ["JR1"],
        },
      ],
    });
    expect(out[0].url).toBe(
      "https://wd1.myworkdaysite.com/recruiting/upenn/careers-at-penn/job/Med-Sch/Data-Analyst_JR1",
    );
  });
});

describe("workdayDetailUrl", () => {
  it("derives the CXS detail endpoint from a dedicated-host job URL", () => {
    expect(
      workdayDetailUrl(
        "https://astrazeneca.wd3.myworkdayjobs.com/Careers/job/USA-Delaware/Data-Analyst_R-1",
      ),
    ).toBe(
      "https://astrazeneca.wd3.myworkdayjobs.com/wday/cxs/astrazeneca/Careers/job/USA-Delaware/Data-Analyst_R-1",
    );
  });

  it("derives it from a myworkdaysite job URL (tenant comes from the path)", () => {
    expect(
      workdayDetailUrl(
        "https://wd1.myworkdaysite.com/recruiting/upenn/careers-at-penn/job/Med-Sch/Data-Analyst_JR1",
      ),
    ).toBe(
      "https://wd1.myworkdaysite.com/wday/cxs/upenn/careers-at-penn/job/Med-Sch/Data-Analyst_JR1",
    );
  });

  it("ignores a locale segment", () => {
    expect(
      workdayDetailUrl(
        "https://wd1.myworkdaysite.com/en-US/recruiting/upenn/careers-at-penn/job/X/Y_JR2",
      ),
    ).toBe("https://wd1.myworkdaysite.com/wday/cxs/upenn/careers-at-penn/job/X/Y_JR2");
  });
});
