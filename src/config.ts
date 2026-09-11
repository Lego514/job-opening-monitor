import { type CompanySource } from "./types";

// Target employers. Add more by appending here — Workday tenants are easy to
// find (the careers URL is `{tenant}.{wd}.myworkdayjobs.com/{site}`).
export const COMPANIES: CompanySource[] = [
  // Workday employers — one adapter covers all. Delaware-relevant pharma / finance / chem.
  { name: "AstraZeneca", ats: "workday", tenant: "astrazeneca", wd: "wd3", site: "Careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Capital One", ats: "workday", tenant: "capitalone", wd: "wd12", site: "Capital_One", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "ChristianaCare", ats: "workday", tenant: "christianacare", wd: "wd5", site: "CCHS", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "DuPont", ats: "workday", tenant: "dupont", wd: "wd5", site: "Jobs", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  { name: "WSFS Bank", ats: "workday", tenant: "wsfsbank", wd: "wd1", site: "wsfscareers", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "M&T Bank", ats: "workday", tenant: "mtb", wd: "wd5", site: "MTB", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "Barclays", ats: "workday", tenant: "barclays", wd: "wd3", site: "external_career_site_barclays", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Citi", ats: "workday", tenant: "citi", wd: "wd5", site: "2", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Vanguard", ats: "workday", tenant: "vanguard", wd: "wd5", site: "vanguard_external", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  // wd5 started returning 410 (tenant moved datacenters) — now wd115.
  { name: "Comcast", ats: "workday", tenant: "comcast", wd: "wd115", site: "Comcast_Careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Corteva", ats: "workday", tenant: "corteva", wd: "wd5", site: "Corteva", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  // More Delaware-local employers (Wilmington / Newark HQ) — incl. smaller ones.
  { name: "Solenis", ats: "workday", tenant: "solenis", wd: "wd1", site: "Solenis", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  { name: "W.L. Gore", ats: "workday", tenant: "johngore", wd: "wd1", site: "Careers", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  { name: "Navient", ats: "workday", tenant: "navient", wd: "wd1", site: "Navient_Jobs", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  // Big visa sponsors (tech + pharma) — strong for remote / sponsorship-seeking candidates.
  { name: "NVIDIA", ats: "workday", tenant: "nvidia", wd: "wd5", site: "NVIDIAExternalCareerSite", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Salesforce", ats: "workday", tenant: "salesforce", wd: "wd12", site: "External_Career_Site", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Adobe", ats: "workday", tenant: "adobe", wd: "wd5", site: "external_experienced", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Pfizer", ats: "workday", tenant: "pfizer", wd: "wd1", site: "PfizerCareers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "GSK", ats: "workday", tenant: "gsk", wd: "wd5", site: "GSKCareers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Cisco", ats: "workday", tenant: "cisco", wd: "wd5", site: "Cisco_Careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "PayPal", ats: "workday", tenant: "paypal", wd: "wd1", site: "jobs", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Workday Inc", ats: "workday", tenant: "workday", wd: "wd5", site: "Workday", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Found by grepping each careers page for an ATS hostname rather than guessing
  // a tenant — the method the backlog now mandates.
  { name: "S&P Global", ats: "workday", tenant: "spgi", wd: "wd5", site: "spgi_careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Nasdaq", ats: "workday", tenant: "nasdaq", wd: "wd1", site: "global_external_site", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Guardian Life", ats: "workday", tenant: "guardianlife", wd: "wd5", site: "guardian-life-careers", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  // Greenhouse employers (remote-friendly tech, strong sponsors) — different adapter, clean public API.
  { name: "Affirm", ats: "greenhouse", ghToken: "affirm", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Reddit", ats: "greenhouse", ghToken: "reddit", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Robinhood", ats: "greenhouse", ghToken: "robinhood", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Datadog", ats: "greenhouse", ghToken: "datadog", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Databricks", ats: "greenhouse", ghToken: "databricks", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "GitLab", ats: "greenhouse", ghToken: "gitlab", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Stripe", ats: "greenhouse", ghToken: "stripe", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Airbnb", ats: "greenhouse", ghToken: "airbnb", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Lyft", ats: "greenhouse", ghToken: "lyft", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Instacart", ats: "greenhouse", ghToken: "instacart", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Pinterest", ats: "greenhouse", ghToken: "pinterest", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Dropbox", ats: "greenhouse", ghToken: "dropbox", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Twilio", ats: "greenhouse", ghToken: "twilio", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Asana", ats: "greenhouse", ghToken: "asana", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Figma", ats: "greenhouse", ghToken: "figma", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Chime", ats: "greenhouse", ghToken: "chime", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Discord", ats: "greenhouse", ghToken: "discord", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "SoFi", ats: "greenhouse", ghToken: "sofi", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // More high-sponsor tech (large new-grad / H-1B volume).
  { name: "Roblox", ats: "greenhouse", ghToken: "roblox", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Anthropic", ats: "greenhouse", ghToken: "anthropic", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Samsara", ats: "greenhouse", ghToken: "samsara", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Scale AI", ats: "greenhouse", ghToken: "scaleai", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Brex", ats: "greenhouse", ghToken: "brex", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Fivetran", ats: "greenhouse", ghToken: "fivetran", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Thoughtworks", ats: "greenhouse", ghToken: "thoughtworks", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Gusto", ats: "greenhouse", ghToken: "gusto", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Faire", ats: "greenhouse", ghToken: "faire", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Carta", ats: "greenhouse", ghToken: "carta", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Checkr", ats: "greenhouse", ghToken: "checkr", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Airtable", ats: "greenhouse", ghToken: "airtable", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // NYC-metro employers (second-choice location). Every token below was probed
  // against the live board before being added — see the backlog's note on not
  // guessing ATS ids. Counts are NYC-metro roles at the time of adding.
  { name: "Point72", ats: "greenhouse", ghToken: "point72", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "MongoDB", ats: "greenhouse", ghToken: "mongodb", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Justworks", ats: "greenhouse", ghToken: "justworks", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Zocdoc", ats: "greenhouse", ghToken: "zocdoc", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Peloton", ats: "greenhouse", ghToken: "peloton", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Jump Trading", ats: "greenhouse", ghToken: "jumptrading", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Betterment", ats: "greenhouse", ghToken: "betterment", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Alloy", ats: "greenhouse", ghToken: "alloy", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "BetterHelp", ats: "greenhouse", ghToken: "betterhelp", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Squarespace", ats: "greenhouse", ghToken: "squarespace", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "IMC Trading", ats: "greenhouse", ghToken: "imc", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Cockroach Labs", ats: "greenhouse", ghToken: "cockroachlabs", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Yext", ats: "greenhouse", ghToken: "yext", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Attentive", ats: "greenhouse", ghToken: "attentive", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Klaviyo", ats: "greenhouse", ghToken: "klaviyo", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Ashby employers. The best-shaped source here: one call returns the board
  // WITH the plain-text JD and a parsed pay range, so these need no detail
  // fetch. Ramp and Harvey are NYC-heavy; the rest are strong sponsors.
  { name: "Ramp", ats: "ashby", ashbyToken: "ramp", everifyGuess: "Yes", sponsorsGuess: "Yes" },  // 109 NYC
  { name: "Harvey", ats: "ashby", ashbyToken: "harvey", everifyGuess: "Yes", sponsorsGuess: "Yes" },  // 92 NYC
  { name: "Decagon", ats: "ashby", ashbyToken: "decagon", everifyGuess: "Yes", sponsorsGuess: "Yes" },  // 24 NYC
  { name: "Warp", ats: "ashby", ashbyToken: "warp", everifyGuess: "Yes", sponsorsGuess: "Yes" },  // 19 NYC
  { name: "OpenAI", ats: "ashby", ashbyToken: "openai", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Notion", ats: "ashby", ashbyToken: "notion", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Cursor", ats: "ashby", ashbyToken: "cursor", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Perplexity", ats: "ashby", ashbyToken: "perplexity", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "ElevenLabs", ats: "ashby", ashbyToken: "elevenlabs", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Sierra", ats: "ashby", ashbyToken: "sierra", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Vanta", ats: "ashby", ashbyToken: "vanta", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Linear", ats: "ashby", ashbyToken: "linear", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // SmartRecruiters employers. Global boards, so the adapter asks for country=us
  // server-side (Experian: 434 roles worldwide, 37 in the US).
  { name: "Experian", ats: "smartrecruiters", srCompany: "Experian", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "NielsenIQ", ats: "smartrecruiters", srCompany: "NielsenIQ", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Bosch", ats: "smartrecruiters", srCompany: "BoschGroup", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Lever employers (clean public API; description inline).
  { name: "Spotify", ats: "lever", leverToken: "spotify", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Oracle Cloud Candidate Experience — JPMorgan Chase (Wilmington DE is a major
  // Chase hub; top referral channel). Two public CE sites host different brands/
  // req sets, so both are polled; global results are trimmed by the location filter.
  { name: "JPMorgan Chase", ats: "oracle", oracleHost: "jpmc.fa.oraclecloud.com", oracleSite: "CX_1001", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "JPMorgan Chase", ats: "oracle", oracleHost: "jpmc.fa.oraclecloud.com", oracleSite: "CX_1002", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Nemours Children's Health — cap-exempt nonprofit with a Wilmington DE hospital
  // (duPont). Also Oracle CE, so it reuses the JPMC adapter: no new code. NOTE the
  // careers site is Oracle, not Workday — the earlier "Workday 422" was a wrong
  // tenant guess, not a session/cookie problem.
  { name: "Nemours", ats: "oracle", oracleHost: "epyz.fa.us2.oraclecloud.com", oracleSite: "CX_1", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // NYC-metro banks on Oracle CE (same adapter as JPMC).
  { name: "American Express", ats: "oracle", oracleHost: "egug.fa.us2.oraclecloud.com", oracleSite: "CX_1", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "BNY", ats: "oracle", oracleHost: "eofe.fa.us2.oraclecloud.com", oracleSite: "bny-careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // PageUp — University of Delaware. Cap-exempt (a university), Newark DE, and
  // the single highest-value employer on this list for the H-1B lottery problem.
  // It needs the browser-driven adapter: UD fronts PageUp with an AWS WAF
  // challenge that answers a plain fetch with a 202 + JS proof-of-work page.
  { name: "University of Delaware", ats: "pageup", pageupUrl: "https://careers.udel.edu/en-us/listing/", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // ------------------------------------------------------------------------
  // MORE CAP-EXEMPT EMPLOYERS (universities, university hospitals, nonprofit
  // research orgs). These skip the H-1B lottery entirely — the single highest-
  // value property on this list, so select.ts ranks them second only to
  // Delaware-local roles. Every id below was found by grepping the employer's
  // OWN careers page for an ATS hostname and then probing the real API for a
  // 200 with job data; none were guessed (see the backlog's "Workday 422"
  // lesson). Ordered DE/Philadelphia first, then NYC metro.
  //
  // Cap-exempt on Workday — config-only, no new code.
  { name: "Jefferson Health", ats: "workday", tenant: "jeffersonhealth", wd: "wd5", site: "ThomasJeffersonExternal", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Children's Hospital of Philadelphia", ats: "workday", tenant: "chop", wd: "wd108", site: "CHOPExternalCareers", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Memorial Sloan Kettering", ats: "workday", tenant: "msk", wd: "wd108", site: "MSKCC_Careers_Primary", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Montefiore", ats: "workday", tenant: "montefiore", wd: "wd12", site: "MMC", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Cornell University", ats: "workday", tenant: "cornell", wd: "wd1", site: "CornellCareerPage", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // Simons Foundation / Flatiron Institute — NYC nonprofit research org.
  { name: "Simons Foundation", ats: "workday", tenant: "simonsfoundation", wd: "wd1", site: "simonsfoundationcareers", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // University of Pennsylvania — Workday, but on the SHARED myworkdaysite host,
  // where the public URL is /recruiting/{tenant}/{site} instead of /{site}.
  // `wdHost` covers that; the CXS API path is identical, so no new adapter.
  { name: "University of Pennsylvania", ats: "workday", wdHost: "wd1.myworkdaysite.com", tenant: "upenn", site: "careers-at-penn", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // Cap-exempt on Oracle Cloud CE — same adapter as JPMC / Nemours.
  { name: "Northwell Health", ats: "oracle", oracleHost: "eppr.fa.us2.oraclecloud.com", oracleSite: "CX_2", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Mount Sinai", ats: "oracle", oracleHost: "ejis.fa.us6.oraclecloud.com", oracleSite: "CX", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // Cap-exempt on PageUp — same browser-driven adapter as University of Delaware.
  // (Drexel serves plain HTML; Rowan / Seton Hall / Swarthmore sit behind the
  // same AWS WAF challenge UD does, so all four go through Chromium anyway.)
  { name: "Drexel University", ats: "pageup", pageupUrl: "https://careers.drexel.edu/en-us/listing/", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Rowan University", ats: "pageup", pageupUrl: "https://jobs.rowan.edu/en-us/listing/", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Seton Hall University", ats: "pageup", pageupUrl: "https://jobs.shu.edu/en-us/listing/", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Swarthmore College", ats: "pageup", pageupUrl: "https://careers.swarthmore.edu/en-us/listing/", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // Cap-exempt on PeopleAdmin (the dominant higher-ed ATS) — public Atom feed,
  // JD inline, no key. Rutgers is the only one of these that publishes
  // pa:city/pa:state; the rest get their campus city from `paLocation` so the
  // location filter (and the Delaware wide-net check) has something to read.
  { name: "Rutgers University", ats: "peopleadmin", paHost: "jobs.rutgers.edu", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Villanova University", ats: "peopleadmin", paHost: "jobs.villanova.edu", paLocation: "Villanova, PA", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Delaware Technical Community College", ats: "peopleadmin", paHost: "dtcc.peopleadmin.com", paLocation: "Dover, DE", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Fordham University", ats: "peopleadmin", paHost: "careers.fordham.edu", paLocation: "Bronx, NY", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  { name: "Hofstra University", ats: "peopleadmin", paHost: "hofstra.peopleadmin.com", paLocation: "Hempstead, NY", everifyGuess: "Unknown", sponsorsGuess: "Unknown", capExempt: true },
  // iCIMS — NOT supported: Incyte runs a Jibe/iCIMS SPA that loads jobs via client XHR
  // (no server HTML, no RSS, no embedded JSON), so a plain fetch can't read it — it would
  // need a headless browser. Kept as a marker; adapters/icims.ts safely returns nothing.
  { name: "Incyte", ats: "icims", icimsHost: "careers-incyte.icims.com", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // Community-maintained GitHub new-grad lists. These are AGGREGATORS, not
  // employers: `name` is only a label for logs/alerts, and every row carries its
  // own company. Deliberately last in this array — dedupe() keeps the first copy
  // of a duplicated application URL, and a direct ATS source is worth more than a
  // list row (only the direct one has a JD-detail path for sponsorship + salary).
  // Fetched from raw.githubusercontent.com; the `dev` branch is where these repos
  // keep the machine-readable file that generates their README.
  { name: "SimplifyJobs list", ats: "githublist", listFormat: "simplify-json", listUrl: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "vanshb03 New-Grad-2027 list", ats: "githublist", listFormat: "simplify-json", listUrl: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "Zapply New-Grad-2027 list", ats: "githublist", listFormat: "zapply-md", listUrl: "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  // Rejected: jobright-ai/Daily-H1B-Jobs-In-Tech. Its README table parses fine, but
  // the repo has been dead since 2026-05-06 — every row is months stale, so it would
  // add ~1,300 expired rows and no new signal. Re-evaluate if it resumes updating.
  //
  // The long tail: Indeed / ZipRecruiter rows scraped by scripts/jobspy_scrape.py
  // into $JOBSPY_FILE before the Node run. Another aggregator (each row names its
  // own employer), and the only source here that reaches small/mid employers with
  // no ATS board of their own — which is most of Delaware. LAST in the array for
  // the same reason as the lists above, and it matters more here: Indeed rows
  // carry the employer's real ATS URL, so they collapse against a direct
  // adapter's copy and the direct one (configured earlier) wins. Takes no config
  // — no file, no rows, never a failure.
  { name: "JobSpy", ats: "jobspy", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
];

// Server-side search terms (Workday) that narrow the pull; the include keywords
// below do the precise filtering. Tuned for an MS-CS new grad on STEM OPT:
// software/data engineering first, analyst as a fallback.
export const SEARCH_TERMS = ["software engineer", "data engineer", "data scientist", "analyst"];

export interface MatchFilters {
  includeKeywords: string[]; // title must contain at least one (substring)
  excludeKeywords: string[]; // title must contain none (whole-word)
  allowLocations: string[]; // location must contain one (substring); empty = allow all
  blockLocations: string[]; // reject if location contains any of these (foreign regions)
}

// Tune these to taste — all one-line edits.
//
// Since the LLM stage (src/llm.ts) landed, this is a WIDE pre-filter, not the
// filter. Its only job is to get plausible roles in front of Claude cheaply;
// Claude then decides what is actually open to a new MS grad. So the seniority
// excludes are gone — they were killing Capital One's "Senior Associate", bank
// "Associate" and similar early-career tiers — and the include list now covers
// the names employers give new-grad roles: programs, rotations, "Graduate",
// "Applied Scientist", "2027 Analyst Program".
export const FILTERS: MatchFilters = {
  includeKeywords: [
    // MS-CS core.
    "software engineer",
    "software developer",
    "data engineer",
    "data scientist",
    "machine learning",
    "ml engineer",
    "backend engineer",
    "full stack",
    "fullstack",
    "analytics engineer",
    "data analyst",
    "business analyst",
    "business intelligence",
    "quantitative analyst",
    "risk analyst",
    "credit analyst",
    // Wide net for the new-grad titles no keyword list can enumerate.
    // "engineer" and "scientist" are bare on purpose: the non-software
    // disciplines they drag in are cut by the excludes below, so the LLM never
    // pays to reject them.
    "engineer",
    "developer",
    "analyst",
    "analytics",
    "scientist",
    "researcher",
    "associate",
    "graduate",
    "program",
    "rotational",
    "early career",
    "new grad",
    "university",
    "technologist",
  ],
  // Whole-word excludes, now only two kinds:
  //  1. unmistakably executive titles — no JD makes these a new-grad fit;
  //  2. the disciplines the wide includes drag in. Non-software engineering
  //     (DuPont/Corteva/Solenis/Bosch are full of it) and clinical roles
  //     (ChristianaCare/Nemours) are far cheaper to cut with a regex than to
  //     pay Claude to reject a few hundred of them a day.
  excludeKeywords: [
    "principal", "director", "vp", "head", "chief", "president", "svp", "evp",
    "mechanical", "chemical", "civil", "electrical", "industrial", "manufacturing",
    "structural", "hvac", "maintenance", "packaging", "polymer", "plant",
    "facilities", "aerospace", "automotive", "technician", "machinist", "welder",
    "rn", "nurse", "nursing", "physician", "pharmacist", "therapist", "dental",
  ],
  // ALL US: empty allow-list = accept anything not blocked below (max first-job
  // reach). To re-narrow to Delaware, set this back to
  // ["delaware","wilmington","newark","philadelphia","remote"].
  allowLocations: [],
  // Reject foreign roles even if tagged "remote" (e.g. "Remote, India"). Country/
  // region names only — US-state-ambiguous names (Georgia, Jersey) are omitted.
  blockLocations: [
    "india", "canada", "united kingdom", "ireland", "germany", "france", "spain",
    "italy", "netherlands", "poland", "romania", "ukraine", "portugal", "sweden",
    "switzerland", "belgium", "austria", "denmark", "norway", "finland", "czech",
    "hungary", "greece", "turkey", "israel", "united arab emirates", "dubai", "saudi",
    "qatar", "egypt", "south africa", "nigeria", "kenya", "argentina", "chile",
    "colombia", "peru", "mexico", "brazil", "costa rica", "panama", "south korea",
    "korea", "japan", "china", "taiwan", "hong kong", "malaysia", "indonesia",
    "thailand", "vietnam", "philippines", "singapore", "australia", "new zealand",
    "pakistan", "bangladesh", "sri lanka", "luxembourg", "scotland", "wales", "england",
    "emea", "apac", "latam", "europe", "middle east", "latin america",
    ", uk", "u.k.", ", on", ", bc", // common foreign abbreviations (comma-prefixed = safe)
    // "Remote in UK" slipped through: isUSLocation() treats any "remote" as a US
    // signal, and the comma-prefixed ", uk" above can't see this phrasing. Caught
    // in the community-list dry run — these forms are unambiguous, so block them.
    "in uk", "in the uk", "uk remote", "remote - uk",
    // offshore tech hubs that often appear WITHOUT a country name (unambiguous — no
    // sizeable US city shares these names):
    "hyderabad", "bangalore", "bengaluru", "pune", "chennai", "mumbai", "gurgaon",
    "gurugram", "noida", "telangana", "karnataka", "kolkata", "bucharest", "krakow",
    "wroclaw", "gdansk", "sao paulo", "são paulo", "toronto", "vancouver", "montreal",
    "tel aviv", "sydney", "melbourne", "tokyo", "beijing", "shanghai", "shenzhen",
    "manila", "cebu", "ho chi minh", "hanoi", "jakarta", "kuala lumpur", "bangkok",
    "seoul", "taipei", "guadalajara",
  ],
};

// Roles physically in the Delaware area get a WIDER net (DE is the top-choice
// location, so broader role types + senior titles are worth seeing); everywhere
// else stays strict/entry-level. Selection is by the role's LOCATION (see
// index.filtersFor), not the company — so a DE-HQ company's out-of-state roles
// still use the strict filter.
export const LOCAL_FILTERS: MatchFilters = {
  includeKeywords: [
    "software engineer", "software developer", "developer", "data engineer",
    "data scientist", "machine learning", "analyst", "analytics",
    "business intelligence", "reporting", "insights",
    // Same new-grad vocabulary as FILTERS — DE is the top-choice location, so it
    // must never be the narrower of the two nets.
    "associate", "graduate", "program", "rotational", "early career", "new grad",
    "researcher", "scientist", "technologist",
  ],
  // Exclude executive titles (Senior/Lead/Manager/etc. are allowed for DE) and
  // clinical roles — the DE net is wide enough to pull hospital jobs from
  // ChristianaCare/Nemours (e.g. "… Analyst (RN Required)"). "clinical" is left
  // out on purpose: "Clinical Data Analyst" is a legit data role.
  excludeKeywords: [
    "director", "vp", "head of", "chief", "president", "svp", "evp",
    "rn", "nurse", "nursing", "physician", "pharmacist", "therapist",
  ],
  allowLocations: FILTERS.allowLocations,
  blockLocations: FILTERS.blockLocations,
};
