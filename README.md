# Job-Opening Monitor

A scheduled pipeline that watches target employers' career systems, detects **new** roles matching my
filters within minutes, and alerts me on **Telegram + email**. Built as the top-of-funnel automation for
my [job tracker](../job-application-tracker) — being among the first applicants matters when you're job
hunting on an OPT clock. A second, **daily** job turns that stream into a five-item **apply queue** at
08:00 ET and writes *those* five into the tracker's Wishlist — see
[The daily apply queue](#the-daily-apply-queue).

![stack](https://img.shields.io/badge/stack-Node%20%2B%20TypeScript-2f5bea) ![deps](https://img.shields.io/badge/runtime%20deps-4-1a9d6a) ![schedule](https://img.shields.io/badge/runs-GitHub%20Actions%20cron-697586)

## How it works

```
config (companies + filters)
   → adapters (Workday/Greenhouse/Lever/    extract
     Oracle CE APIs + PageUp via browser
     + JobSpy long tail, scraped first
     + job-alert emails read over IMAP)
   → match (wide keyword + location net)    pre-filter
   → JD scan (sponsorship + salary)         enrich
   → diff vs. seen (Supabase)               dedup
   → USCIS H-1B filings per employer        cross-reference
     (data/sponsors.json, offline index)
   → "worth classifying?" gate              gate
   → LLM screen (Claude Haiku 4.5,          classify
     cached in Supabase, gated roles only)
   → rank + Telegram + email                load
   → candidate snapshot (digest pool)
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
  **111 sources across 9 ATS platforms**, plus three community job lists, the JobSpy long-tail
  scraper and the job-alert inbox — each returns its complete list every run, so dedup catches
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
- **Email-alert adapter — the boards that can't be read at all.** Handshake needs school SSO;
  LinkedIn, ZipRecruiter, Glassdoor and part of Indeed sit behind Cloudflare, a WAF or hard rate
  limits. None of that gets bypassed here — no proxy rotation, no CAPTCHA solving, no automated SSO
  login. But **every one of those sites will push its matches to an inbox** if you save a search with
  email alerts turned on, so [`src/adapters/emailalerts.ts`](src/adapters/emailalerts.ts) reads those
  alert emails over IMAP instead. For Handshake's inventory this is the only viable route at all, and
  it is structurally robust: no bot detection is involved, and a site redesigning its search UI
  doesn't break it. **Ray has to set the saved searches up first** — see
  [Turning the email-alert source on](#turning-the-email-alert-source-on).
  - **Read-only, always.** The mailbox is opened with `{ readOnly: true }`: nothing is ever marked as
    read, no flag is touched, nothing is deleted. The adapter only ever *reads* the last
    `ALERT_INBOX_DAYS` (default 3) days, caps the messages it processes (200), wraps every message in
    its own `try`/`catch` and holds a wall-clock budget (90s) so a slow inbox can't stall the cron.
  - **It parses links, not layout.** These templates are regenerated constantly, so nothing pins an
    HTML structure: the parser pulls *every* anchor out of the mail, keeps the ones whose URL shape
    says "job posting", and takes the anchor text as the title. The shape table is one row per board
    and is the intended extension point:

    | source | URL shapes matched | job id |
    |---|---|---|
    | Handshake | `joinhandshake.com/…/jobs/{id}` (incl. `app.` / `{school}.` hosts, `/stu/`, `/emp/`) | path |
    | LinkedIn | `linkedin.com/comm/jobs/view/{id}`, `linkedin.com/jobs/view/{slug-id}` | path tail (or `?currentJobId=`) |
    | Indeed | `indeed.com/rc/clk`, `/viewjob`, `/m/viewjob`, `/pagead/clk`, `/job/…` | `?jk=` (sponsored rows have none → hashed URL) |
    | ZipRecruiter | `ziprecruiter.com/jobs/…`, `/c/…`, `/k/…` | `?jid=`/`?lvk=`, else hashed URL |
    | Glassdoor | `glassdoor.com/job-listing/…`, `/partner/jobListing.htm` | `?jobListingId=`/`?jl=`, else hashed URL |

    Tracking wrappers are unwrapped first — both the `?url=`/`?targetUrl=`/`?redirect=` kind and the
    SendGrid kind that hides the destination percent-encoded in its *path* — and per-send tracking
    params are stripped, so two sends of the same job produce the same URL and the same key. An
    `/rc/clk` link is rewritten to the canonical `/viewjob?jk=`, and LinkedIn's email-only `/comm/`
    prefix is dropped, so an alert row still collapses against the same req from another source.
    Unsubscribe / settings / "see all jobs" links and logo anchors with no text are dropped.
  - **Company and location are read from the text around the anchor** — nearly always
    "Company · City, ST" right after the title link, or the same pair on consecutive lines. The parser
    drops the chrome ("Promoted", "Easy Apply", "3 days ago", the pay line), takes the first fragment
    that reads like a place, and the fragment before it as the employer; a multi-location row keeps
    every city. Where a card puts the employer *above* the title (Glassdoor) it looks backwards, but
    only within the same table cell — inheriting the previous card's employer would be much worse than
    having none. **When it genuinely can't tell, `company` becomes the alert source** ("Handshake")
    rather than a guess, because the USCIS sponsor lookup, the tracker row and dedup all key on that
    name. The title always survives, and the LLM screen works from title + location alone.
  - **No JD exists** in an alert email, so `description` is left unset, `sponsorship` stays "unknown",
    and these rows take no detail fetch. `buildUserPrompt` has an explicit "judge from the title and
    location alone" branch for exactly this case (unit-tested).
  - **Unset = skipped.** With no `ALERT_INBOX_USER`/`ALERT_INBOX_APP_PASSWORD` — the local dry run, and
    CI until the secrets exist — the source logs `[fetch] Email alerts: skipped (no inbox configured)`
    and returns zero rows. An unreachable server, a rejected password or a blown time budget are
    logged and degrade to zero rows too: this adapter has no throw path.
  - ⚠️ **The parsers are best-effort until they have been run against real alerts.** They were written
    against each board's public URL formats and its known template shape, not against captured sends,
    and the test fixtures are *synthesized* (the test file says so at the top). `npm run alerts --
    --dump` is how they get corrected — see [Flags & tuning](#flags--tuning).
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
- **Four runtime dependencies** — Playwright (for the one WAF-guarded source), the Anthropic SDK, and
  `imapflow` + `mailparser` (the job-alert inbox: an IMAP client and a MIME parser, both maintained by
  the Nodemailer project; hand-rolling quoted-printable/base64/charset handling for mail we can't test
  against is not a saving). Everything else is native `fetch`: ATS, Telegram, Resend, and Supabase
  REST. (Explicitly no `supabase-js`: its client eagerly opens a realtime WebSocket that breaks under
  Node 20.)
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
  normalization, ranking, alert-email parsing) is unit-tested with Vitest (308 tests) — the API is
  mocked and no IMAP connection is opened, so `npm test` makes no network calls — with defensive
  guards against malformed API records, malformed model output and malformed email HTML.

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

### The "worth classifying" gate — the cost lever

`src/screen.ts`. **Only postings that could plausibly reach the daily queue are sent to the model.** A
posting is worth a call when, and only when:

> it is **DE-local** · **or** its employer is **cap-exempt** · **or** it is **NYC-metro** · **or** it
> is **remote-US** — **and** the JD has not already ruled sponsorship out.

USCIS filing history is deliberately **not** a reason on its own, though the first version made it one.
It reads like the strongest reason there is — a proven sponsor is exactly who Ray needs — but it fails
as a *filter* here, because the source list was built out of big sponsors: measured on a real run
(2026-09-16) it alone admitted **1,300 of 2,667** matches and left the gate keeping 77%, which is not a
cost lever at all. It stays where it earns its keep: a ranking tier in `selectAlertable` and a line in
the alert.

Everything in that rule is computed before the stage runs (`isDelaware`/`isNycMetro` in
[`rank.ts`](src/rank.ts), `capExempt` from the source config, the remote flag from the adapter or
[`remote.ts`](src/remote.ts)), so
the gate costs nothing — which is the point, since it is **the same list `selectAlertable` ranks on**.
That is what makes the cut safe rather than arbitrary: a role that fails the gate fails *every*
ordering tier, so no verdict could have lifted it above a single Delaware, cap-exempt, NYC or
proven-sponsor role, and it can never reach the five-role morning queue. The last clause is the same
argument in reverse — `applyVerdict` can only ever *add* a "no", so paying to read a JD that already
says "no sponsorship" cannot change one decision.

Gated-out roles are **not dropped**: they stay in the alerts, regex-judged exactly as they were before
the LLM stage existed, and they sort below the screened ones. Every run prints the split and the
reasons:

```
[gate] 2053/2667 worth classifying (de-local 131, cap-exempt 116, nyc-metro 503, remote-us 3) — the other 614 stay regex-judged.
```

The classification queue is ordered by `selectAlertable` **before** the gate and the ceiling are
applied, so if a ceiling ever does bite, it bites the least valuable roles.

### Cost

Five things hold the spend down:

- **The gate above** — the big one. Without it, 200–350 new roles a run were being classified at
  $0.52–$0.97 each run, i.e. **$3–6/day** against a $0.40/day design target (measured 2026-09-16; that
  is what exhausted the API credit). Over a full dry run the gate keeps **~28%** of matches, so expect
  roughly a quarter of the previous spend. *This figure is measured over all matches, not over the
  new-postings slice the stage actually bills for — check a real run's `[gate]` and `[llm]` lines and
  correct this line rather than trusting it.*
- **Only new postings are classified.** The stage runs *after* the diff against `seen`, so the ~2,900
  roles that match every run cost nothing.
- **Verdicts are cached in Supabase** (`monitor_llm_verdicts`, see
  [`supabase/0003_llm_verdicts.sql`](supabase/0003_llm_verdicts.sql)) keyed by posting key, so re-runs,
  seeds, and roles that drop off a board and return are free. The cache is applied to **every** posting,
  including gated-out ones: a verdict already bought is free to reuse.
- **The JD is truncated** to ~4k characters — seniority and sponsorship language lives near the top.
- **Hard ceilings**: `LLM_MAX_PER_RUN` (default **80**) and `LLM_DRY_RUN_MAX` (default 15, since a dry
  run has no cache to amortize against). Postings past the ceiling are *deferred*, not dropped — they
  are held out of `seen` and come round again on the next run, so a backlog drains over a few runs
  instead of being alerted unscreened and then forgotten.

At Haiku 4.5 rates ($1/MTok in, $5/MTok out) a verdict is a **measured $0.0028**. Every run prints its
own spend: `[llm] classified N postings, ~$X (C from cache, F failed, D deferred, S gated out)`.

> ⚠️ **Delete the `LLM_MAX_PER_RUN` repo Variable if it still exists.** It was set to `400` on
> 2026-09-12 to drain a one-time backlog that is long since drained, and left in place it silently
> overrides the 80 default — a licence to spend 5x the budget on a busy run.
> `gh variable delete LLM_MAX_PER_RUN` (or Settings → Secrets and variables → Actions → Variables).

### Without a key, and when the API fails

`ANTHROPIC_API_KEY` is a GitHub repo secret and is normally *not* set locally. With no key the stage
no-ops entirely and the run behaves exactly as it did before, announcing itself through the existing
`checkEnv` degraded mechanism:

```
[env] ANTHROPIC_API_KEY — LLM classification off, regex fallback
```

A configured-but-failing API is a **different** case, and it **fails closed**. A posting whose call
failed was never screened, so alerting it as though it had passed the screen is exactly the quality
degradation the stage exists to prevent — and marking it `seen` at the same time would burn it
permanently. So a failed posting is **held back**: out of the alerts, out of `seen`, retried on the next
run. On top of that:

- **A credit-exhausted account stops the run's classifications.** The API answers
  `400 invalid_request_error … Your credit balance is too low` identically for every call, so after
  `CREDIT_ERROR_LIMIT` (3) of them the stage abandons the rest of the batch instead of making 350 doomed
  calls and writing 350 identical log lines (which is what the 2026-09-16 runs did). Transient 429/529
  are deliberately *not* treated this way — they keep the SDK's existing retry behaviour.
- **The run says so, on Telegram, and still succeeds:**
  ```
  ⚠️ LLM classification unavailable (credit/API error) — 82 role(s) held back, alerts are regex-only
  this run. Top up the Anthropic credit to resume screening.
  ```
  Non-fatal on purpose: the run did its job for everything not held back, and failing the workflow would
  fire the "run FAILED" alarm for a billing problem.

## The daily apply queue

The monitor's failure mode was never recall — it was triage. Six firehose alerts a day and ~300 open
matches answer "what's new?", but not the only question that moves an application forward: **which five do
I apply to this morning?** [`.github/workflows/daily-digest.yml`](.github/workflows/daily-digest.yml)
answers it once a day, at **08:00 America/New_York**, as one Telegram checklist.

```
monitor run (every ~15 min)                  daily digest (08:00 ET)
  … rank → alert                               read monitor_candidates  (pool)
        └→ snapshot to monitor_candidates      read monitor_digest      (already shown)
           (LLM verdict, sponsor history,      read applications        (already applied/rejected)
            salary, cap-exempt, first_seen)    → selectAlertable ordering → top 5
                                               → one Telegram checklist
                                               → record in monitor_digest
                                               → 5 tracker rows (Wishlist)
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
- **Job-alert inbox** (optional, off unless `ALERT_INBOX_USER` + `ALERT_INBOX_APP_PASSWORD` are set):
  ```bash
  npm run alerts              # list recent alert emails + the job links each one yielded
  npm run alerts -- --dump    # …and write every message that yielded ZERO links to disk
  ```
  This is the diagnostic that turns the best-effort parsers into real ones. It connects read-only,
  prints each message's sender / subject / date and its link count, then writes any message that
  produced **no** links to `$ALERT_DUMP_DIR` (default: a `job-alert-dumps` folder in the system temp
  dir) and names the senders involved. A zero-link message is either not a job alert at all or a
  template whose URL shape is missing from `JOB_URL_SHAPES` in
  [`src/adapters/emailalerts.ts`](src/adapters/emailalerts.ts) — read the dumped HTML, add a row to
  that table, and add a fixture to `test/emailalerts.test.ts`.
  Tuning: `ALERT_INBOX_HOST` (**imap.gmail.com**), `ALERT_INBOX_PORT` (**993**), `ALERT_INBOX_MAILBOX`
  (**INBOX**), `ALERT_INBOX_DAYS` (**3**), `ALERT_INBOX_MAX_MESSAGES` (**200**),
  `ALERT_INBOX_BUDGET_SEC` (**90**).
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
   - `ALERT_INBOX_USER` + `ALERT_INBOX_APP_PASSWORD` (optional — turns the Handshake / LinkedIn /
     ZipRecruiter / Glassdoor email-alert source on; see the checklist below)
3. **Run:** `node --env-file=.env node_modules/.bin/tsx src/index.ts` locally, or push and let
   [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) run it every ~15 min.
4. **Daily queue:** [`.github/workflows/daily-digest.yml`](.github/workflows/daily-digest.yml) needs the
   same Supabase + Telegram + `TRACKER_USER_ID` secrets and nothing else (no Playwright, no Anthropic key).
   Trigger it by hand from the Actions tab any time; tick **dry run** to see the message without sending.

## Turning the email-alert source on

The adapter is live and inert: until the alerts exist it logs one skip line every run. Everything
below is manual and one-time — the code cannot do any of it, because each step needs Ray's own
logged-in session.

1. **Make a dedicated inbox.** A Gmail address used for nothing else (e.g. `<you>+jobalerts@gmail.com`
   is *not* enough — use a separate account, so a parser bug or a leaked app password can't reach
   personal mail, and so `ALERT_INBOX_DAYS` isn't competing with hundreds of unrelated messages).
2. **Create the app password.** In that account: turn on 2-Step Verification, then
   <https://myaccount.google.com/apppasswords> → create one → copy the 16 characters **without the
   spaces**. Make sure IMAP is enabled (Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP).
3. **Save a search with email alerts on each board**, signed in as Ray, sending to that inbox.
   Suggested searches — mirror the monitor's own targeting, and prefer **daily** over "as it happens"
   for the noisy boards:
   - **Handshake** (`app.joinhandshake.com` → Jobs → filter → **Save search** → alerts on): *Data
     Analyst*, *Data Scientist*, *Business Analyst*, *Software Engineer*; Job type **Full-Time**,
     Work authorization **"Will sponsor"** where offered; locations Delaware, Philadelphia PA,
     New York NY, plus one Remote/US search. This is the one board with no other route in.
   - **LinkedIn** (run the search → **Create job alert**): same four titles × {Delaware, Philadelphia,
     New York metro, United States (Remote)}, Experience level **Entry level / Associate**, Date
     posted **Past week**.
   - **Indeed** (search → *Get new jobs for this search by email*), **ZipRecruiter** (search → email
     alerts), **Glassdoor** (search → **Create job alert**): same titles, Wilmington DE / Philadelphia
     PA / New York NY / Remote.
4. **Forward nothing else into that inbox.** Non-alert mail is harmless (it yields zero links), but it
   eats the 200-message cap.
5. **Add the two GitHub secrets** (Settings → Secrets and variables → Actions → New repository
   secret): `ALERT_INBOX_USER` = the inbox address, `ALERT_INBOX_APP_PASSWORD` = the app password.
   Optionally set `ALERT_INBOX_MAILBOX` / `ALERT_INBOX_DAYS` as repo **Variables**.
6. **Verify, and fix what didn't parse.** Put the same two values in your local `.env`, wait for the
   first alerts to land, then run `npm run alerts -- --dump`. Every message should report a non-zero
   link count with a sane company and location; anything reporting **0** gets dumped to disk so the
   URL-shape table or the company/location heuristics can be corrected against the real template.
   Until that pass happens, treat this source's parsers as best-effort.

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
- **The email-alert parsers have not met a real email yet.** They were written against each board's
  public URL formats and its documented template shape, and every test fixture is synthesized. The URL
  matching is the robust half (a job URL's shape changes far more slowly than a mail template); the
  company/location derivation is the fragile half, and its failure mode is deliberately a *vague*
  answer (`company: "Handshake"`) rather than a wrong one. `npm run alerts -- --dump` exists to close
  that gap the moment real alerts start arriving.
- **This source depends on saved searches Ray owns.** If a board disables an alert for inactivity, or
  the alerts land in spam, the source silently returns fewer rows — the run log's
  `[alerts] … N message(s) → M job link(s)` line is the only tell. Nothing here can recreate them.
- GitHub Actions cron is best-effort (can lag a few minutes). Fine for this purpose.
- **The sponsor index lags.** USCIS published FY2023 last; a company that only started sponsoring in
  FY2024–25 shows as "no filings found" until the next export lands. It is also keyed on the *petitioning
  legal entity*, so a brand that files through a parent or a PEO can be missed — which is exactly why an
  unmatched name is never reported as "does not sponsor".
