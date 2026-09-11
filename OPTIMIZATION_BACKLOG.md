# Optimization Backlog — job-opening-monitor

Reviewed 2026-07-14. Ordered by priority. Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Priority order (agreed)

1. **A1** — ISO-date recency parsing (Greenhouse/Lever roles currently bypass the 14-day filter) `[x]`
2. **B1** — Add missing strategy-critical sources (banks + cap-exempt employers) `[x]` (banks added 2026-07-14; cap-exempt expanded 3 → 21 on 2026-09-11 — see "Cap-exempt expansion" below)
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

## F. LLM classification (2026-09-11)

- **F1** `[x]` **Title keyword filter missed new-grad roles.** `includeKeywords` required substrings like
  "software engineer"/"data analyst", so "Technology Development Program", "Early Career Rotational
  Program", "Graduate Engineer", "Quantitative Researcher", "Applied Scientist", "Solutions Engineer",
  "Analytics Associate", "2027 Analyst Program" never matched. `FILTERS` is now a WIDE pre-filter
  (`engineer`, `analyst`, `scientist`, `researcher`, `associate`, `graduate`, `program`, `rotational`,
  `early career`, `new grad`, `university`, `technologist`); `LOCAL_FILTERS` got the same vocabulary so
  the top-choice location is never the narrower net.
- **F2** `[x]` **Exclude keywords killed entry-level roles.** `senior`/`sr`/`lead`/`staff`/`manager`/
  `architect` are gone — they dropped Capital One "Senior Associate" and bank "Associate" tiers, and the
  `senior associate` special case in `match.isExcluded` went with them. What remains is executive titles
  (director/vp/head/chief/principal/president/svp/evp) plus wrong-discipline words (non-software
  engineering, clinical) — those are noise the LLM would otherwise be billed to reject.
- **F3** `[x]` **Sponsorship was "unknown" for ~80% of matches.** `src/llm.ts` sends title + location +
  truncated JD to Claude Haiku 4.5 and gets structured JSON back via a strict tool call: `newGradFit`,
  `seniority`, `roleFamily`, `sponsorship` (`will-sponsor`/`no-sponsorship`/`silent` + a JD quote),
  `remoteUS`, `summary`. `silent` is now distinguishable from "we didn't look", which is the whole point.
- **F4** `[x]` **Cost ceiling.** The stage sits AFTER the `seen` diff, so only genuinely new roles are
  classified; verdicts are cached in `monitor_llm_verdicts` (migration `0003`) keyed by posting key; the
  JD is truncated to ~4k chars; `LLM_MAX_PER_RUN` (80) and `LLM_DRY_RUN_MAX` (15) bound the worst case.
  ~$0.0018/role.
- **F5** `[x]` **Graceful degradation.** No `ANTHROPIC_API_KEY` (the normal local case) → `checkEnv`
  reports it as degraded and the run takes the regex path unchanged. An API failure is caught per
  posting; a role with no verdict is never dropped, only never promoted.
- **F4b** `[x]` Postings past `LLM_MAX_PER_RUN` are DEFERRED, not consumed: they are held out of
  `markSeen` so the next run (15 min later) classifies them. Without this the first run after widening
  would have marked ~2400 backlog roles seen while screening only 80 — alerting the rest unscreened and
  then never looking at them again.
- **F6** — *follow-up:* the verdict cache has no TTL or model-version invalidation. The `model` column is
  recorded, but changing `LLM_MODEL` won't re-classify cached roles. Add a cache sweep if the prompt or
  model changes materially.
- **F7** — *follow-up:* no prompt caching. Haiku 4.5's minimum cacheable prefix (2048 tokens) is larger
  than the system prompt, so a `cache_control` breakpoint would be a no-op today. Revisit if the system
  prompt grows.
- **F8** — *follow-up:* the widened pre-filter raises the number of enriched postings —
  measured 563 → 2517 matches per run, so ~4.5x the JD detail fetches. A full dry run now takes ~6m40s
  (was ~2m) — wall-clock, not dollars, and still inside the 15-min cron, but the margin is no longer
  large. If runs get slow, tighten the discipline
  excludes rather than re-adding seniority ones.
- **F9** — *follow-up:* `LLM_MAX_PER_RUN` is per-run, not per-day. At 96 runs/day the theoretical worst
  case is far over budget; in practice it can't be reached (it needs 80 genuinely new postings every 15
  minutes) and steady-state is ~140 new/day ≈ $0.26. A real daily cap would need a spend-tracking table.


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
- **GitHub community lists** `[x]` (2026-09-11) — new `adapters/githublist.ts`. Three aggregator
  sources read from `raw.githubusercontent.com` (the GitHub API's 60/h anonymous cap rules it out for a
  15-minute cron):
  - *SimplifyJobs/New-Grad-Positions* — `.github/scripts/listings.json` on `dev`, ~20k rows (~3k open,
    ~200 matching and ≤14d). JSON beats the README table: real timestamps, structured locations,
    `active`/`is_visible` flags.
  - *vanshb03/New-Grad-2027* — identical schema, same parser. Near-dormant (newest row 2026-08-05), so
    the recency filter drops all 370 of its matches today; kept because it's one cheap fetch and
    auto-activates if the repo resumes.
  - *zapplyjobs/New-Grad-Jobs-2027* — no JSON, so `parseZapplyTable` parses the README tables (~600
    rows, ~120 matching). Note its "Posted" column is *time since the list last scraped the role*, not
    the true posting date, so every row reads as fresh — harmless here (the repo only carries roles
    under two weeks old) but don't trust it as a posting date.
  - **Rejected:** *jobright-ai/Daily-H1B-Jobs-In-Tech* — parseable, and it flags explicit H-1B
    sponsorship, but the repo has been dead since 2026-05-06 (~1,300 stale rows, no new signal).
    Worth re-checking; it's the only list that publishes a sponsorship verdict per row.
  - Cross-source dedup: `dedupe()` now also keys on `normalizedUrlKey` (`src/urlkey.ts`), because the
    same req arrives from a list and from its direct ATS adapter with different ids *and* different
    company spellings. Direct sources are ordered first in `COMPANIES` and win, since only they can
    fetch the JD.
  - Verified by dry run (2026-09-11): 96 sources, **0 FAILED**; lists fetched 2964 / 631 / 598;
    536 matched of 19,174 fetched. Of those, 182 came via SimplifyJobs and 114 via Zapply (vanshb03
    contributed 0, as expected). Noise found and fixed: one "Remote in UK" row — `isUSLocation()`
    counts any "remote" as a US signal and the comma-prefixed `", uk"` block entry can't see that
    phrasing, so `"in uk" / "in the uk" / "uk remote" / "remote - uk"` were added to `blockLocations`.
  - Known residual: Zapply's apply links are `zapply.jobs/l/d/…` redirects, not ATS URLs, so
    `normalizedUrlKey` can't collapse its rows against a direct adapter — 3 of 536 (0.6%). Its slug
    does embed the source req id (`workday-comcast-comcast-careers-R443973`), so a third dedup axis on
    that token vs `Posting.id` would close the gap; not worth the fragility at this duplicate rate.
  - Follow-ups: (a) the Simplify file is ~14 MB (~2 MB gzipped) on every run — a conditional request
    (`If-None-Match` against the raw ETag) would make most runs a 304; (b) the first live run will
    surface ~200 backlogged matches at once — run `npm start -- --seed` first, or accept the
    `MAX_ALERTS_PER_RUN` trickle.
- **D1+** — per-source consecutive-failure state table.

---

## Cap-exempt expansion (2026-09-11)

Cap-exempt employers are the highest-value source type for this candidate — their H-1B petitions skip
the lottery, which is the real deadline. This pass took the count from **3 → 21**. Method, per the rule
above: fetch the employer's own careers page, grep it for an ATS hostname, then probe the real API for
HTTP 200 **with job data** before writing a config line. Nothing was guessed.

### Added — 18 sources, all `capExempt: true` (fetch counts from the 2026-09-11 dry run)

| Employer | ATS | fetched |
|---|---|---|
| Jefferson Health | Workday `jeffersonhealth/wd5/ThomasJeffersonExternal` | 299 |
| Children's Hospital of Philadelphia | Workday `chop/wd108/CHOPExternalCareers` | 51 |
| Memorial Sloan Kettering | Workday `msk/wd108/MSKCC_Careers_Primary` | 31 |
| Montefiore | Workday `montefiore/wd12/MMC` | 49 |
| Cornell University | Workday `cornell/wd1/CornellCareerPage` | 36 |
| Simons Foundation (Flatiron Institute) | Workday `simonsfoundation/wd1/simonsfoundationcareers` | 7 |
| University of Pennsylvania | Workday on `wd1.myworkdaysite.com` (`upenn/careers-at-penn`) | 54 |
| Northwell Health | Oracle CE `eppr.fa.us2.oraclecloud.com` / `CX_2` | 26 |
| Mount Sinai | Oracle CE `ejis.fa.us6.oraclecloud.com` / `CX` | 110 |
| Drexel University | PageUp `careers.drexel.edu` | 90 |
| Rowan University | PageUp `jobs.rowan.edu` | 260 |
| Seton Hall University | PageUp `jobs.shu.edu` | 384 |
| Swarthmore College | PageUp `careers.swarthmore.edu` | 18 |
| Rutgers University | PeopleAdmin `jobs.rutgers.edu` | 886 |
| Villanova University | PeopleAdmin `jobs.villanova.edu` | 345 |
| Delaware Technical Community College | PeopleAdmin `dtcc.peopleadmin.com` | 160 |
| Fordham University | PeopleAdmin `careers.fordham.edu` | 64 |
| Hofstra University | PeopleAdmin `hofstra.peopleadmin.com` | 78 |

Code changes (both small, both unit-tested):

- **`wdHost` on `CompanySource`** — UPenn *is* Workday, but on the **shared** `wd1.myworkdaysite.com`
  host, where the public URL is `/recruiting/{tenant}/{site}/job/…` instead of `/{site}/job/…`. The CXS
  API path (`/wday/cxs/{tenant}/{site}`) is byte-identical on both, so no new adapter was needed: the
  adapter derives host + public prefix via `workdayHost()` / `workdayPublicPrefix()`, and the detail-URL
  derivation is now a pure `workdayDetailUrl()` that handles both path shapes (and a leading `/en-US`
  locale segment). `check-sources.ts` uses the same helper.
- **`adapters/peopleadmin.ts`** — new, ~70 lines. PeopleAdmin's public `/postings/search.atom` returns
  the whole board with an ISO `<published>` date and the full JD in `<content>`, so no detail fetch and
  no pagination. `paLocation` supplies a campus city for the instances that omit `pa:city`/`pa:state`
  (only Rutgers publishes them).

Verified before committing: `npm test` (100 tests / 17 files), `npm run typecheck`, `npm run check`
(all Workday sources 200, including the 7 new ones), and a full `npm run dry-run` — every new source
logged `[fetch] <name>: N` with N>0, zero `FAILED`, `[match] 300 matched of 17928 fetched`, and 36 roles
tagged "✅ cap-exempt" (Jefferson 23, UD 6, Rutgers 2, ChristianaCare 2, Villanova / Nemours / Mount
Sinai 1 each). No clinical noise leaked through: `LOCAL_FILTERS`' rn/nurse/physician excludes plus the
strict title-keyword `FILTERS` handled the hospital boards as-is, so no filter tuning was needed.

### Investigated and NOT added — the exact dead end for each (don't repeat these)

- **Columbia University** — is PageUp underneath (`secure.dc4.pageuppeople.com/apply/884`), but
  `opportunities.columbia.edu` is a **custom SPA skin**, not the standard PageUp listing:
  `/en-us/listing/` 404s, and `/jobs/search` returns 339 KB of HTML with **zero** job links, zero
  `<script src=>`, and no occurrence of any job title — content is injected client-side from an
  unidentified endpoint. Confirmed dead under Playwright too (0 `a.job-link`). Would need that SPA's own
  XHR reverse-engineered. High value (NYC, cap-exempt) — worth a second look.
- **NewYork-Presbyterian**, **Temple Health / Fox Chase**, and CHOP's *front end* — **Phenom People**
  (`cdn.phenompeople.com`). No adapter exists. CHOP was still added because its Phenom site is backed by
  a real Workday tenant (`chop.wd108`); no such backing was found for NYP or Temple Health.
- **Weill Cornell Medicine** — SAP **SuccessFactors** (`career4.successfactors.com`, company
  `C0000274692P`). No adapter.
- **Stony Brook University** — **Taleo** (`stonybrooku.taleo.net`). No adapter.
- **Wilmington University** — **Taleo** (`phh.tbe.taleo.net/phh02/ats/careers/v2/…?org=WILMU`). No adapter.
- **NYU Langone Health** — **SilkRoad OpenHire** (`nyulangone-openhire.silkroad.com`, company 16370).
  No adapter.
- **NYU** (university), **Rockefeller University**, **Hackensack Meridian** — **iCIMS**, already
  documented here as unsupported (JS-rendered SPA, no server HTML and no feed).
- **Penn Medicine (UPHS)** — `careers.pennmedicine.org` answers every plain fetch with **HTTP 403**
  (bot-protection interstitial), so its ATS could not even be identified. Penn's *university* tenant
  (added above) does not carry UPHS hospital reqs.
- **Princeton University**, **Penn State**, **Johns Hopkins** — careers pages return **403** (Cloudflare
  "Just a moment…"); ATS unidentified. Princeton also has `main-princeton.icims.com` — iCIMS, so
  unsupported either way.
- **Temple University** (the university, not the health system) — `careers.temple.edu` serves 65 KB of
  HTML with no ATS hostname anywhere, and no PeopleAdmin feed (`/postings/search.atom` → 404).
  Unidentified in-house front end.
- **CUNY** — `cuny.jobs` returns a 92-byte stub and `cuny.edu/employment` has no ATS hostname. CUNY
  hires through CUNYfirst (PeopleSoft); no public feed found.
- **NJIT, Stevens Institute, Delaware State University** — every plausible host (`njit.jobs`,
  `careers.stevens.edu`, `careers.njit.edu`→`hr.njit.edu` with no ATS hostname, `jobs.desu.edu`, and the
  `*.peopleadmin.com` variants) either fails DNS or carries no ATS hostname. Their real careers URLs
  were not locatable from the public sites; re-check by hand.
- **Rider, Pace, Montclair, St John's, Bryn Mawr, Haverford, Widener, TCNJ, Goldey-Beacom** — probed for
  a PeopleAdmin feed; all 404 or DNS-fail. Not on PeopleAdmin (or on a differently-named host).
- **Wistar Institute, Coriell Institute, Cold Spring Harbor, Yeshiva/Einstein, RWJBarnabas, Penn State
  Health, Lehigh** — careers pages 403/404 or carry no ATS hostname. No feed found.

**Leftover adapters worth building next, ranked by cap-exempt value:** Phenom People (NYP + Temple
Health + many other hospitals), SuccessFactors (Weill Cornell), Taleo (Stony Brook, Wilmington
University). Each would unlock several employers at once, the way PeopleAdmin unlocked five here.
