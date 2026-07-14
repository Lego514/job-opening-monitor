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
- **B4** Strict `includeKeywords` lacks `quantitative analyst` / `risk analyst` / `credit analyst` / `business intelligence`. The M&T Quant Analyst was only caught because it was in DE (wider filter); the same title elsewhere is missed.

## C. Noise / precision

- **C1** `DE_AREA` regex ([index.ts]) matches Newark **NJ**, Wilmington **NC/MA** → out-of-DE roles get the wider filter.
- **C2** `[x]` `findSalary` now handles `$95K`/K-ranges and prefers a range / the largest figure over the first `$` (bonus/hourly). `dollarValue`/`salaryFloor` in rank.ts expand `K`. Known remaining edge: European-formatted comp like Citi's `$107 120,00 - $160 680,00` (space thousands-sep + comma decimal) still parses to `$160` — not worth the i18n-number complexity for a rare listing.
- **C3** `[x]` `LOCAL_FILTERS` excludes clinical titles (`rn`, `nurse`, `nursing`, `physician`, `pharmacist`, `therapist`); "clinical" left in on purpose ("Clinical Data Analyst" is legit). Verified: the "… Analyst (RN Required)" role no longer matches.
- **C4** No per-run alert cap → first successful run dumped 231 Wishlist rows into the tracker. Add `MAX_ALERTS_PER_RUN`.

## D. Robustness

- **D1** A permanently-broken source (renamed tenant) fails silently in logs (W.L. Gore / Navient return 0 — verify). Alert after N consecutive failures.
- **D2** Bad `MAX_AGE_DAYS` env → `NaN` → silently filters out every known-age role. Add a guard.
- **D3** A failed Workday search term aborts the company's remaining terms (no per-term try/catch).

## E. Minor

- **E1** GitHub Actions `checkout@v4`/`setup-node@v4` Node-20 deprecation → bump.
- **E2** Email (Resend) channel unconfigured — Telegram deemed sufficient.
- **E4** Consider night-time cron downshift (15 min daytime, hourly overnight).
