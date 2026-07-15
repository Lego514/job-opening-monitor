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
- **B1 leftovers** — session-handshake adapter for the 422 tenants (Sallie Mae / Nemours / UD / Truist); Best Egg ATS (not on Lever/Greenhouse); Discover (401).
- **D1+** — per-source consecutive-failure state table.
