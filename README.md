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
  with no server HTML or feed; see [`src/adapters/icims.ts`](src/adapters/icims.ts).)
- **Greenhouse + Lever adapters** — clean public board APIs. Add remote-friendly tech sponsors not on
  Workday: Affirm, Reddit, Robinhood, Datadog, Databricks, GitLab, Stripe, Airbnb, Lyft, Instacart,
  Pinterest, Dropbox, Twilio, Figma, Discord, SoFi, Chime, Asana (Greenhouse) and Spotify (Lever).
  **~92 companies across 7 ATS platforms** — each returns its complete list every run, so dedup catches
  every new posting. Adding another is one config line.
- **Ashby adapter** — the best-shaped source here: one unauthenticated call returns the whole board
  *including* the plain-text JD and a parsed pay range, so these roles need no per-role detail fetch
  (same enrichment path as Lever). Ramp (NYC HQ), Harvey, Decagon, Warp, OpenAI, Notion, Cursor,
  Perplexity, ElevenLabs, Sierra, Vanta, Linear.
- **SmartRecruiters adapter** — public REST API, no key. These are global boards, so the adapter asks
  for `country=us` server-side (Experian: 434 roles worldwide, 37 in the US) and pages by offset.
  Experian, NielsenIQ, Bosch.
- **Oracle Cloud CE adapter** — JPMorgan Chase (Wilmington DE hub, two CE sites) and Nemours Children's
  Health. Nemours is **cap-exempt**, so its roles skip the H-1B lottery and rank top.
- **PageUp adapter** (University of Delaware) — the one source that needs a real browser. PageUp serves
  plain server-rendered HTML, but UD fronts it with an AWS WAF challenge that answers a plain `fetch`
  with HTTP 202 and a JavaScript proof-of-work page; no header combination gets past it. So this adapter
  drives headless Chromium via Playwright, which CI installs with
  `npx playwright install --with-deps chromium`. UD is a university and therefore **cap-exempt** — the
  highest-value source here for the lottery problem. Parsing is a pure function
  ([`normalizePageUp`](src/adapters/pageup.ts)), so it is unit-tested without a browser.
  Note UD publishes no posting date (only a closing date), so its roles carry no age and bypass the
  recency filter — the `seen` state still guarantees one alert each.
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
- **Dedup** is a Supabase table (`monitor_seen_jobs`) so you never get the same alert twice.
- Pure logic (matching, sponsorship classification, remote detection, normalization, ranking) is
  unit-tested with Vitest (32 tests), with defensive guards against malformed API records.

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
