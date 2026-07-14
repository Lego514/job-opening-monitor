import { type CompanySource, type Posting } from "../types";

const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";

interface WorkdayJobPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

export interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayJobPosting[];
}

/** Pure: turn a Workday CXS response into normalized Postings (unit-tested). */
export function normalizeWorkday(c: CompanySource, raw: WorkdayResponse): Posting[] {
  const sitePrefix = `https://${c.tenant}.${c.wd}.myworkdayjobs.com/${c.site}`;
  return (raw.jobPostings ?? []).map((j) => ({
    id: j.bulletFields?.[0] || j.externalPath,
    company: c.name,
    title: j.title,
    location: j.locationsText ?? "",
    url: sitePrefix + j.externalPath,
    postedOn: j.postedOn ?? "",
  }));
}

const PAGE = 20; // Workday CXS caps page size at 20
// Safety cap per search term. Workday sorts by relevance (not date), so at
// high-volume employers (banks) the newest roles can sit past the first page —
// keep this generous. Override with WORKDAY_MAX_RESULTS if a tenant is huge.
const MAX_RESULTS = Number(process.env.WORKDAY_MAX_RESULTS) || 200;

/**
 * Fetch postings for one search term from a Workday tenant's public CXS API
 * (the same JSON endpoint the careers site calls), paginating so matches beyond
 * the first page aren't missed.
 */
export async function fetchWorkday(c: CompanySource, searchText: string): Promise<Posting[]> {
  const endpoint = `https://${c.tenant}.${c.wd}.myworkdayjobs.com/wday/cxs/${c.tenant}/${c.site}/jobs`;
  const out: Posting[] = [];
  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Workday ${c.name} HTTP ${res.status}`);
    const data = (await res.json()) as WorkdayResponse;
    const page = normalizeWorkday(c, data);
    out.push(...page);
    if (page.length === 0 || offset + PAGE >= (data.total ?? 0)) break;
  }
  return out;
}

interface WorkdayDetailResponse {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
  };
}

export interface JobDetail {
  description: string; // plain-text JD (for sponsorship scanning)
  locations: string[]; // real city locations (resolves "N Locations" labels)
}

/**
 * Fetch a posting's full detail from its Workday URL: the plain-text job
 * description (for sponsorship scanning) and the real location list (which
 * resolves the opaque "N Locations" the listing endpoint returns). Derives the
 * CXS detail endpoint from the public job URL.
 */
export async function fetchJobDetail(jobUrl: string): Promise<JobDetail> {
  const u = new URL(jobUrl);
  const tenant = u.hostname.split(".")[0];
  const segments = u.pathname.split("/").filter(Boolean); // [site, "job", ...]
  const site = segments[0];
  const externalPath = "/" + segments.slice(1).join("/");
  const detailUrl = `https://${u.host}/wday/cxs/${tenant}/${site}${externalPath}`;
  const res = await fetch(detailUrl, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Workday detail HTTP ${res.status}`);
  const info = ((await res.json()) as WorkdayDetailResponse).jobPostingInfo ?? {};
  const description = (info.jobDescription ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const locations = [info.location, ...(info.additionalLocations ?? [])].filter(
    (x): x is string => Boolean(x),
  );
  return { description, locations };
}
