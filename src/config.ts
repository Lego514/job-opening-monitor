import { type CompanySource } from "./types";

// Target employers. Add more by appending here — Workday tenants are easy to
// find (the careers URL is `{tenant}.{wd}.myworkdayjobs.com/{site}`).
export const COMPANIES: CompanySource[] = [
  // Workday employers — one adapter covers all. Delaware-relevant pharma / finance / chem.
  { name: "AstraZeneca", ats: "workday", tenant: "astrazeneca", wd: "wd3", site: "Careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "Capital One", ats: "workday", tenant: "capitalone", wd: "wd12", site: "Capital_One", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  { name: "ChristianaCare", ats: "workday", tenant: "christianacare", wd: "wd5", site: "CCHS", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "DuPont", ats: "workday", tenant: "dupont", wd: "wd5", site: "Jobs", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  { name: "WSFS Bank", ats: "workday", tenant: "wsfsbank", wd: "wd1", site: "wsfscareers", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "M&T Bank", ats: "workday", tenant: "mtb", wd: "wd5", site: "MTB", everifyGuess: "Unknown", sponsorsGuess: "Unknown" },
  { name: "Vanguard", ats: "workday", tenant: "vanguard", wd: "wd5", site: "vanguard_external", everifyGuess: "Yes", sponsorsGuess: "Unknown" },
  { name: "Comcast", ats: "workday", tenant: "comcast", wd: "wd5", site: "Comcast_Careers", everifyGuess: "Yes", sponsorsGuess: "Yes" },
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
  // Lever employers (clean public API; description inline).
  { name: "Spotify", ats: "lever", leverToken: "spotify", everifyGuess: "Yes", sponsorsGuess: "Yes" },
  // iCIMS — NOT supported: Incyte runs a Jibe/iCIMS SPA that loads jobs via client XHR
  // (no server HTML, no RSS, no embedded JSON), so a plain fetch can't read it — it would
  // need a headless browser. Kept as a marker; adapters/icims.ts safely returns nothing.
  { name: "Incyte", ats: "icims", icimsHost: "careers-incyte.icims.com", everifyGuess: "Yes", sponsorsGuess: "Yes" },
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
export const FILTERS: MatchFilters = {
  // MS-CS targets first (software/data engineering, ML), analyst kept as a fallback.
  includeKeywords: [
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
  ],
  // Whole-word excludes. Note: Capital One's "Senior Associate" is actually an
  // early-career tier — remove "senior" here if you want those through.
  excludeKeywords: ["senior", "sr", "principal", "director", "manager", "lead", "staff", "vp", "head", "architect"],
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
  ],
  // Only exclude clearly executive titles — Senior/Lead/Manager/etc. are allowed for DE.
  excludeKeywords: ["director", "vp", "head of", "chief", "president", "svp", "evp"],
  allowLocations: FILTERS.allowLocations,
  blockLocations: FILTERS.blockLocations,
};
