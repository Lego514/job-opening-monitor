# Job-Opening Monitor

A scheduled pipeline that watches target employers' career systems, detects **new** roles matching my
filters within minutes, alerts me on **Telegram + email**, and **auto-adds** them to my
[job tracker](../job-application-tracker)'s Wishlist. Built as the top-of-funnel automation for the tracker —
being among the first applicants matters when you're job hunting on an OPT clock. A second, **daily**
job turns that stream into a five-item **apply queue** at 08:00 ET — see
[The daily apply queue](#the-daily-apply-queue).

![stack](https://img.shields.io/badge/stack-Node%20%2B%20TypeScript-2f5bea) ![deps](https://img.shields.io/badge/runtime%20deps-0-1a9d6a) ![schedule](https://img.shields.io/badge/runs-GitHub%20Actions%20cron-697586)

## How it works

```
config (companies + filters)
   → adapters (Workday/Greenhouse/Lever/    extract
     Oracle CE APIs + PageUp via browser
     + JobSpy long tail, scraped first)
   → match (wide keyword + location net)    pre-filter
   → JD scan (sponsorship + salary)         enrich
   → diff vs. seen (Supabase)               dedup
   → LLM screen (Claude Haiku 4.5,          classify
     cached in Supabase, new roles only)
   → USCIS H-1B filings per employer        cross-reference
     (data/sponsors.json, offline index)
   → rank + Telegram + email + tracker row  load
```

- **Workday adapter** hits each tenant's public CXS JSON endpoint
  (`POST /wday/cxs/{tenant}/{site}/jobs`) — the same API the careers page uses — and **paginates** so
  matches past the first page aren't missed. One adapter covers every Workday employer — Delaware-local
  (AstraZeneca, DuPont, Solenis, W.L. Gore, Navient, WSFS Bank, M&T Bank, Corteva, ChristianaCare, Capital
  One, Vanguard, Comcast) plus big visa sponsors (NVIDIA, Salesforce, Adobe, Pfizer, GSK, Cisco, PayPal).
  Adding one is a single line in [`src/config.ts`](src/config.ts). (iCIMS / Incyte is **unsupported** — a JS-rendered SPA
  with no server HTML or feed; see [`src/adapters/icims.ts`](src/adapters/icims.ts).) A few tenants —
  universities especially — live on the shared `wd1.myworkdaysite.com` host, where the public URL is
  `/recruiting/{tenant}/{site}` instead of `/{site}`; the optional `wdHost` field covers that (the CXS
  API path is identical), so **University of Pennsylvania** needs no separate adapter.
- **Greenhouse + Lever adapters** — clean public board APIs. Add remote-friendly tech sponsors not on
  Workday: Affirm, Reddit, Robinhood, Datadog, Databricks, GitLab, Stripe, Airbnb, Lyft, Instacart,
  Pinterest, Dropbox, Twilio, Figma, Discord, SoFi, Chime, Asana (Greenhouse) and Spotify (Lever).
  **111 sources across 9 ATS platforms**, plus three community job lists and the JobSpy long-tail
  scraper — each returns its complete list every run, so dedup catches
  every new posting. Adding another is one config line.
- **Ashby adapter** — the best-shaped source here: one unauthenticated call returns the whole board
  *including* the plain-text JD and a parsed pay range, so these roles need no per-role detail fetch
  (same enrichment path as Lever). Ramp (NYC HQ), Harvey, Decagon, Warp, OpenAI, Notion, Cursor,
  Perplexity, ElevenLabs, Sierra, Vanta, Linear.
- **SmartRecruiters adapter** — public REST API, no key. These are global boards, so the adapter asks
  for `country=us` server-side (Experian: 434 roles worldwide, 37 in the US) and pages by offset.
  Experian, NielsenIQ, Bosch.
- **GitHub community-list adapter** — the one source type that isn't an employer. Curated new-grad
  lists on GitHub are rebuilt every few minutes and cover hundreds of companies this monitor will never
  have a config line for, so they run as three aggregator "sources" read straight from
  `raw.githubusercontent.com` (never the GitHub API — anonymous callers get 60 requests/hour, which a
  15-minute cron would burn on retries alone). Each row's `company` is the **employer**, and
  `Posting.via` carries the list name so alerts say where a role came from.
  - [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions) — reads the
    machine-readable `listings.json` on the `dev` branch (the file that generates the README), **not**
    the rendered table: it carries real posting timestamps, structured locations and an `active` flag
    that the markdown loses. ~20k rows, ~3k open, ~200 matching and recent.
  - [vanshb03/New-Grad-2027](https://github.com/vanshb03/New-Grad-2027) — same `listings.json` schema,
    same parser. Currently near-dormant (newest row Aug 2026), so the recency filter drops all of it;
    it costs one small fetch and starts contributing on its own if the repo wakes up for the 2027 cycle.
  - [zapplyjobs/New-Grad-Jobs-2027](https://github.com/zapplyjobs/New-Grad-Jobs-2027) — publishes no
    JSON, so this one parses the README's markdown tables
    ([`parseZapplyTable`](src/adapters/githublist.ts), pure + unit-tested against a fixture copied from
    the real file). Updated every ~10 minutes; ~600 rows, ~120 matching.
  - **Rejected:** [jobright-ai/Daily-H1B-Jobs-In-Tech](https://github.com/jobright-ai/Daily-H1B-Jobs-In-Tech).
    Its table parses fine and it flags explicit H-1B sponsorship, but the repo has been dead since
    2026-05-06 — ~1,300 rows, all months stale.
  - These rows have no JD we can fetch, so `sponsorship` stays `unknown` — except where the list itself
    states a disqualifier ("Does Not Offer Sponsorship", "U.S. Citizenship is Required"), which is
    passed through as a one-line description for the normal sponsorship classifier. `capExempt` is never
    set from a list: none of them publish it.
- **JobSpy adapter — the long tail.** Every source above is an employer's own ATS, which is precise and
  structurally blind to the employers that *have no ATS board*: the small and mid-size companies —
  most of Delaware — that only ever post to Indeed, ZipRecruiter or LinkedIn. This source covers them.
  [`scripts/jobspy_scrape.py`](scripts/jobspy_scrape.py) runs **before** the Node process (a separate,
  `continue-on-error` workflow step) using the open-source [python-jobspy](https://github.com/speedyapply/JobSpy)
  scraper over a fixed matrix — 5 search terms (`data analyst`, `business analyst`, `data engineer`,
  `software engineer`, `analytics`) × 5 locations (Wilmington DE, Newark DE, Philadelphia, NYC, and a
  nationwide remote sweep) × the enabled boards, `hours_old=72`, 50 results/query — and writes one JSON
  file. [`src/adapters/jobspy.ts`](src/adapters/jobspy.ts) reads that file from `$JOBSPY_FILE` and
  **never fails**: no file (the step was blocked, timed out, or you're running locally) means one log
  line, `[fetch] JobSpy: skipped (no file)`, and zero rows.
  - **It is out-of-process on purpose.** The scraper is ToS-gray and fragile, so the monitor must not be
    able to inherit its failure modes. Per-query `try`/`except`, a wall-clock budget
    (`JOBSPY_BUDGET_SEC`, 150s), and a `timeout-minutes` on the step.
  - **Which boards actually answer** (measured 2026-09-11): **Indeed** answered all 25 queries — 1,006
    rows, 526 unique, in **7.3s**. **ZipRecruiter** answered every query with Cloudflare `403` then
    `429` — 0 rows, from a residential IP. It stays configured (it costs ~2s and the block may be
    IP- or day-specific), and the summary line says plainly when a board returns nothing from every
    query. **On the GitHub runner the picture is the same, not worse**: Indeed 25/25 queries, 1,013 rows
    → 557 unique in **9.4s**; ZipRecruiter 0. That was the open question — datacenter IPs are blocked
    more readily than home ones — and for Indeed the answer today is no. **LinkedIn is off by default** — it rate-limits hard without residential proxies; enable it
    with the `JOBSPY_SITES` repo Variable if you ever have proxies.
  - Like the GitHub lists, one "source" is not one employer: every row names its own company and
    `Posting.via` carries the board ("Indeed"/"ZipRecruiter"). Rows arrive **with the full JD and a
    structured pay range**, so they take the no-detail-fetch enrichment path (same as Ashby/Lever) and
    feed the sponsorship scan and the LLM screen directly.
  - **What it actually adds** (dry run, 2026-09-11): of 526 scraped rows, **405 survived into the ranked
    output across 321 distinct employers**, 15 of them Delaware-area — CSC, Ryder, DXC, TD, Cigna, plus
    genuinely small shops (MBMS LLC, Cobbs Creek Healthcare) that no ATS config line would ever reach.
    That is the blind spot this source exists to cover.
  - **Staffing-agency noise is expected and deliberately not filtered.** An agency blocklist is
    unmaintainable and would cut real employers with it; the LLM stage is what judges fit. The one hard
    drop is a row with no employer name — useless for the sponsor lookup, the tracker row and dedup.
  - Nothing scraped is ever committed: the JSON lives in the runner's temp dir and dies with the runner.
- **Oracle Cloud CE adapter** — JPMorgan Chase (Wilmington DE hub, two CE sites), American Express and
  BNY, plus the **cap-exempt** hospitals Nemours Children's Health, Northwell Health and Mount Sinai.
- **PageUp adapter** — the one source type that needs a real browser. PageUp serves plain
  server-rendered HTML, but most of these sites front it with an AWS WAF challenge that answers a plain
  `fetch` with HTTP 202 and a JavaScript proof-of-work page; no header combination gets past it. So this
  adapter drives headless Chromium via Playwright, which CI installs with
  `npx playwright install --with-deps chromium`. All five are universities and therefore **cap-exempt**:
  University of Delaware, Drexel, Rowan, Seton Hall, Swarthmore. Parsing is a pure function
  ([`normalizePageUp`](src/adapters/pageup.ts)), so it is unit-tested without a browser.
  Note PageUp publishes no posting date (only a closing date), so these roles carry no age and bypass the
  recency filter — the `seen` state still guarantees one alert each.
- **PeopleAdmin adapter** — the dominant higher-ed ATS. Every instance publishes its entire open board as
  a public Atom feed at `/postings/search.atom`: no key, no pagination, an ISO `<published>` date the
  recency filter can read, and the full JD inline (so like Ashby/Lever these need no detail fetch).
  ~70 lines, all **cap-exempt**: Rutgers (886 roles), Villanova (345), Delaware Technical Community
  College (160), Hofstra (78), Fordham (64). Only Rutgers publishes `pa:city`/`pa:state`; the rest get
  their campus city from the source's `paLocation`.
- **H-1B filing history per employer** — the JD almost never says whether a company sponsors, so the
  monitor answers the question from **US government data instead of the JD**. `data/sponsors.json` is an
  offline index built from the [USCIS H-1B Employer Data Hub](https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub):
  **81,656 employers** with at least one approved H-1B petition in **FY2021–2023**, initial and continuing
  counts per year plus the top filing states, 4.2 MB. Every alertable posting's company is matched against
  it ([`src/sponsors.ts`](src/sponsors.ts)) and the alert carries a line like
  `🛂 H-1B: 804 initial approvals FY21–23` — or `🛂 no H-1B filings found FY21–23` when the absence is
  real evidence. On the 2026-09-11 dry run it spoke to **269 of 400** alertable employers.
  See [Where the H-1B data comes from](#where-the-h-1b-data-comes-from) for the matching rules and how to
  refresh the index.
- **Cap-exempt coverage** — **21 of the 111 sources are H-1B cap-exempt** (universities, university
  hospitals, nonprofit research orgs), the single most valuable property here because those petitions
  skip the lottery: University of Delaware, Delaware Tech, ChristianaCare, Nemours (DE) · Penn, Jefferson
  Health, CHOP, Drexel, Villanova, Swarthmore (Philadelphia) · Rutgers, Rowan, Seton Hall (NJ) · Mount
  Sinai, Montefiore, Memorial Sloan Kettering, Northwell, Fordham, Hofstra, Cornell, Simons Foundation
  (NY). `select.ts` ranks them second only to Delaware-local roles and the alert tags them
  "✅ cap-exempt — no H-1B lottery".
- **Location tiers** — alerts are ordered DE-local > cap-exempt > NYC metro > higher wage > fresher.
  Delaware is the top choice and gets a wider role filter (`LOCAL_FILTERS`, senior titles included); NYC
  is the second-choice metro and keeps the strict entry-level filter, so adding it widened the net
  without flooding the alerts. Cap-exempt deliberately outranks the NYC preference — skipping the H-1B
  lottery beats a preferred city. NYC-metro sources: Point72, MongoDB, Justworks, Zocdoc, Peloton, Jump
  Trading, Betterment, Alloy, BetterHelp, Squarespace, IMC, Cockroach Labs, Yext, Attentive, Klaviyo
  (Greenhouse) plus American Express and BNY (Oracle CE).
- **Remote-eligibility detection** — scans the JD for role-level remote phrasing, so a role tagged to an
  HQ city but actually remote still surfaces; foreign regions ("Remote, India", UK, …) are blocked.
- **LLM screening** — the keyword filter is now a deliberately *wide* pre-filter; Claude is the real
  filter. See [the section below](#the-llm-screen).
- **Role focus** — tuned for an MS-CS new grad on STEM OPT: software/data engineering and ML first, with
  data/business analyst as a fallback (see `includeKeywords` in [`src/config.ts`](src/config.ts)).
- **Geography: all US** by default (`allowLocations: []` → US-positive matching by state/abbrev/US/remote;
  foreign roles, including foreign-remote, are rejected). Re-narrow to Delaware by setting `allowLocations`
  back to the DE list in `config.ts`.
- **Delaware wide net** — roles physically in the DE/Philadelphia area get a broader filter (`LOCAL_FILTERS`:
  any software/data/analyst role, senior titles allowed) since DE is the top-choice location; everywhere
  else stays strict entry-level. Selection is by the role's location, not the company.
- **Visa-sponsorship scan** — for each match it fetches the full job description and flags roles that rule
  out F-1 sponsorship ("no sponsorship", "must be a US citizen", security clearance, …), and extracts the
  **salary**. The tracker row's `sponsors` field is set from this, so dead-ends are obvious at a glance —
  the single most useful feature for an international candidate.
- **Real-location resolution** — the listing endpoint returns opaque "2 Locations" labels; the detail fetch
  resolves the actual cities and the location filter is re-applied, so out-of-area multi-location roles
  (e.g. Richmond/McLean VA) are correctly dropped instead of slipping through.
- **Two runtime dependencies** — Playwright (for the one WAF-guarded source) and the Anthropic SDK.
  Everything else is native `fetch`: ATS, Telegram, Resend, and Supabase REST. (Explicitly no
  `supabase-js`: its client eagerly opens a realtime WebSocket that breaks under Node 20.)
- **Dedup** is a Supabase table (`monitor_seen_jobs`) so you never get the same alert twice. Within a
  run there are two axes: the `company:id` key, and the **normalized application URL**
  ([`normalizedUrlKey`](src/urlkey.ts) — host + path, minus `www`, tracking params, trailing slash and
  Workday's optional locale segment). The second exists for the community lists, which republish reqs a
  direct ATS adapter already returned under a different id and often a different company spelling.
  Direct sources are configured first and win the tie, because only they have a JD-detail path.
  **Known residual:** Zapply publishes `zapply.jobs/l/d/…` redirect links rather than the employer's
  ATS URL, so its rows can't be collapsed this way — 3 of 536 matches in the verification dry run were
  such duplicates (0.6%). SimplifyJobs publishes real ATS URLs and collapses correctly.
  **JobSpy rows collapse well** — Indeed publishes `job_url_direct`, the employer's own ATS link, on
  essentially every row (526/526 in the verification run), and the adapter prefers it over the
  `indeed.com/viewjob?jk=…` redirect for exactly this reason. The residual: a row whose direct link is
  missing keeps the Indeed URL and can't collapse against the same req from a direct adapter, and a
  board that publishes its *own* redirect (ZipRecruiter) would behave like Zapply does. The real
  residual seen in the verification run is a *vanity* direct link: JPMorgan advertises on Indeed as
  `JPMorganChase.contacthr.com/<id>` while our Oracle CE adapter returns the `jpmc.fa.oraclecloud.com`
  URL, so a handful of JPMC reqs appear twice. Resolving that needs a redirect-follow per row, which is
  exactly the per-posting fetch this source is designed to avoid. Because the
  identity of such a URL lives in a query param rather than the path, `normalizedUrlKey` keeps a tiny
  allow-list of identifying params (`jk`, `currentJobId`) while still dropping tracking ones — without
  that, every Indeed row in a run would normalize to `indeed.com/viewjob` and collapse into one.
- Pure logic (matching, prompt building, verdict parsing, sponsorship classification, remote detection,
  normalization, ranking) is unit-tested with Vitest (226 tests) — the API is mocked, so `npm test` makes
  no network calls — with defensive guards against malformed API records and malformed model output.

## The LLM screen

Three problems the regex pipeline could not solve, all of them the same problem: a title is not a role.

1. **New-grad roles were invisible.** `includeKeywords` needed substrings like "software engineer", so
   "Technology Development Program", "Early Career Rotational Program", "Graduate Engineer", "Applied
   Scientist", "Analytics Associate" and "2027 Analyst Program" never matched — exactly the roles a new
   grad should be applying to.
2. **The seniority excludes killed entry-level roles.** `senior`/`lead`/`staff` as whole-word excludes
   dropped Capital One's "Senior Associate" and bank "Associate" titles, which are early-career tiers.
3. **Sponsorship was "unknown" for ~80% of matches.** The regex only catches explicit *disqualifiers*;
   everything else came back "unknown", which meant reading every JD by hand.

So the filter moved. `FILTERS` in [`src/config.ts`](src/config.ts) is now a **wide pre-filter** — it adds
`engineer`, `analyst`, `scientist`, `researcher`, `associate`, `graduate`, `program`, `rotational`,
`early career`, `new grad`, `university`, and drops every seniority exclude (keeping only executive
titles, plus non-software engineering and clinical disciplines, which are cheaper to cut with a regex
than to pay a model to reject). [`src/llm.ts`](src/llm.ts) then sends title + location + JD to
**Claude Haiku 4.5** and gets back structured JSON via a strict tool call:

| field | values |
|---|---|
| `newGradFit` | `yes` / `maybe` / `no` — realistically open to a new MS grad with 0–2 yrs |
| `seniority` | `intern` / `new-grad` / `entry` / `mid` / `senior` / `exec` |
| `roleFamily` | `data-analyst` / `data-engineer` / `swe` / `ml` / `analyst-other` / `other` |
| `sponsorship` | `will-sponsor` / `no-sponsorship` / `silent`, with a short JD quote |
| `remoteUS` | boolean |
| `summary` | ≤20 words, shown in the alert |

On a live dry-run comparison the pre-filter went from **563** matches to **2517** (of ~22k fetched) —
that is the size of the blind spot, and the LLM is what makes the extra ~1950 safe to look at. The run
takes ~6m40s end to end, still inside the 15-min cron.

Roles the model marks `newGradFit: no` or `seniority` ≥ mid are dropped from alerts; the rest carry the
verdict into the Telegram/email meta line, and a `no-sponsorship` verdict sets the same `⛔` flag the
regex classifier sets. The LLM can only ever *add* a sponsorship flag — a regex-flagged role stays
flagged.

### Cost

Four things keep this well under **$1/day**:

- **Only new postings are classified.** The stage runs *after* the diff against `seen`, so the ~280
  roles that match every run cost nothing; only the 15–50 genuinely new ones are sent.
- **Verdicts are cached in Supabase** (`monitor_llm_verdicts`, see
  [`supabase/0003_llm_verdicts.sql`](supabase/0003_llm_verdicts.sql)) keyed by posting key, so re-runs,
  seeds, and roles that drop off a board and return are free.
- **The JD is truncated** to ~4k characters — seniority and sponsorship language lives near the top.
- **Hard ceilings**: `LLM_MAX_PER_RUN` (default 80) and `LLM_DRY_RUN_MAX` (default 15, since a dry run
  has no cache to amortize against). Postings past the ceiling are *deferred*, not dropped — they are
  held out of `seen` and come round again on the next run (~15 min), so a backlog drains over a few runs
  instead of being alerted unscreened and then forgotten.

At Haiku 4.5 rates ($1/MTok in, $5/MTok out) that works out to a **measured $0.0028 per role** (first CI
run: 80 roles, $0.2276). Steady state is ~140 genuinely-new roles a day, so **~$0.40/day**. Every run
prints its own spend: `[llm] classified N postings, ~$X …`.

> **One-time backlog.** Widening the pre-filter makes ~2000 already-open roles look new. At 80/run they
> drain over ~25 runs (about 6 hours of cron) for roughly **$5.60 once**. Raise `LLM_MAX_PER_RUN` to
> drain it faster, or `npm start -- --seed` to skip screening the backlog entirely.

### Without a key

`ANTHROPIC_API_KEY` is a GitHub repo secret and is normally *not* set locally. With no key the stage
no-ops entirely and the run behaves exactly as it did before, announcing itself through the existing
`checkEnv` degraded mechanism:

```
[env] ANTHROPIC_API_KEY — LLM classification off, regex fallback
```

The same fallback covers an API outage: classification is per-posting `try`/`catch` behind a bounded
worker pool with a timeout and retries on 429/529, and a posting with no verdict stays in the alert set.

## The daily apply queue

The monitor's failure mode was never recall — it was triage. Six firehose alerts a day and ~300 open
matches answer "what's new?", but not the only question that moves an application forward: **which five do
I apply to this morning?** [`.github/workflows/daily-digest.yml`](.github/workflows/daily-digest.yml)
answers it once a day, at **08:00 America/New_York**, as one Telegram checklist.

```
monitor run (every ~15 min)                  daily digest (08:00 ET)
  … rank → alert → tracker row                 read monitor_candidates  (pool)
        └→ snapshot to monitor_candidates      read monitor_digest      (already shown)
           (LLM verdict, sponsor history,      read applications        (already applied/rejected)
            salary, cap-exempt, first_seen)    → selectAlertable ordering → top 5
                                               → one Telegram checklist
                                               → record in monitor_digest
```

**It fetches nothing.** Every candidate was snapshotted by the monitor run that first found it, so the
whole job is three Supabase reads, a sort and one message — it finishes in seconds, and re-fetching 22k
postings at 08:00 would be both slow and pointless. The snapshot exists because the tracker row keeps
*none* of the ranking signal: no LLM verdict, no USCIS sponsor history, no cap-exempt flag.

**What gets picked** ([`src/digest.ts`](src/digest.ts), pure and unit-tested):

- LLM `newGradFit` must be **`yes`**. If fewer than `DIGEST_SIZE` of those exist, the queue reaches down to
  `maybe`, and only then to unclassified roles (which is what a run with no `ANTHROPIC_API_KEY` produces).
  A `no` never appears. The message says so when it had to reach.
- Sponsorship not ruled out — neither the JD regex scan (`sponsorship: "no"`) nor the LLM
  (`no-sponsorship`). Silence is fine; most JDs say nothing.
- Posted within `DIGEST_MAX_AGE_DAYS` (default **10**); unknown age passes, as everywhere else. Age is
  computed *today*, not at capture: Workday reports a relative "Posted 2 Days Ago", so `posted_days` is
  paired with `first_seen` and a role that sits in the pool ages out on schedule.
- **Not already shown** in an earlier digest (`monitor_digest`), and **not already acted on** — any tracker
  row past `Wishlist` (Applied, Screen, Interview, Offer, Accepted, Rejected), matched on the normalized
  application URL, which is what the monitor writes into `applications.link`.
- Ordering is the monitor's own `selectAlertable` (DE-local > cap-exempt > NYC > proven sponsor > wage >
  fresh), so the queue and the firehose never disagree about what "best" means.

Each entry is a checkbox with the company, title, location, the why-it-ranks tags (cap-exempt, DE/NYC,
🛂 H-1B filing history, wage hint, the LLM's one-line summary, age) and the apply link last. A one-line
footer counts the pool: `312 in pool · 41 new-grad-fit · 5 shown`.

```bash
npm run digest -- --dry-run   # print the message; send nothing, record nothing
npm run digest                # send it and record the picks
```

Tuning (repo Variables in CI, env vars locally): `DIGEST_SIZE` (default **5**), `DIGEST_MAX_AGE_DAYS`
(**10**), `DIGEST_POOL_DAYS` (**30** — how far back the candidate pool is read; wider than the age limit so
unknown-age roles stay reachable).

Two cron lines are declared (12:00 and 13:00 UTC) because GitHub cron has no DST; the job checks the real
New York hour and the wrong one exits immediately.

## Run it

```bash
npm install
npm run dry-run          # fetch + match + print matches — no secrets, no writes
npm test                 # unit tests
npm run typecheck
```

Configure targets and filters in [`src/config.ts`](src/config.ts).

### Flags & tuning
- `npm run dry-run` — fetch + match + enrich, print what *would* alert (no writes).
- `npm start -- --seed` — record everything currently open as "seen" without alerting. Run once after
  setup so your first real run only surfaces genuinely new roles.
- `SKIP_NO_SPONSORSHIP=true` — don't alert/add roles the JD flags as no-sponsorship (still recorded as seen).
- `LLM_MAX_PER_RUN` / `LLM_DRY_RUN_MAX` — ceilings on Claude calls per run (default **80** / **15**).
- `MAX_AGE_DAYS` — only consider roles posted within N days (default **14**; applied *before* the JD-detail
  fetches so the all-US volume stays cheap). Set higher for a one-time broad sweep.
- `npm run digest -- --dry-run` — print tomorrow's apply queue without sending or recording it.
- **JobSpy long tail** (optional, off unless you point it at a file):
  ```bash
  pip install -r scripts/jobspy-requirements.txt
  JOBSPY_OUT=/tmp/jobspy.json python scripts/jobspy_scrape.py   # ~8s when Indeed answers
  JOBSPY_FILE=/tmp/jobspy.json npm run dry-run                  # → "[fetch] JobSpy: N"
  ```
  Tuning (repo Variables in CI, env vars locally): `JOBSPY_SITES` (default `indeed,zip_recruiter`; add
  `linkedin` only with proxies), `JOBSPY_HOURS_OLD` (**72**), `JOBSPY_RESULTS` (**50**/query),
  `JOBSPY_BUDGET_SEC` (**150**), `JOBSPY_WORKERS` (**6**).
- `npm run build:sponsors` — rebuild `data/sponsors.json` from USCIS (network; never run inside the
  monitor). `-- --years 5` widens the fiscal-year window from the default 3.
- Edit keyword / location / exclude lists and the company list in [`src/config.ts`](src/config.ts).

## Going live

1. **State tables:** run [`supabase/0002_monitor.sql`](supabase/0002_monitor.sql),
   [`supabase/0003_llm_verdicts.sql`](supabase/0003_llm_verdicts.sql) and
   [`supabase/0004_digest.sql`](supabase/0004_digest.sql) in your Supabase SQL editor.
   Until `0003` is applied the run still works — it logs `[llm] verdict cache read/write failed` and
   simply re-pays for verdicts it can't cache. Until `0004` is applied the monitor also still works (it
   logs `[candidates] save failed`), but the daily queue has nothing to read and says exactly which file
   to paste.
2. **Secrets:** copy `.env.example` → `.env` and fill in (or set as GitHub repo secrets):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only — never commit), `TRACKER_USER_ID`
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (from @BotFather / @userinfobot)
   - `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` (optional email channel)
   - `ANTHROPIC_API_KEY` (optional — enables the LLM screen; without it the run falls back to regex)
3. **Run:** `node --env-file=.env node_modules/.bin/tsx src/index.ts` locally, or push and let
   [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) run it every ~15 min.
4. **Daily queue:** [`.github/workflows/daily-digest.yml`](.github/workflows/daily-digest.yml) needs the
   same Supabase + Telegram + `TRACKER_USER_ID` secrets and nothing else (no Playwright, no Anthropic key).
   Trigger it by hand from the Actions tab any time; tick **dry run** to see the message without sending.

## Where the H-1B data comes from

The single biggest manual step used to be: the JD says nothing about sponsorship, so look the employer up
by hand. This section is how that got automated.

### Source choice: USCIS, not DOL

| | [USCIS H-1B Employer Data Hub](https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub) | [DOL OFLC LCA disclosure](https://www.dol.gov/agencies/eta/foreign-labor/performance) |
|---|---|---|
| shape | one CSV per fiscal year, employer × city | quarterly Excel, one row per *case* |
| size | **2–4 MB/FY** (10 MB for the 3-FY window) | hundreds of MB per FY |
| says | petitions actually **approved** (initial + continuing), by employer/state/NAICS | an **intent** to file, with job title, SOC code and wage |
| verdict | **chosen** | not used |

An LCA is filed before (and often without) a petition — consultancies file them speculatively — so a Data
Hub row is the stronger claim *and* a hundredth of the bytes. The DOL files' one real advantage is the
per-SOC median wage, which would sharpen the wage-weighted-lottery hint; that is a follow-up, and it would
still have to be pre-aggregated offline. Denials are parsed but deliberately not shown: a denied petition
still proves the employer files, and approval *rates* on tiny samples mislead.

### Refreshing the index

```bash
npm run build:sponsors              # latest 3 fiscal years -> data/sponsors.json
npm run build:sponsors -- --years 5 # wider window
```

The available fiscal years are scraped from the USCIS download page rather than hardcoded, so a new FY is
picked up with no code change. [`.github/workflows/sponsor-data.yml`](.github/workflows/sponsor-data.yml)
does exactly this on the 1st of each month (and on manual dispatch), sanity-checks the employer count,
runs the tests and commits only if the file changed — USCIS publishes annually, so most months are a
no-op. **Never fetch this inside the monitor run:** the monitor only ever reads the committed JSON, and a
missing or corrupt index degrades to "no sponsor signal", never to a failed run.

### Matching an employer name

Company names in an ATS ("JPMorgan Chase") and in a federal filing ("JPMORGAN CHASE & CO") rarely agree,
so [`normalizeEmployer`](src/sponsors.ts) lowercases, strips punctuation and legal forms (`Inc`, `LLC`,
`& Co`, `Holdings`, `USA`…), glues possessives back together (`THE CHILDREN S HOSPITAL OF PHILADELPHIA` →
`childrens hospital philadelphia`) and merges runs of initials (`W.L. Gore` ↔ `WL GORE`, `M&T` ↔ `M T`).
Then:

1. **exact** on the normalized name — most matches land here.
2. **fuzzy**, prefix-anchored subset — the posting's name must be *contained in* the filing's, sharing the
   first token (`Capital One` → `CAPITAL ONE SERVICES LLC`). The alert prints the matched name in
   parentheses so a wrong guess is visible, not silent.

The guards, both from real misfires while building this:

- **The index name may add tokens, never drop one.** Allowing the reverse matched *Children's Hospital of
  Philadelphia* to Boston's *CHILDRENS HOSPITAL CORPORATION*.
- **A one-word company must be near-unambiguous** (≤3 filers share its token). `Comcast` →
  `COMCAST CABLE COMMUNICATIONS LLC` is safe; `Alloy` matches nothing rather than inherit *ALLOY STEEL
  INC*'s filings.
- **"No filings found" is only claimed as evidence.** Not for a cap-exempt employer (its petitions skip
  the lottery anyway, and universities file under legal names like *THOMAS JEFFERSON UNIVERSITY*), not for
  a one-word name, and not for a *near miss* — if the index holds other employers sharing the first token
  (`CapTech Consulting` vs `CAPTECH VENTURES INC`) the honest answer is "we couldn't place it", so the
  line is omitted entirely.

### How it changes the alerts

Ordering in [`src/select.ts`](src/select.ts) becomes **flagged-no-sponsorship last · DE-local ·
cap-exempt · NYC metro · employer with H-1B approvals on file · higher wage · fresher**. Cap-exempt
employers are exempt from the new tier — a thin cap-subject filing history says nothing about an employer
whose petitions skip the lottery. Each run logs `[sponsor] matched N/M alertable employers`.

## Caveats (honest)

- Workday's CXS endpoint is **unofficial** — the adapter is isolated and a failing source is logged, not
  fatal. Tests guard the parser against shape changes.
- **Coverage is the configured companies plus the JobSpy long tail** — it's a focused monitor with one
  aggregator bolted on, not a universal scraper. Add companies by editing `src/config.ts`.
- **The JobSpy source is the fragile one, by design.** It scrapes aggregator boards, which is ToS-gray,
  breaks when their HTML changes, and gets blocked — ZipRecruiter blocked every request from a home IP
  on day one, and a GitHub runner's datacenter IP is blocked more readily than a home one, so expect
  fewer rows in CI than locally. Treat any number it returns as a bonus: the step is
  `continue-on-error`, the library version is pinned in `scripts/jobspy-requirements.txt`, and a run
  where it produces nothing is a normal run. Rows also skew toward staffing agencies and reposts —
  that is what the LLM screen is for.
- GitHub Actions cron is best-effort (can lag a few minutes). Fine for this purpose.
- **The sponsor index lags.** USCIS published FY2023 last; a company that only started sponsoring in
  FY2024–25 shows as "no filings found" until the next export lands. It is also keyed on the *petitioning
  legal entity*, so a brand that files through a parent or a PEO can be missed — which is exactly why an
  unmatched name is never reported as "does not sponsor".
