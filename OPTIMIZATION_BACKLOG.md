# Optimization Backlog — job-opening-monitor

Reviewed 2026-07-14. Ordered by priority. Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Priority order (agreed)

1. **A1** — ISO-date recency parsing (Greenhouse/Lever roles currently bypass the 14-day filter) `[x]`
2. **B1** — Add missing strategy-critical sources (banks + cap-exempt employers) `[~]` (Barclays + Citi added; ChristianaCare marked cap-exempt)
3. **A2** — Paginate the `seen` load (PostgREST caps at 1000 rows → duplicate alerts once the table grows) `[x]`
4. **B2 + B3** — cap-exempt flag + Delaware-first alert ordering `[x]`
5. **A3** — Raise Workday per-term result cap (newest bank roles fall past the first 100) `[x]`

### B1 source-verification notes (2026-07-14, probed with the real Node fetch client)

- **Added (verified 200):** Barclays (`barclays/wd3/external_career_site_barclays`, ~431), Citi (`citi/wd5/2`, ~2000). ChristianaCare flagged `capExempt: true`.
- **Blocked — session handshake required (CXS returns 422 to a plain POST, even for a known job's detail):** Sallie Mae (`sallie-mae/wd5/Careers`), Nemours (`nemours/wd1/careers_at_nemours`), University of Delaware, Truist. These SPAs GET the site first to set a cookie, then send it on the CXS call — needs an adapter that does the cookie handshake.
- **Other ATS / auth:** Discover (401, needs auth), Best Egg (not on Lever/Greenhouse — find real ATS), JPMC (Oracle Cloud — needs a new adapter; highest value via referral).

---

## A. Correctness bugs

- **A1** `recency.ts` `postedDays()` only parses Workday relative text; ISO dates (`2026-06-18` from Greenhouse/Lever) → `null` → treated as "unknown age, pass". ~31 companies skip the recency filter. Proof: 90-day-old Figma roles in the 2026-07-13 dry-run.
- **A2** `state.ts` `loadSeenKeys()` GETs the whole table but PostgREST returns ≤1000 rows by default. Once `monitor_seen_jobs` exceeds 1000, older keys vanish → old roles re-alerted + re-inserted into tracker. Fix: paginate via `Range` header (or query only candidate keys).
- **A3** `workday.ts` `MAX_RESULTS = 100` per search term; Workday sorts by relevance, not date, so the newest roles at high-volume employers (banks) can sit past #100 and never surface.
- **A4** Alerts fire before `markSeen` ([index.ts]); if `markSeen` fails the whole batch re-alerts next run. Fix: markSeen-then-alert, or retry markSeen.

## B. Strategy alignment

- **B1** Source list is asymmetric to the 80% DA + Delaware strategy. Missing: JPMC (Oracle — needs adapter), Barclays/Citi/Discover/BofA, cap-exempt Nemours/UD, Sallie Mae, Best Egg. Most are one config line.
- **B2** No cap-exempt concept. Add `capExempt?: boolean` to `CompanySource`; surface "✅ cap-exempt — no lottery" and rank it top. Matters more than the wage hint for this candidate.
- **B3** `select.ts` ordering is sponsorable→fresh only. Real priority: DE-local > cap-exempt > high-wage > rest.
- **B4** `[x]` Strict `includeKeywords` gained `business intelligence`, `quantitative analyst`, `risk analyst`, `credit analyst` — so DA titles like the M&T Quant Analyst are caught anywhere, not only in the DE wider-filter zone.

## C. Noise / precision

- **C1** `[x]` `isDelaware` (rank.ts) is state-aware: a bare ring city (Newark/Wilmington) is rejected when another US state is named (comma-preceded abbrevs, so "in"/"or"/"me" don't false-match). Tested: Newark NJ / Wilmington NC → false.
- **C2** `[x]` `findSalary` now handles `$95K`/K-ranges and prefers a range / the largest figure over the first `$` (bonus/hourly). `dollarValue`/`salaryFloor` in rank.ts expand `K`. Known remaining edge: European-formatted comp like Citi's `$107 120,00 - $160 680,00` (space thousands-sep + comma decimal) still parses to `$160` — not worth the i18n-number complexity for a rare listing.
- **C3** `[x]` `LOCAL_FILTERS` excludes clinical titles (`rn`, `nurse`, `nursing`, `physician`, `pharmacist`, `therapist`); "clinical" left in on purpose ("Clinical Data Analyst" is legit). Verified: the "… Analyst (RN Required)" role no longer matches.
- **C4** `[x]` `MAX_ALERTS_PER_RUN` (default 30) caps Telegram/email volume with a "…and N more — see the tracker" note; the tracker still gets all matches.

## D. Robustness

- **D1** `[x]` `collectAll` reports hard-failed sources; a Telegram warning fires only when ≥3 fail in one run (systemic), not for a single persistently-broken tenant. (Per-source consecutive-round tracking would need a state table — future.) The W.L. Gore / Navient "returns 0 without error" case is still not distinguishable from "no matching jobs" without a baseline.
- **D2** `[x]` `intEnv()` guards `MAX_AGE_DAYS` / `MAX_ALERTS_PER_RUN` against NaN / non-positive.
- **D3** `[x]` A failing Workday search term is caught per-term; the company only hard-fails if every term throws.

## E. Minor

- **E1** `[x]` Bumped `actions/checkout@v4→v5`, `actions/setup-node@v4→v5`, `node-version 20→22`; exposed `MAX_ALERTS_PER_RUN` / `WORKDAY_MAX_RESULTS` as repo Variables.
- **E2** Email (Resend) channel unconfigured — Telegram deemed sufficient.
- **E4** Consider night-time cron downshift (15 min daytime, hourly overnight).

## Remaining / follow-ups

- **JPMorgan Chase** `[x]` — new Oracle Cloud CE adapter (`adapters/oracle.ts`); polls sites CX_1001 + CX_1002 with pagination, enriches via the CE detail endpoint (sponsorship/salary/remote). Verified live: ~644 fetched, Wilmington/Newark DE roles (incl. Payment Lifecycle / Risk Reporting Analyst) surface with salary + sponsorship flags.
- **Nemours** `[x]` (2026-09-10) — NOT Workday. It runs Oracle Cloud CE (`epyz.fa.us2.oraclecloud.com`,
  site `CX_1`), so it reused the JPMC adapter: config-only, marked `capExempt`. Verified live.
- **University of Delaware** `[x]` (2026-09-10) — NOT Workday either. It runs **PageUp**
  (`careers.udel.edu`, dc4 instance 858) behind an **AWS WAF** challenge: a plain fetch gets HTTP 202 +
  a JS proof-of-work page, and no header combination passes. New `adapters/pageup.ts` drives headless
  Chromium (Playwright) — verified live, 170 roles fetched, 6 Newark DE matches, all cap-exempt and
  ranked top. CI installs chromium in the workflow.
- **The "session handshake" diagnosis above was wrong.** Those 422s were not a cookie problem — the
  tenant/site ids were guesses at careers sites that aren't Workday at all. Before adding a source,
  confirm the real ATS by grepping the employer's careers page for an ATS hostname; don't guess a
  Workday tenant from the company name. Sallie Mae / Truist are still unverified on that basis.
- **Ashby + SmartRecruiters adapters** `[x]` (2026-09-10) — both public, both unauthenticated.
  Ashby returns the JD and pay range in the list call (no detail fetch); SmartRecruiters filters by
  `country=us` server-side. 15 new sources.
- **ATS sweep** `[x]` (2026-09-10) — grepping careers pages for ATS hostnames found S&P Global
  (`spgi/wd5/spgi_careers`), Nasdaq (`nasdaq/wd1/global_external_site`) and Guardian Life
  (`guardianlife/wd5/guardian-life-careers`) — all health-check green.
- **B1 leftovers — still unresolved, with dead ends now recorded:**
  - *Sallie Mae*: careers page points at `sallie-mae.wd5.myworkdayjobs.com/careers` and that page
    returns 200, but every CXS combination tried returns 422 (`sallie-mae`/`salliemae` x
    `careers`/`Careers`/`SallieMae_Careers`/`External`). The CXS tenant id evidently differs from the
    subdomain; needs the id from the site's own network calls.
  - *Best Egg*: careers page links to `jobs.lever.co/bestegg`, but both that board and the Lever API
    return 404 — a stale link. They have moved ATS; re-identify before adding.
  - *Truist* / *Discover* (401) — unchanged.
- **Comcast** `[x]` (2026-09-10) — wd5 started returning HTTP 410; the tenant moved to wd115. Source had
  been silently dead. `npm run check` catches this class of failure — worth running periodically.
- **findSalary grant figures** `[x]` (2026-09-10) — university/research JDs cite funding ("a 5-year,
  $21.5 million initiative"), which won as the largest dollar amount and showed up as a salary.
  Figures followed by million/billion are now dropped.
- **D1+** — per-source consecutive-failure state table.
