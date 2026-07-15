import { type CompanySource, type Posting } from "../types";
import { type JobDetail } from "./workday";

// Oracle Cloud "Candidate Experience" recruiting API (e.g. JPMorgan Chase at
// jpmc.fa.oraclecloud.com). The public site calls the same REST endpoints:
//   list:   /hcmRestApi/resources/latest/recruitingCEJobRequisitions?...finder=findReqs;siteNumber=...
//   detail: /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?...finder=ById;Id="...",siteNumber=...
// Results are global, so the downstream location filter/blocklist trims foreign
// roles; we sort by posting date so the freshest US roles surface first.

const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";
const PAGE = 25; // Oracle CE returns up to 25 per page
const MAX_RESULTS = Number(process.env.ORACLE_MAX_RESULTS) || 100; // per search term

interface OracleReq {
  Id: string;
  Title?: string;
  PrimaryLocation?: string;
  PostedDate?: string;
  ExternalPostedStartDate?: string;
  secondaryLocations?: { Name?: string }[];
}
export interface OracleListResponse {
  items?: { TotalJobsCount?: number; requisitionList?: OracleReq[] }[];
}

const listBase = (c: CompanySource) =>
  `https://${c.oracleHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;

function detailUrl(c: CompanySource, id: string): string {
  return (
    `https://${c.oracleHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?expand=all&finder=ById;Id=%22${id}%22,siteNumber=${c.oracleSite}`
  );
}

/** Pure: turn an Oracle CE list response into normalized Postings (unit-tested). */
export function normalizeOracle(c: CompanySource, raw: OracleListResponse): Posting[] {
  const reqs = raw.items?.[0]?.requisitionList ?? [];
  return reqs.map((r) => ({
    id: r.Id,
    company: c.name,
    title: r.Title ?? "",
    location: [r.PrimaryLocation, ...(r.secondaryLocations ?? []).map((x) => x?.Name)]
      .filter(Boolean)
      .join(" · "),
    url: `https://${c.oracleHost}/hcmUI/CandidateExperience/en/sites/${c.oracleSite}/job/${r.Id}`,
    postedOn: (r.ExternalPostedStartDate ?? r.PostedDate ?? "").slice(0, 10),
    oracleDetail: detailUrl(c, r.Id),
  }));
}

/** Fetch postings for one search term from an Oracle CE site, paginating by offset. */
export async function fetchOracle(c: CompanySource, searchText: string): Promise<Posting[]> {
  const out: Posting[] = [];
  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE) {
    const finder =
      `findReqs;siteNumber=${c.oracleSite},facetsList=LOCATIONS,limit=${PAGE},offset=${offset}` +
      `,sortBy=POSTING_DATES_DESC,keyword=${encodeURIComponent(searchText)}`;
    const url = `${listBase(c)}?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Oracle ${c.name} HTTP ${res.status}`);
    const data = (await res.json()) as OracleListResponse;
    const page = normalizeOracle(c, data);
    out.push(...page);
    const total = data.items?.[0]?.TotalJobsCount ?? 0;
    if (page.length === 0 || offset + PAGE >= total) break;
  }
  return out;
}

/** Fetch one Oracle CE posting's full description (plain text) + resolved locations. */
export async function fetchOracleDetail(apiUrl: string): Promise<JobDetail> {
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Oracle detail HTTP ${res.status}`);
  const d = (((await res.json()) as { items?: Record<string, unknown>[] }).items?.[0] ?? {}) as Record<
    string,
    unknown
  >;
  const description = [
    d.ExternalDescriptionStr,
    d.ExternalQualificationsStr,
    d.ExternalResponsibilitiesStr,
  ]
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const secondary = (d.secondaryLocations as { Name?: string }[] | undefined) ?? [];
  const locations = [d.PrimaryLocation as string | undefined, ...secondary.map((x) => x?.Name)].filter(
    (x): x is string => Boolean(x),
  );
  return { description, locations };
}
