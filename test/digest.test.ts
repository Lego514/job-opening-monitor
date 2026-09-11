import { describe, it, expect } from "vitest";
import {
  type Candidate,
  candidateToPosting,
  effectiveAgeDays,
  toCandidateRow,
} from "../src/candidates";
import { digestMessage, digestTags, selectDigest, todayKeyNY, todayLabelNY } from "../src/digest";
import { checkEnv } from "../src/env";
import { chunkMessage } from "../src/notify/telegram";
import { type LlmVerdict, type Posting } from "../src/types";

const NOW = Date.parse("2026-09-11T15:00:00Z"); // 11:00 in New York
const DAY = 86_400_000;

const verdict = (over: Partial<LlmVerdict> = {}): LlmVerdict => ({
  newGradFit: "yes",
  seniority: "new-grad",
  roleFamily: "data-analyst",
  sponsorship: "silent",
  remoteUS: false,
  summary: "Entry-level analytics role on the reporting team.",
  ...over,
});

const mk = (over: Partial<Candidate> = {}): Candidate => ({
  key: over.key ?? `C:${over.title ?? "role"}`,
  company: "Acme",
  title: "Data Analyst",
  location: "Austin, TX",
  url: `https://jobs.example.com/${over.key ?? over.title ?? "role"}`,
  postedOn: "2026-09-10",
  postedDaysAtCapture: 1,
  firstSeen: new Date(NOW).toISOString(),
  salary: null,
  remote: false,
  capExempt: false,
  via: null,
  sponsorship: "unknown",
  sponsorshipReason: null,
  llm: verdict(),
  sponsorHistory: null,
  ...over,
});

const opts = (over: Partial<Parameters<typeof selectDigest>[1]> = {}) => ({
  size: 5,
  maxAgeDays: 10,
  digestedKeys: new Set<string>(),
  actedUrlKeys: new Set<string>(),
  now: NOW,
  ...over,
});

describe("selectDigest — eligibility", () => {
  it("keeps only roles the LLM reads as a new-grad fit", () => {
    const pool = [
      mk({ key: "a", llm: verdict({ newGradFit: "yes" }) }),
      mk({ key: "b", llm: verdict({ newGradFit: "no", seniority: "senior" }) }),
    ];
    const r = selectDigest(pool, opts());
    expect(r.chosen.map((c) => c.key)).toEqual(["a"]);
    expect(r.counts.fit).toBe(1);
  });

  it("drops roles whose sponsorship is ruled out by either the JD scan or the LLM", () => {
    const pool = [
      mk({ key: "ok" }),
      mk({ key: "jd-no", sponsorship: "no" }),
      mk({ key: "llm-no", llm: verdict({ sponsorship: "no-sponsorship" }) }),
    ];
    expect(selectDigest(pool, opts()).chosen.map((c) => c.key)).toEqual(["ok"]);
  });

  it("drops roles past the age limit, but keeps unknown-age ones", () => {
    const pool = [
      mk({ key: "fresh", postedDaysAtCapture: 2 }),
      mk({ key: "stale", postedDaysAtCapture: 40 }),
      mk({ key: "unknown", postedDaysAtCapture: null }),
    ];
    const keys = selectDigest(pool, opts()).chosen.map((c) => c.key);
    expect(keys).toContain("fresh");
    expect(keys).toContain("unknown");
    expect(keys).not.toContain("stale");
  });

  it("ages a candidate by how long it has sat in the pool, not just its capture age", () => {
    // Captured 9 days ago as "2 days old" -> 11 days old today, past the limit.
    const sat = mk({
      key: "sat",
      postedDaysAtCapture: 2,
      firstSeen: new Date(NOW - 9 * DAY).toISOString(),
    });
    expect(effectiveAgeDays(sat, NOW)).toBe(11);
    expect(selectDigest([sat], opts()).chosen).toHaveLength(0);
    expect(selectDigest([sat], opts({ maxAgeDays: 20 })).chosen).toHaveLength(1);
  });

  it("never re-shows a role from an earlier digest", () => {
    const pool = [mk({ key: "shown" }), mk({ key: "new" })];
    const r = selectDigest(pool, opts({ digestedKeys: new Set(["shown"]) }));
    expect(r.chosen.map((c) => c.key)).toEqual(["new"]);
  });

  it("skips roles already applied to / rejected in the tracker (matched by URL)", () => {
    const applied = mk({ key: "applied", url: "https://Jobs.Example.com/applied?utm_source=x" });
    const open = mk({ key: "open" });
    const r = selectDigest(
      [applied, open],
      opts({ actedUrlKeys: new Set(["jobs.example.com/applied"]) }),
    );
    expect(r.chosen.map((c) => c.key)).toEqual(["open"]);
  });
});

describe("selectDigest — sizing and fallback", () => {
  it("returns at most `size` roles", () => {
    const pool = Array.from({ length: 12 }, (_, i) => mk({ key: `k${i}` }));
    expect(selectDigest(pool, opts({ size: 5 })).chosen).toHaveLength(5);
    expect(selectDigest(pool, opts({ size: 3 })).chosen).toHaveLength(3);
  });

  it('falls back to "maybe" only when there aren\'t enough sure fits', () => {
    const pool = [
      mk({ key: "yes1" }),
      mk({ key: "yes2" }),
      mk({ key: "maybe1", llm: verdict({ newGradFit: "maybe" }) }),
      mk({ key: "maybe2", llm: verdict({ newGradFit: "maybe" }) }),
    ];
    const two = selectDigest(pool, opts({ size: 2 }));
    expect(two.chosen.map((c) => c.key)).toEqual(["yes1", "yes2"]);
    expect(two.usedFallback).toBe(false);

    const four = selectDigest(pool, opts({ size: 4 }));
    expect(four.chosen.slice(0, 2).map((c) => c.key)).toEqual(["yes1", "yes2"]);
    expect(four.chosen).toHaveLength(4);
    expect(four.usedFallback).toBe(true);
    expect(four.counts.fit).toBe(2); // the footer counts sure fits, not the fallback
  });

  it("reaches unclassified roles last — a queue with no LLM key still works", () => {
    const pool = [mk({ key: "yes1" }), mk({ key: "raw", llm: null })];
    const one = selectDigest(pool, opts({ size: 1 }));
    expect(one.chosen.map((c) => c.key)).toEqual(["yes1"]);
    const two = selectDigest(pool, opts({ size: 2 }));
    expect(two.chosen.map((c) => c.key)).toEqual(["yes1", "raw"]);
  });
});

describe("selectDigest — ordering mirrors selectAlertable", () => {
  it("ranks DE-local above cap-exempt above NYC above the rest", () => {
    const pool = [
      mk({ key: "elsewhere", location: "Austin, TX" }),
      mk({ key: "nyc", location: "New York, NY" }),
      mk({ key: "capexempt", location: "Boston, MA", capExempt: true }),
      mk({ key: "de", location: "Wilmington, DE" }),
    ];
    expect(selectDigest(pool, opts()).chosen.map((c) => c.key)).toEqual([
      "de",
      "capexempt",
      "nyc",
      "elsewhere",
    ]);
  });
});

describe("candidate round-trip", () => {
  const posting: Posting = {
    id: "R-1",
    company: "Acme",
    title: "Analyst",
    location: "Wilmington, DE",
    url: "https://x.test/1",
    postedOn: "Posted 3 Days Ago",
    salary: "$95,000 - $120,000",
    capExempt: true,
    llm: verdict(),
  };

  it("resolves a relative posting age at capture time", () => {
    const row = toCandidateRow(posting, NOW);
    expect(row.id).toBe("Acme:R-1");
    expect(row.posted_days).toBe(3);
    expect(row.posted_on).toBe("Posted 3 Days Ago");
    expect(row.cap_exempt).toBe(true);
  });

  it("rebuilds a Posting whose postedOn reflects today's effective age", () => {
    const c = mk({ postedDaysAtCapture: 3, firstSeen: new Date(NOW - 2 * DAY).toISOString() });
    const p = candidateToPosting(c, NOW);
    expect(p.postedOn).toBe("2026-09-06"); // 5 days before 2026-09-11
    expect(p.company).toBe("Acme");
  });
});

describe("digest message", () => {
  const pool = [
    mk({
      key: "a",
      company: "Acme & Co <Labs>",
      title: "Data Analyst I",
      location: "Wilmington, DE",
      salary: "$110,000",
      capExempt: true,
    }),
    mk({ key: "b", company: "Beta", title: "BI Analyst", location: "New York, NY" }),
  ];

  it("renders a numbered checklist with links and a counts footer", () => {
    const msg = digestMessage(selectDigest(pool, opts()), NOW);
    expect(msg).toContain("Daily apply queue");
    expect(msg).toContain("1. ☐");
    expect(msg).toContain("2. ☐");
    expect(msg).toContain("https://jobs.example.com/a");
    expect(msg).toContain("2 in pool · 2 new-grad-fit · 2 shown");
  });

  it("escapes HTML so a company name can't break Telegram's parser", () => {
    const msg = digestMessage(selectDigest(pool, opts()), NOW);
    expect(msg).toContain("Acme &amp; Co &lt;Labs&gt;");
    expect(msg).not.toContain("<Labs>");
    // The only tags left are the ones we emit ourselves.
    const tags = msg.match(/<[^>]+>/g) ?? [];
    expect(tags.every((t) => /^<\/?(b|i)>$/.test(t))).toBe(true);
  });

  it("says something useful on an empty day instead of sending a blank list", () => {
    const r = selectDigest([mk({ key: "done" })], opts({ digestedKeys: new Set(["done"]) }));
    const msg = digestMessage(r, NOW);
    expect(msg).toContain("Nothing new to apply to today");
    expect(msg).not.toContain("☐");
  });

  it("fits a full default-size queue in one Telegram message", () => {
    const big = Array.from({ length: 5 }, (_, i) =>
      mk({
        key: `k${i}`,
        company: "A".repeat(60),
        title: "T".repeat(90),
        location: "L".repeat(80),
        salary: "$120,000 - $150,000 per year",
        llm: verdict({ summary: "S".repeat(140) }),
      }),
    );
    const msg = digestMessage(selectDigest(big, opts()), NOW);
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(chunkMessage(msg)).toHaveLength(1);
  });

  it("splits with the existing chunker if a queue ever overruns the limit", () => {
    const huge = Array.from({ length: 40 }, (_, i) =>
      mk({ key: `k${i}`, title: "T".repeat(200) }),
    );
    const msg = digestMessage(selectDigest(huge, opts({ size: 40 })), NOW);
    expect(msg.length).toBeGreaterThan(4000);
    const parts = chunkMessage(msg);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
  });
});

describe("digestTags", () => {
  it("explains why a role ranks: lottery, geography, wage, sponsor history, age", () => {
    const tags = digestTags(
      mk({
        location: "Newark, DE",
        capExempt: true,
        salary: "$135,000",
        postedDaysAtCapture: 0,
        llm: verdict({ sponsorship: "will-sponsor" }),
      }),
      NOW,
    );
    expect(tags).toContain("✅ cap-exempt — no H-1B lottery");
    expect(tags).toContain("🏠 DE-local");
    expect(tags).toContain("💲$135,000");
    expect(tags).toContain("📈 high wage → strong H-1B lottery odds");
    expect(tags).toContain("🛂 JD mentions sponsorship");
    expect(tags).toContain("posted today");
  });

  it("marks NYC metro and an unclassified role", () => {
    const tags = digestTags(mk({ location: "Brooklyn, NY", llm: null }), NOW);
    expect(tags).toContain("🗽 NYC metro");
    expect(tags).toContain("🎓 unclassified");
  });
});

describe("today key (America/New_York)", () => {
  it("formats as a Postgres date literal", () => {
    expect(todayKeyNY(Date.parse("2026-09-11T15:00:00Z"))).toBe("2026-09-11");
    expect(todayLabelNY(Date.parse("2026-09-11T15:00:00Z"))).toBe("Fri, Sep 11");
  });

  it("uses the New York day, not UTC's — an evening run is still today", () => {
    // 2026-09-12T01:30Z is 21:30 on the 11th in New York.
    expect(todayKeyNY(Date.parse("2026-09-12T01:30:00Z"))).toBe("2026-09-11");
    // And 08:00 ET on the 12th (EDT, UTC-4) is 12:00Z.
    expect(todayKeyNY(Date.parse("2026-09-12T12:00:00Z"))).toBe("2026-09-12");
  });

  it("handles standard time too (EST is UTC-5)", () => {
    // 2026-01-15T04:30Z is 23:30 on the 14th in New York.
    expect(todayKeyNY(Date.parse("2026-01-15T04:30:00Z"))).toBe("2026-01-14");
    expect(todayKeyNY(Date.parse("2026-01-15T13:00:00Z"))).toBe("2026-01-15");
  });
});

describe("checkEnv — digest mode", () => {
  it("needs Supabase even for a dry run (it reads the real pool)", () => {
    expect(checkEnv({}, "digest").missing).toEqual([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("warns about the channel and the tracker read-back without failing", () => {
    const { missing, degraded } = checkEnv(
      { SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" },
      "digest",
    );
    expect(missing).toEqual([]);
    expect(degraded.join(" ")).toContain("TELEGRAM_BOT_TOKEN");
    expect(degraded.join(" ")).toContain("TRACKER_USER_ID");
  });
});
