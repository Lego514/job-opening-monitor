import { describe, it, expect } from "vitest";
import { normalizeOracle } from "../src/adapters/oracle";
import { type CompanySource } from "../src/types";

const jpmc: CompanySource = {
  name: "JPMorgan Chase",
  ats: "oracle",
  oracleHost: "jpmc.fa.oraclecloud.com",
  oracleSite: "CX_1001",
};

describe("normalizeOracle", () => {
  it("maps requisitions to postings with CE job url + detail endpoint", () => {
    const out = normalizeOracle(jpmc, {
      items: [
        {
          TotalJobsCount: 2,
          requisitionList: [
            {
              Id: "210721822",
              Title: "Software Engineer I",
              PrimaryLocation: "Wilmington, Delaware, United States",
              ExternalPostedStartDate: "2026-07-14T00:00:00+00:00",
              secondaryLocations: [{ Name: "Newark, Delaware, United States" }],
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "210721822",
      company: "JPMorgan Chase",
      title: "Software Engineer I",
      location: "Wilmington, Delaware, United States · Newark, Delaware, United States",
      url: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210721822",
      postedOn: "2026-07-14",
    });
    expect(out[0].oracleDetail).toContain("recruitingCEJobRequisitionDetails");
    expect(out[0].oracleDetail).toContain("Id=%22210721822%22");
    expect(out[0].oracleDetail).toContain("siteNumber=CX_1001");
  });

  it("handles an empty / missing requisition list", () => {
    expect(normalizeOracle(jpmc, {})).toEqual([]);
    expect(normalizeOracle(jpmc, { items: [{ requisitionList: [] }] })).toEqual([]);
  });
});
