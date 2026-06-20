export type Ats = "workday" | "greenhouse" | "lever" | "icims";

export type YesNoUnknown = "Yes" | "No" | "Unknown";

export interface CompanySource {
  name: string;
  ats: Ats;
  // Workday tenants:
  tenant?: string; // e.g. "astrazeneca"
  wd?: string; // datacenter, e.g. "wd3"
  site?: string; // career site id, e.g. "Careers"
  // Greenhouse:
  ghToken?: string; // board token, e.g. "gitlab"
  // Lever:
  leverToken?: string; // company token, e.g. "spotify"
  // iCIMS:
  icimsHost?: string; // e.g. "careers-incyte.icims.com"
  // sensible defaults for the tracker row when auto-adding:
  everifyGuess?: YesNoUnknown;
  sponsorsGuess?: YesNoUnknown;
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
  description?: string; // JD text already provided by the adapter (Lever) — skips a detail fetch
}

/** Stable, company-namespaced key used for dedup + seen-state storage. */
export function postingKey(p: Posting): string {
  return `${p.company}:${p.id}`;
}
