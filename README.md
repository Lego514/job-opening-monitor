# Job-Opening Monitor

A scheduled pipeline that watches target employers' career systems, detects **new** roles matching my
filters within minutes, alerts me on **Telegram + email**, and **auto-adds** them to my
[job tracker](../job-application-tracker)'s Wishlist. Built as the top-of-funnel automation for the tracker —
being among the first applicants matters when you're job hunting on an OPT clock.

![stack](https://img.shields.io/badge/stack-Node%20%2B%20TypeScript-2f5bea) ![deps](https://img.shields.io/badge/runtime%20deps-0-1a9d6a) ![schedule](https://img.shields.io/badge/runs-GitHub%20Actions%20cron-697586)

## How it works

```
config (companies + filters)
   → adapters (Workday/Greenhouse/Lever/    extract
     Oracle CE APIs + PageUp via browser)
   → match (keywords + location)            filter
   → JD scan (sponsorship + salary)         enrich
   → diff vs. seen (Supabase)               dedup
   → Telegram + email + tracker row         load
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
  **111 sources across 9 ATS platforms**, plus three community job lists — each returns its complete list every run, so dedup catches
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
- **Zero runtime dependencies** — native `fetch` for the ATS, Telegram, Resend, and Supabase REST. (No
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
- Pure logic (matching, sponsorship classification, remote detection, normalization, ranking) is
  unit-tested with Vitest (123 tests), with defensive guards against malformed API records.

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
- `MAX_AGE_DAYS` — only consider roles posted within N days (default **14**; applied *before* the JD-detail
  fetches so the all-US volume stays cheap). Set higher for a one-time broad sweep.
- Edit keyword / location / exclude lists and the company list in [`src/config.ts`](src/config.ts).

## Going live

1. **State table:** run [`supabase/0002_monitor.sql`](supabase/0002_monitor.sql) in your Supabase SQL editor.
2. **Secrets:** copy `.env.example` → `.env` and fill in (or set as GitHub repo secrets):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only — never commit), `TRACKER_USER_ID`
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (from @BotFather / @userinfobot)
   - `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` (optional email channel)
3. **Run:** `node --env-file=.env node_modules/.bin/tsx src/index.ts` locally, or push and let
   [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) run it every ~15 min.

## Caveats (honest)

- Workday's CXS endpoint is **unofficial** — the adapter is isolated and a failing source is logged, not
  fatal. Tests guard the parser against shape changes.
- **Coverage is the configured companies only** — it's a focused monitor, not a universal scraper. Add
  companies by editing `src/config.ts`.
- GitHub Actions cron is best-effort (can lag a few minutes). Fine for this purpose.
