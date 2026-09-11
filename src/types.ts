export type Ats =
  | "workday"
  | "greenhouse"
  | "lever"
  | "icims"
  | "oracle"
  | "pageup"
  | "ashby"
  | "smartrecruiters"
  | "peopleadmin";

export type YesNoUnknown = "Yes" | "No" | "Unknown";

export interface CompanySource {
  name: string;
  ats: Ats;
  // Workday tenants:
  tenant?: string; // e.g. "astrazeneca"
  wd?: string; // datacenter, e.g. "wd3"
  site?: string; // career site id, e.g. "Careers"
  // Workday host override. Most tenants live at `{tenant}.{wd}.myworkdayjobs.com`,
  // but some (universities especially) are hosted on the shared
  // `wd1.myworkdaysite.com` instead, where the PUBLIC page lives under
  // `/recruiting/{tenant}/{site}` rather than `/{site}`. The CXS API path
  // (`/wday/cxs/{tenant}/{site}`) is identical on both, so only the public URL
  // shape changes. Set this to e.g. "wd1.myworkdaysite.com" (UPenn).
  wdHost?: string;
  // Greenhouse:
  ghToken?: string; // board token, e.g. "gitlab"
  // Lever:
  leverToken?: string; // company token, e.g. "spotify"
  // iCIMS:
  icimsHost?: string; // e.g. "careers-incyte.icims.com"
  // Oracle Cloud Candidate Experience (e.g. JPMorgan Chase):
  oracleHost?: string; // e.g. "jpmc.fa.oraclecloud.com"
  oracleSite?: string; // CE site number, e.g. "CX_1001"
  // PageUp (e.g. University of Delaware) — full listing URL; needs a browser:
  pageupUrl?: string; // e.g. "https://careers.udel.edu/en-us/listing/"
  // Ashby:
  ashbyToken?: string; // job board name, e.g. "ramp"
  // SmartRecruiters:
  srCompany?: string; // company identifier, e.g. "Experian"
  // PeopleAdmin (higher-ed ATS) — the host serving `/postings/search.atom`:
  paHost?: string; // e.g. "jobs.rutgers.edu"
  // Fallback location for PeopleAdmin feeds that omit pa:city/pa:state
  // (Villanova, DTCC, Fordham, Hofstra all do) — the campus city.
  paLocation?: string; // e.g. "Dover, DE"
  // sensible defaults for the tracker row when auto-adding:
  everifyGuess?: YesNoUnknown;
  sponsorsGuess?: YesNoUnknown;
  // H-1B cap-exempt employer (university / affiliated nonprofit / research org):
  // no lottery needed, so these rank top. Verify per-role — not every req at a
  // cap-exempt employer is itself cap-exempt.
  capExempt?: boolean;
}

/** A normalized job posting from any ATS adapter. */
export interface Posting {
  id: string; // stable id within a company (req id, or path fallback)
  company: string;
  title: string;
  location: string;
  url: string;
  postedOn: string;
  // Optional enrichment from the job-detail fetch (set after matching):
  sponsorship?: "no" | "unknown"; // "no" = the JD rules out F-1 sponsorship
  sponsorshipReason?: string; // why it was flagged "no"
  salary?: string | null; // salary text parsed from the JD, if any
  remote?: boolean; // JD indicates remote-eligible (passes the location filter)
  detailApi?: string; // adapter-specific detail endpoint (Greenhouse), for enrichment
  oracleDetail?: string; // Oracle CE detail endpoint, for enrichment
  pageupDetail?: string; // PageUp job page URL, for enrichment (browser fetch)
  srDetail?: string; // SmartRecruiters detail endpoint, for enrichment
  description?: string; // JD text already provided by the adapter (Lever) — skips a detail fetch
  capExempt?: boolean; // company is H-1B cap-exempt (copied from its CompanySource)
}

/** Stable, company-namespaced key used for dedup + seen-state storage. */
export function postingKey(p: Posting): string {
  return `${p.company}:${p.id}`;
}
