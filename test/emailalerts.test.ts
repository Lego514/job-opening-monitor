import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeEmailAlerts,
  matchJobUrl,
  unwrapTracking,
  decodeEntities,
  looksLikeLocation,
  deriveMeta,
  mergeAlerts,
  inboxConfig,
  isoDay,
  JOB_URL_SHAPES,
} from "../src/adapters/emailalerts";
import { normalizedUrlKey } from "../src/urlkey";
import { postedDays } from "../src/recency";
import { buildUserPrompt } from "../src/llm";
import { matches } from "../src/match";
import { FILTERS, LOCAL_FILTERS } from "../src/config";
import { postingKey, type Posting } from "../src/types";

/**
 * ⚠️ EVERY FIXTURE IN THIS FILE IS **SYNTHESIZED**, not a captured send.
 *
 * Ray had not set the saved-search alerts up when this adapter was written, so
 * there were no real alert emails to test against. Each fixture was written to
 * mirror the provider's *documented/observable* structure — table-based HTML,
 * tracking-wrapped hrefs, an unsubscribe footer, a logo anchor with no text, a
 * multi-location row — and the URL shapes come from each board's public URL
 * format. They pin the PARSER's behaviour (given this HTML, produce these
 * postings), NOT the claim that a real Handshake email looks like this.
 *
 * When real alerts start arriving, `npm run alerts -- --dump` writes any message
 * that yielded zero links to disk; replace these fixtures with the real thing.
 */
const fixture = (n: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), "utf8");

const meta = { from: "alerts@example.com", subject: "New jobs", date: "2026-09-14T11:05:00Z" };
const byTitle = (out: Posting[], t: string) => out.find((p) => p.title === t);

describe("normalizeEmailAlerts — Handshake", () => {
  const out = normalizeEmailAlerts(fixture("alert-handshake.html"), meta);

  it("keeps only the job links (no unsubscribe, settings or 'see all jobs')", () => {
    expect(out).toHaveLength(3);
    expect(out.every((p) => /joinhandshake\.com\/(stu\/)?jobs\//.test(p.url))).toBe(true);
  });

  it("unwraps a SendGrid tracker that carries the real URL in its path", () => {
    expect(byTitle(out, "Data Analyst, Early Career")!.url).toBe(
      "https://app.joinhandshake.com/jobs/9182736",
    );
  });

  it("uses the site's job id, namespaced by source, so a re-alert dedupes", () => {
    expect(byTitle(out, "Data Analyst, Early Career")!.id).toBe("handshake:9182736");
    expect(byTitle(out, "Business Intelligence Analyst")!.id).toBe("handshake:5544332");
  });

  it("reads 'Company · City, ST' from the text after the link", () => {
    expect(byTitle(out, "Data Analyst, Early Career")).toMatchObject({
      company: "Acme Analytics",
      location: "Wilmington, DE",
      via: "Handshake alert",
    });
  });

  it("keeps every city of a multi-location row", () => {
    expect(byTitle(out, "Business Intelligence Analyst")).toMatchObject({
      company: "Vireo Health Systems",
      location: "Newark, DE · Philadelphia, PA · Remote",
    });
  });

  it("names the company after the ALERT when the email doesn't say — never a guess", () => {
    // …and specifically never inherits the previous card's employer/location.
    expect(byTitle(out, "Junior Data Scientist")).toMatchObject({
      company: "Handshake",
      location: "",
    });
  });

  it("drops a logo anchor that has an image and no text", () => {
    // The logo links to the same job as the title above it; one posting, not two.
    expect(out.filter((p) => p.id === "handshake:9182736")).toHaveLength(1);
  });

  it("stamps the email's date so the recency filter can read it", () => {
    expect(out.every((p) => p.postedOn === "2026-09-14")).toBe(true);
    expect(postedDays("2026-09-14", Date.UTC(2026, 8, 16))).toBe(2);
  });

  it("attaches no description — there is no JD in an alert email", () => {
    expect(out.every((p) => p.description === undefined)).toBe(true);
  });
});

describe("normalizeEmailAlerts — LinkedIn", () => {
  const out = normalizeEmailAlerts(fixture("alert-linkedin.html"), meta);

  it("keeps the three job views and drops search/unsubscribe/psettings links", () => {
    expect(out.map((p) => p.title)).toEqual([
      "Data Analyst",
      "Data Engineer, New Grad",
      "Associate Business Analyst",
    ]);
  });

  it("canonicalizes the email-only /comm/ prefix away", () => {
    expect(byTitle(out, "Data Analyst")!.url).toBe("https://www.linkedin.com/jobs/view/4123456789");
    expect(byTitle(out, "Data Analyst")!.id).toBe("linkedin:4123456789");
  });

  it("unwraps a ?url= redirector and pulls the id out of the slug's tail", () => {
    expect(byTitle(out, "Data Engineer, New Grad")).toMatchObject({
      id: "linkedin:4998877665",
      url: "https://www.linkedin.com/jobs/view/data-engineer-new-grad-at-northstar-labs-4998877665",
      company: "Northstar Labs",
      location: "Philadelphia, PA",
    });
  });

  it("strips the per-send tracking params, so two sends of one job dedupe", () => {
    const a = normalizeEmailAlerts(
      '<a href="https://www.linkedin.com/comm/jobs/view/4123456789?trackingId=AAA&midToken=A">Data Analyst</a>',
      meta,
    )[0];
    const b = normalizeEmailAlerts(
      '<a href="https://www.linkedin.com/comm/jobs/view/4123456789?trackingId=ZZZ&refId=9">Data Analyst</a>',
      meta,
    )[0];
    expect(a.url).toBe(b.url);
    expect(postingKey(a)).toBe(postingKey(b));
  });

  it("ignores the Promoted / Easy Apply / '4 days ago' chrome", () => {
    expect(byTitle(out, "Data Analyst")).toMatchObject({
      company: "Sigma Health",
      location: "New York, NY (Hybrid)",
      via: "LinkedIn alert",
    });
  });

  it("falls back to the source when a card carries no company text", () => {
    expect(byTitle(out, "Associate Business Analyst")!.company).toBe("LinkedIn");
  });
});

describe("normalizeEmailAlerts — Indeed", () => {
  const out = normalizeEmailAlerts(fixture("alert-indeed.html"), meta);

  it("parses organic and sponsored rows, and drops the 'Apply now' button", () => {
    expect(out.map((p) => p.title)).toEqual([
      "Data Analyst I",
      "Business Analyst (Entry Level)",
      "Reporting Analyst",
    ]);
  });

  it("keys an organic row on ?jk= and rewrites /rc/clk to the canonical /viewjob", () => {
    expect(byTitle(out, "Data Analyst I")).toMatchObject({
      id: "indeed:a1b2c3d4e5f6",
      url: "https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6",
      company: "Brandywine Financial",
      location: "Wilmington, DE",
    });
  });

  it("collapses the title link and the Apply button, which are the same job", () => {
    expect(out.filter((p) => p.id === "indeed:a1b2c3d4e5f6")).toHaveLength(1);
  });

  it("keeps two id-less sponsored links APART (both are /pagead/clk)", () => {
    const a = byTitle(out, "Business Analyst (Entry Level)")!;
    const b = byTitle(out, "Reporting Analyst")!;
    expect(a.id).not.toBe(b.id);
    expect(a.url).not.toBe(b.url);
    // …while the per-send tracking param that varies between sends is dropped.
    expect(a.url).not.toContain("vjs");
  });

  it("splits 'Company - City, ST' on the dash", () => {
    expect(byTitle(out, "Reporting Analyst")).toMatchObject({
      company: "Delmarva Mutual",
      location: "Dover, DE",
    });
  });

  it("does not treat the /jobs?q= search link as a posting", () => {
    expect(out.every((p) => !p.url.includes("/jobs?"))).toBe(true);
  });
});

describe("normalizeEmailAlerts — ZipRecruiter", () => {
  const out = normalizeEmailAlerts(fixture("alert-ziprecruiter.html"), meta);

  it("unwraps the click tracker before matching (the tracker host is zip too)", () => {
    expect(byTitle(out, "Data Analyst")).toMatchObject({
      id: "ziprecruiter:8fa9b0c1",
      url: "https://www.ziprecruiter.com/c/Delmarva-Data/Job/Data-Analyst/-in-Dover,DE?jid=8fa9b0c1",
      company: "Delmarva Data",
      location: "Dover, DE",
    });
  });

  it("hashes a stable id for a slug URL that carries no id at all", () => {
    const p = byTitle(out, "Junior Business Analyst")!;
    expect(p.id).toMatch(/^ziprecruiter:[0-9a-f]{8}$/);
    expect(p.company).toBe("Keystone Staffing");
    expect(p.location).toBe("Remote (United States)");
    // Stable across sends: the same link re-alerted tomorrow yields the same key.
    expect(normalizeEmailAlerts(fixture("alert-ziprecruiter.html"), meta)[1].id).toBe(p.id);
  });

  it("reads company and city from separate lines and ignores the pay line", () => {
    expect(out.every((p) => !p.company.includes("$"))).toBe(true);
    expect(out).toHaveLength(2);
  });
});

describe("normalizeEmailAlerts — Glassdoor", () => {
  const out = normalizeEmailAlerts(fixture("alert-glassdoor.html"), meta);

  it("takes the employer from ABOVE the title when that's where the card puts it", () => {
    expect(byTitle(out, "Data Analyst, Risk")).toMatchObject({
      id: "glassdoor:1009876543",
      url: "https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1009876543",
      company: "Cormorant Bank",
      location: "New York, NY",
    });
  });

  it("keeps a /job-listing/ page whose identity is only in the path", () => {
    expect(byTitle(out, "Data Engineer, Associate")).toMatchObject({
      url: "https://www.glassdoor.com/job-listing/data-engineer-associate-tidewater-JV_IC1132348_KO0,23.htm",
      company: "Tidewater Analytics",
      location: "Newark, DE",
    });
  });

  it("does not mistake the /Job/…SRCH… search page for a posting", () => {
    expect(out).toHaveLength(2);
    expect(out.every((p) => !p.url.includes("SRCH"))).toBe(true);
  });
});

describe("malformed and empty bodies", () => {
  it("returns [] rather than throwing", () => {
    expect(normalizeEmailAlerts("", meta)).toEqual([]);
    expect(normalizeEmailAlerts(undefined as unknown as string, meta)).toEqual([]);
    expect(normalizeEmailAlerts("<html><body><p>Your alert</p></body></html>", meta)).toEqual([]);
    // Unclosed anchor, anchor with no href, href that isn't a URL.
    expect(
      normalizeEmailAlerts(
        '<a href="https://app.joinhandshake.com/jobs/1">Data Analyst' +
          "<a>Data Analyst</a>" +
          '<a href="not a url">Data Analyst</a>' +
          '<a href="mailto:jobs@acme.com">Data Analyst</a>',
        meta,
      ),
    ).toEqual([]);
  });

  it("treats a missing/unparseable Date header as unknown age (which passes)", () => {
    const out = normalizeEmailAlerts(fixture("alert-handshake.html"), { date: "not a date" });
    expect(out[0].postedOn).toBe("");
    expect(postedDays(out[0].postedOn)).toBeNull();
  });
});

describe("matchJobUrl — the URL-shape table", () => {
  const cases: [string, string | null][] = [
    // Handshake
    ["https://app.joinhandshake.com/jobs/7654321", "handshake:7654321"],
    ["https://app.joinhandshake.com/stu/jobs/7654321?ref=email", "handshake:7654321"],
    ["https://sfsu.joinhandshake.com/emp/jobs/7654321", "handshake:7654321"],
    ["https://app.joinhandshake.com/stu/postings?page=2", null],
    // LinkedIn
    ["https://www.linkedin.com/comm/jobs/view/4123456789", "linkedin:4123456789"],
    ["https://www.linkedin.com/jobs/view/4123456789/?trk=x", "linkedin:4123456789"],
    ["https://www.linkedin.com/jobs/view/data-analyst-at-acme-4123456789", "linkedin:4123456789"],
    ["https://www.linkedin.com/comm/jobs/search?keywords=data", null],
    ["https://www.linkedin.com/comm/psettings/email-unsubscribe?x=1", null],
    // Indeed
    ["https://www.indeed.com/rc/clk?jk=abc123&from=ja", "indeed:abc123"],
    ["https://www.indeed.com/viewjob?jk=abc123", "indeed:abc123"],
    ["https://www.indeed.com/m/viewjob?jk=abc123", "indeed:abc123"],
    ["https://www.indeed.com/jobs?q=data+analyst", null],
    // ZipRecruiter
    ["https://www.ziprecruiter.com/c/Acme/Job/Data-Analyst/-in-Dover,DE?jid=zz9", "ziprecruiter:zz9"],
    ["https://www.ziprecruiter.com/unsubscribe?e=1", null],
    // Glassdoor
    ["https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1009", "glassdoor:1009"],
    ["https://www.glassdoor.com/Job/data-analyst-jobs-SRCH_KO0,12.htm", null],
    ["https://www.glassdoor.com/member/emailPreferences_input.htm", null],
    // Not a board we read at all
    ["https://boards.greenhouse.io/acme/jobs/1234", null],
    ["", null],
    ["javascript:void(0)", null],
  ];

  for (const [url, expected] of cases) {
    it(`${expected ?? "rejects"} ← ${url || "(empty)"}`, () => {
      const m = matchJobUrl(url);
      expect(m ? `${m.key}:${m.id}` : null).toBe(expected);
    });
  }

  it("every shape in the table has a distinct id namespace", () => {
    const keys = JOB_URL_SHAPES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("unwrapTracking", () => {
  it("follows a ?url= wrapper", () => {
    expect(
      unwrapTracking("https://click.example.com/x?url=https%3A%2F%2Fwww.indeed.com%2Fviewjob%3Fjk%3Dz"),
    ).toBe("https://www.indeed.com/viewjob?jk=z");
  });

  it("follows the other redirect param spellings", () => {
    for (const p of ["targetUrl", "redirect", "destination", "u"]) {
      expect(unwrapTracking(`https://t.example.com/c?${p}=https%3A%2F%2Fexample.org%2Fjobs%2F1`)).toBe(
        "https://example.org/jobs/1",
      );
    }
  });

  it("follows a URL embedded in the PATH (SendGrid style)", () => {
    expect(
      unwrapTracking(
        "https://u1.ct.sendgrid.net/CL0/https:%2F%2Fapp.joinhandshake.com%2Fjobs%2F42/1/0100",
      ),
    ).toContain("app.joinhandshake.com/jobs/42");
  });

  it("follows nested wrappers but stops after a few hops", () => {
    const inner = encodeURIComponent("https://www.indeed.com/viewjob?jk=deep");
    const mid = encodeURIComponent(`https://b.example.com/r?url=${inner}`);
    expect(unwrapTracking(`https://a.example.com/r?url=${mid}`)).toBe(
      "https://www.indeed.com/viewjob?jk=deep",
    );
  });

  it("leaves a plain URL and a non-URL alone", () => {
    expect(unwrapTracking("https://www.indeed.com/viewjob?jk=z")).toBe(
      "https://www.indeed.com/viewjob?jk=z",
    );
    expect(unwrapTracking("not a url")).toBe("not a url");
    expect(unwrapTracking("")).toBe("");
  });
});

describe("text helpers", () => {
  it("decodes the entities these templates use", () => {
    expect(decodeEntities("Acme &amp; Co &middot; Dover&#44; DE &#x2014; now")).toBe(
      "Acme & Co · Dover, DE — now",
    );
    expect(decodeEntities("&notanentity; &#999999999;")).toBe("&notanentity; ");
  });

  it("tells a place from an employer", () => {
    for (const s of ["Wilmington, DE", "Philadelphia, Pennsylvania", "Remote", "New York, NY (Hybrid)", "Remote (United States)"]) {
      expect(looksLikeLocation(s)).toBe(true);
    }
    // Employers whose names START with a country word must not read as places —
    // that would cost us the employer name AND corrupt the location.
    for (const s of ["Acme Analytics", "Cormorant Bank", "Vireo Health Systems", "US Bank", "USA Today", ""]) {
      expect(looksLikeLocation(s)).toBe(false);
    }
    expect(deriveMeta(["US Bank · Wilmington, DE"], "Data Analyst")).toEqual({
      company: "US Bank",
      location: "Wilmington, DE",
    });
  });

  it("derives nothing rather than guessing from an unrecognizable block", () => {
    expect(deriveMeta(["Promoted", "Easy Apply", "$120,000"], "Data Analyst")).toEqual({
      company: "",
      location: "",
    });
    expect(deriveMeta([], "Data Analyst")).toEqual({ company: "", location: "" });
  });

  it("strips an image-alt 'logo' suffix off a company name", () => {
    expect(deriveMeta(["Acme Analytics logo", "Dover, DE"], "Data Analyst").company).toBe(
      "Acme Analytics",
    );
  });

  it("isoDay handles a Date, a string and junk", () => {
    expect(isoDay(new Date("2026-09-14T23:00:00Z"))).toBe("2026-09-14");
    expect(isoDay("2026-09-14T11:05:00Z")).toBe("2026-09-14");
    expect(isoDay(undefined)).toBe("");
    expect(isoDay("nope")).toBe("");
  });
});

describe("mergeAlerts", () => {
  const mk = (over: Partial<Posting>): Posting => ({
    id: "handshake:1",
    company: "Handshake",
    title: "Data Analyst",
    location: "",
    url: "https://app.joinhandshake.com/jobs/1",
    postedOn: "2026-09-14",
    via: "Handshake alert",
    ...over,
  });

  it("collapses a job re-alerted in several emails", () => {
    expect(mergeAlerts([mk({}), mk({ postedOn: "2026-09-15" })])).toHaveLength(1);
  });

  it("keeps the OLDEST email's date (closest to the real posting date)", () => {
    expect(mergeAlerts([mk({}), mk({ postedOn: "2026-09-15" })])[0].postedOn).toBe("2026-09-14");
  });

  it("upgrades a source-name fallback when a later copy names the employer", () => {
    const merged = mergeAlerts([mk({}), mk({ company: "Acme Analytics", location: "Dover, DE" })]);
    expect(merged[0]).toMatchObject({ company: "Acme Analytics", location: "Dover, DE" });
  });

  it("never downgrades a real employer to the fallback", () => {
    const merged = mergeAlerts([mk({ company: "Acme Analytics" }), mk({})]);
    expect(merged[0].company).toBe("Acme Analytics");
  });
});

describe("inboxConfig", () => {
  it("is null with no credentials — the skip path", () => {
    expect(inboxConfig({})).toBeNull();
    expect(inboxConfig({ ALERT_INBOX_USER: "a@b.c" })).toBeNull();
    // An unset GitHub Actions secret arrives as "", not as an absent variable.
    expect(inboxConfig({ ALERT_INBOX_USER: "", ALERT_INBOX_APP_PASSWORD: "" })).toBeNull();
    expect(inboxConfig({ ALERT_INBOX_USER: " ", ALERT_INBOX_APP_PASSWORD: "x" })).toBeNull();
  });

  it("defaults to Gmail IMAP over TLS, INBOX, 3 days", () => {
    expect(inboxConfig({ ALERT_INBOX_USER: "a@b.c", ALERT_INBOX_APP_PASSWORD: "p" })).toMatchObject({
      host: "imap.gmail.com",
      port: 993,
      mailbox: "INBOX",
      days: 3,
      maxMessages: 200,
    });
  });

  it("takes overrides and ignores junk ones", () => {
    expect(
      inboxConfig({
        ALERT_INBOX_USER: "a@b.c",
        ALERT_INBOX_APP_PASSWORD: "p",
        ALERT_INBOX_HOST: "outlook.office365.com",
        ALERT_INBOX_PORT: "993",
        ALERT_INBOX_MAILBOX: "Job alerts",
        ALERT_INBOX_DAYS: "nonsense",
        ALERT_INBOX_BUDGET_SEC: "30",
      }),
    ).toMatchObject({ host: "outlook.office365.com", mailbox: "Job alerts", days: 3, budgetMs: 30_000 });
  });
});

describe("the rest of the pipeline accepts these postings", () => {
  const out = normalizeEmailAlerts(fixture("alert-handshake.html"), meta);

  it("passes the title/location pre-filter", () => {
    expect(matches(byTitle(out, "Data Analyst, Early Career")!, LOCAL_FILTERS)).toBe(true);
    expect(matches(byTitle(out, "Business Intelligence Analyst")!, FILTERS)).toBe(true);
  });

  it("an unknown location still passes (same rule as Workday's 'N Locations')", () => {
    expect(matches(byTitle(out, "Junior Data Scientist")!, FILTERS)).toBe(true);
  });

  it("the LLM stage has a no-JD branch, which is the only path these take", () => {
    const prompt = buildUserPrompt(byTitle(out, "Data Analyst, Early Career")!);
    expect(prompt).toContain("Data Analyst, Early Career");
    expect(prompt).toContain("Acme Analytics");
    expect(prompt).toContain("no description available");
  });

  it("dedupes against the same req from a direct source via the URL key", () => {
    // What our own Indeed-derived JobSpy rows publish for the same posting.
    const fromAlert = normalizeEmailAlerts(fixture("alert-indeed.html"), meta)[0];
    expect(normalizedUrlKey(fromAlert.url)).toBe(
      normalizedUrlKey("https://indeed.com/viewjob?jk=a1b2c3d4e5f6&from=serp"),
    );
  });

  it("never claims cap-exempt — an alert email publishes nothing of the kind", () => {
    expect(out.every((p) => !p.capExempt)).toBe(true);
  });
});
