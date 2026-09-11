import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeJobSpy, salaryText, type JobSpyRow } from "../src/adapters/jobspy";
import { normalizedUrlKey } from "../src/urlkey";
import { postedDays } from "../src/recency";
import { matches } from "../src/match";
import { LOCAL_FILTERS } from "../src/config";
import { type CompanySource } from "../src/types";

// Rows copied from a real `scripts/jobspy_scrape.py` run (descriptions truncated),
// plus two hand-written edge rows: an empty company, and a ZipRecruiter row with
// no date and no JD.
const rows: JobSpyRow[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/jobspy-rows.json", import.meta.url)), "utf8"),
);

const source: CompanySource = { name: "JobSpy", ats: "jobspy" };

describe("normalizeJobSpy", () => {
  const out = normalizeJobSpy(source, rows);
  const byCompany = (c: string) => out.find((p) => p.company === c);

  it("maps a row to the EMPLOYER, not the aggregator", () => {
    expect(byCompany("PineBridge Investments")).toMatchObject({
      company: "PineBridge Investments",
      title: "Data Systems Analyst",
      location: "New York, NY, US",
      via: "Indeed",
    });
  });

  it("prefers the employer's own ATS URL over the Indeed redirect", () => {
    expect(byCompany("PineBridge Investments")!.url).toBe(
      "https://pinebridge.wd5.myworkdayjobs.com/en-US/PineBridge_Career_Site/job/New-York/Data-Systems-Analyst_R-02095",
    );
  });

  it("falls back to the board URL when there is no direct link", () => {
    expect(byCompany("Tandym Group")!.url).toBe(
      "https://www.indeed.com/viewjob?jk=fixturenodirect1",
    );
  });

  it("namespaces the id by board, so the same req from two boards is two keys", () => {
    expect(byCompany("PineBridge Investments")!.id).toMatch(/^indeed:/);
    expect(byCompany("Nemours")!.id).toMatch(/^zip_recruiter:/);
  });

  it("labels the board in `via` so the alert says where the row came from", () => {
    expect(byCompany("Nemours")!.via).toBe("ZipRecruiter");
  });

  it("drops rows with no employer name — useless for sponsor lookup and dedup", () => {
    expect(out.every((p) => p.company.trim() !== "")).toBe(true);
    expect(out.length).toBe(rows.length - 1);
  });

  it("attaches the JD so enrichment needs no detail fetch", () => {
    const p = byCompany("PineBridge Investments")!;
    expect(p.description!.length).toBeGreaterThan(50);
    expect(p.detailApi).toBeUndefined();
  });

  it("leaves `description` unset when the row carries no JD", () => {
    expect(byCompany("Nemours")!.description).toBeUndefined();
  });

  it("emits a postedOn the recency filter can read", () => {
    const p = byCompany("PineBridge Investments")!;
    expect(p.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(postedDays(p.postedOn)).not.toBeNull();
  });

  it("treats a missing date as unknown age (passes the recency gate) not as epoch 0", () => {
    const p = byCompany("Nemours")!;
    expect(p.postedOn).toBe("");
    expect(postedDays(p.postedOn)).toBeNull();
  });

  it("never claims cap-exempt — the board doesn't publish it", () => {
    expect(out.every((p) => !p.capExempt)).toBe(true);
  });

  it("keeps Delaware-local long-tail employers the ATS adapters can't see", () => {
    const de = out.filter((p) => /, DE/.test(p.location));
    expect(de.map((p) => p.company)).toContain("State of Delaware");
    // …and they pass the wider Delaware filter the pipeline applies to them.
    expect(matches(byCompany("State of Delaware")!, LOCAL_FILTERS)).toBe(true);
  });

  it("is defensive about malformed input", () => {
    expect(normalizeJobSpy(source, null)).toEqual([]);
    expect(normalizeJobSpy(source, {})).toEqual([]);
    expect(normalizeJobSpy(source, [null, 3, "x", {}, { company: "A" }])).toEqual([]);
    expect(normalizeJobSpy(source, [{ company: "A", title: "T" }])).toEqual([]); // no URL
  });
});

describe("salaryText", () => {
  it("renders the board's structured pay range", () => {
    expect(salaryText({ salary_min: 100000, salary_max: 110000, salary_interval: "yearly" })).toBe(
      "$100,000–$110,000 / yearly",
    );
  });
  it("handles a one-sided range", () => {
    expect(salaryText({ salary_max: 85000, salary_interval: "yearly" })).toBe("$85,000 / yearly");
  });
  it("is null when the board published no pay", () => {
    expect(salaryText({ salary_min: null, salary_max: null })).toBeNull();
  });
});

describe("dedup against the direct ATS sources", () => {
  const out = normalizeJobSpy(source, rows);

  it("collapses an Indeed row onto the employer's own Workday posting", () => {
    // What our Workday adapter would return for the same req (no locale segment).
    const direct =
      "https://pinebridge.wd5.myworkdayjobs.com/PineBridge_Career_Site/job/New-York/Data-Systems-Analyst_R-02095";
    expect(normalizedUrlKey(byUrlCompany(out, "PineBridge Investments"))).toBe(
      normalizedUrlKey(direct),
    );
  });

  it("keeps two Indeed postings apart — their only difference is the ?jk= param", () => {
    const a = normalizedUrlKey("https://www.indeed.com/viewjob?jk=aaa111");
    const b = normalizedUrlKey("https://www.indeed.com/viewjob?jk=bbb222");
    expect(a).not.toBe(b);
    // …while tracking params on the same posting still collapse.
    expect(normalizedUrlKey("https://indeed.com/viewjob?jk=aaa111&from=serp&vjk=x")).toBe(a);
  });
});

function byUrlCompany(out: ReturnType<typeof normalizeJobSpy>, company: string): string {
  return out.find((p) => p.company === company)!.url;
}
