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

/**
 * The host serving a tenant. Defaults to the usual dedicated
 * `{tenant}.{wd}.myworkdayjobs.com`; `wdHost` overrides it for tenants on the
 * shared `wd1.myworkdaysite.com` (e.g. UPenn).
 */
export function workdayHost(c: CompanySource): string {
  return c.wdHost ?? `${c.tenant}.${c.wd}.myworkdayjobs.com`;
}

/**
 * Public (human-facing) URL prefix for a tenant's career site. On myworkdaysite
 * the site is namespaced under `/recruiting/{tenant}/{site}`; on a dedicated
 * myworkdayjobs host it is just `/{site}`. The CXS API path below is identical
 * on both shapes, which is why one adapter covers them.
 */
export function workdayPublicPrefix(c: CompanySource): string {
  const host = workdayHost(c);
  return c.wdHost ? `https://${host}/recruiting/${c.tenant}/${c.site}` : `https://${host}/${c.site}`;
}

/** Pure: turn a Workday CXS response into normalized Postings (unit-tested). */
export function normalizeWorkday(c: CompanySource, raw: WorkdayResponse): Posting[] {
  const sitePrefix = workdayPublicPrefix(c);
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
  const endpoint = `https://${workdayHost(c)}/wday/cxs/${c.tenant}/${c.site}/jobs`;
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
export function workdayDetailUrl(jobUrl: string): string {
  const u = new URL(jobUrl);
  let segments = u.pathname.split("/").filter(Boolean);
  // Workday localises public URLs as `/en-US/...`; drop that if present.
  if (/^[a-z]{2}-[A-Z]{2}$/.test(segments[0] ?? "")) segments = segments.slice(1);

  let tenant: string;
  let site: string;
  let rest: string[];
  if (segments[0] === "recruiting") {
    // Shared myworkdaysite host: /recruiting/{tenant}/{site}/job/...
    [, tenant, site, ...rest] = segments;
  } else {
    // Dedicated host: {tenant}.{wd}.myworkdayjobs.com/{site}/job/...
    tenant = u.hostname.split(".")[0];
    [site, ...rest] = segments;
  }
  return `https://${u.host}/wday/cxs/${tenant}/${site}/${rest.join("/")}`;
}

export async function fetchJobDetail(jobUrl: string): Promise<JobDetail> {
  const res = await fetch(workdayDetailUrl(jobUrl), {
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
