import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeSimplifyList, parseZapplyTable } from "../src/adapters/githublist";
import { normalizedUrlKey } from "../src/urlkey";
import { classifySponsorship } from "../src/sponsorship";
import { postedDays } from "../src/recency";
import { type CompanySource } from "../src/types";

const fixture = (n: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), "utf8");

const simplify: CompanySource = {
  name: "SimplifyJobs list",
  ats: "githublist",
  listFormat: "simplify-json",
  listUrl: "https://raw.githubusercontent.com/x/y/dev/.github/scripts/listings.json",
};
const zapply: CompanySource = {
  name: "Zapply New-Grad-2027 list",
  ats: "githublist",
  listFormat: "zapply-md",
  listUrl: "https://raw.githubusercontent.com/x/y/main/README.md",
};

// Rows copied from the real dev-branch listings.json.
const rows = JSON.parse(fixture("simplify-listings.json"));

describe("normalizeSimplifyList", () => {
  const out = normalizeSimplifyList(simplify, rows);
  const byCompany = (c: string) => out.find((p) => p.company === c);

  it("maps a row to the EMPLOYER, not the list", () => {
    expect(byCompany("Stantec")).toMatchObject({
      id: "c827a700-5a23-411c-932d-4168d653e02e",
      company: "Stantec",
      title: "Geospatial Analyst",
      url: "https://hdhl.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1007357",
      via: "SimplifyJobs list",
    });
  });

  it("joins multiple locations", () => {
    expect(byCompany("Stantec")!.location).toBe("Madison, WI · Milwaukee, WI · Cincinnati, OH");
  });

  it("converts date_posted (epoch seconds) to an ISO date the recency filter parses", () => {
    const p = byCompany("Stantec")!;
    expect(p.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(postedDays(p.postedOn)).not.toBeNull();
  });

  it("skips closed (active:false) and hidden (is_visible:false) rows", () => {
    expect(byCompany("Sainsbury's")).toBeUndefined();
    expect(byCompany("Hidden Corp")).toBeUndefined();
  });

  it("never claims cap-exempt — no list publishes that", () => {
    expect(out.every((p) => !p.capExempt)).toBe(true);
  });

  it("passes a NEGATIVE sponsorship verdict through as a JD line the classifier flags", () => {
    for (const c of ["Citizens Only Inc", "No Sponsor LLC"]) {
      const d = byCompany(c)!.description ?? "";
      expect(classifySponsorship(d).status).toBe("no");
    }
  });

  it("does not restate a POSITIVE or unknown sponsorship claim", () => {
    expect(byCompany("Stantec")!.description).toBeUndefined();
    expect(byCompany("No Id Co")!.description).toBeUndefined(); // "Offers Sponsorship"
  });

  it("hashes a stable id when the row has none, and tolerates a non-array locations field", () => {
    const p = byCompany("No Id Co")!;
    expect(p.id).toMatch(/^[0-9a-f]{8}$/);
    expect(p.location).toBe("");
    expect(normalizeSimplifyList(simplify, rows).find((q) => q.company === "No Id Co")!.id).toBe(p.id);
  });

  it("skips malformed rows (null entry, missing company) without throwing", () => {
    expect(out.map((p) => p.company)).not.toContain("");
    // Stantec, Broadcom, Citizens Only Inc, No Sponsor LLC, No Id Co — the null
    // entry, the blank-company row, the closed row and the hidden row are gone.
    expect(out).toHaveLength(5);
  });

  it("returns [] for a non-array body", () => {
    expect(normalizeSimplifyList(simplify, { jobs: [] })).toEqual([]);
    expect(normalizeSimplifyList(simplify, null)).toEqual([]);
  });
});

describe("parseZapplyTable", () => {
  // now = 2026-09-11T00:00:00Z so the relative "Posted" column is deterministic.
  const now = Date.UTC(2026, 8, 11);
  const out = parseZapplyTable(zapply, fixture("zapply-readme.md"), now);
  const byTitle = (t: string) => out.find((p) => p.title === t);

  it("parses a real row into a Posting", () => {
    expect(byTitle("Cloud Platform Engineer - API")).toMatchObject({
      company: "State Street",
      location: "Burlington Massachusetts",
      url: "https://zapply.jobs/l/d/workday-statestreet-global-R-794566?s=gh-new-grad-jobs-2027",
      via: "Zapply New-Grad-2027 list",
      postedOn: "2026-09-11", // "16m" ago
    });
  });

  it("strips markdown from the company cell and expands the ↳ continuation marker", () => {
    expect(byTitle("Data Analyst")!.company).toBe("Broadcom");
    expect(byTitle("Business Intelligence Analyst")!.company).toBe("Broadcom");
  });

  it("converts relative ages to dates (d / w / h)", () => {
    expect(byTitle("UX Designer")!.postedOn).toBe("2026-09-10"); // 1d
    expect(byTitle("Data Analyst")!.postedOn).toBe("2026-08-28"); // 2w
    expect(byTitle("Forward Deployed AI Engineer")!.postedOn).toBe("2026-09-11"); // 3h
  });

  it("leaves postedOn empty when the age column is unparseable (unknown age passes the filter)", () => {
    const p = out.find((q) => q.company === "Unparsed Date Co")!;
    expect(p.postedOn).toBe("");
    expect(postedDays(p.postedOn)).toBeNull();
  });

  it("skips closed rows (struck-through title, padlock)", () => {
    expect(out.map((p) => p.company)).not.toContain("Closed Co");
    expect(out.map((p) => p.company)).not.toContain("Locked Co");
  });

  it("skips malformed rows: no apply link, wrapped cell, wrong cell count", () => {
    const companies = out.map((p) => p.company);
    expect(companies).not.toContain("No Link Co");
    expect(companies).not.toContain("Two Sigma");
    expect(companies).not.toContain("Wrong Cells");
  });

  it("skips header and separator rows", () => {
    expect(out.map((p) => p.title)).not.toContain("Role");
  });

  it("gives each row a stable 8-hex id", () => {
    expect(out.every((p) => /^[0-9a-f]{8}$/.test(p.id))).toBe(true);
    expect(parseZapplyTable(zapply, fixture("zapply-readme.md"), now + 1)[0].id).toBe(out[0].id);
  });

  it("handles empty / non-table input", () => {
    expect(parseZapplyTable(zapply, "")).toEqual([]);
    expect(parseZapplyTable(zapply, "# Just a heading\n\nno tables here")).toEqual([]);
  });
});

describe("normalizedUrlKey (cross-source dedup)", () => {
  it("collapses the same Workday req arriving from a list and from the direct adapter", () => {
    const fromList = normalizeSimplifyList(simplify, rows).find((p) => p.company === "Broadcom")!;
    // What normalizeWorkday builds: `https://{tenant}.{wd}.myworkdayjobs.com/{site}` + externalPath.
    const direct =
      "https://broadcom.wd1.myworkdayjobs.com/external_career/job/USA-CA-Irvine/Data-Analyst_R024631";
    expect(normalizedUrlKey(fromList.url)).toBe(normalizedUrlKey(direct));
    expect(normalizedUrlKey(direct)).toBe(
      "broadcom.wd1.myworkdayjobs.com/external_career/job/usa-ca-irvine/data-analyst_r024631",
    );
  });

  it("strips the Workday locale segment the lists sometimes carry", () => {
    expect(
      normalizedUrlKey("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/X_JR1"),
    ).toBe(normalizedUrlKey("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/X_JR1"));
  });

  it("ignores tracking query params, trailing slashes, www and case", () => {
    expect(normalizedUrlKey("https://WWW.Example.com/jobs/42/?utm_source=gh&x=1")).toBe(
      "example.com/jobs/42",
    );
    expect(normalizedUrlKey("https://example.com/jobs/42")).toBe("example.com/jobs/42");
  });

  it("returns '' for missing or non-http URLs so they are never deduped together", () => {
    expect(normalizedUrlKey("")).toBe("");
    expect(normalizedUrlKey("not a url")).toBe("");
    expect(normalizedUrlKey("mailto:a@b.c")).toBe("");
  });
});
