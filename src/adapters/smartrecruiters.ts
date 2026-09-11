import { type CompanySource, type Posting } from "../types";
import { type JobDetail } from "./workday";

/**
 * SmartRecruiters job boards (e.g. Experian, NielsenIQ, Bosch).
 *
 * Public, documented REST API — no key needed:
 *   list:   /v1/companies/{id}/postings?country=us&limit=100&offset=N
 *   detail: /v1/companies/{id}/postings/{postingId}
 *
 * The list endpoint filters server-side by country, which matters here: these
 * are global employers whose boards are mostly non-US (Experian: 434 roles
 * worldwide, 37 in the US), so `country=us` does the heavy trimming before the
 * location blocklist ever runs.
 */

const API = "https://api.smartrecruiters.com/v1/companies";
const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";
const PAGE = 100; // API max
const MAX_RESULTS = Number(process.env.SMARTRECRUITERS_MAX_RESULTS) || 500;

interface SrPosting {
  id: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; fullLocation?: string };
}

export interface SrListResponse {
  totalFound?: number;
  content?: SrPosting[];
}

const detailUrl = (c: CompanySource, id: string) => `${API}/${c.srCompany}/postings/${id}`;

/** Pure: turn a SmartRecruiters list response into normalized Postings (unit-tested). */
export function normalizeSmartRecruiters(c: CompanySource, raw: SrListResponse): Posting[] {
  return (raw.content ?? []).map((p) => {
    const l = p.location ?? {};
    return {
      id: p.id,
      company: c.name,
      title: p.name ?? "",
      // fullLocation is the display string when present; otherwise rebuild it.
      location: l.fullLocation ?? [l.city, l.region, l.country].filter(Boolean).join(", "),
      url: `https://jobs.smartrecruiters.com/${c.srCompany}/${p.id}`,
      postedOn: (p.releasedDate ?? "").slice(0, 10), // ISO date — postedDays parses it
      srDetail: detailUrl(c, p.id),
    };
  });
}

/** Fetch a company's US postings, paginating by offset. */
export async function fetchSmartRecruiters(c: CompanySource): Promise<Posting[]> {
  const out: Posting[] = [];
  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE) {
    const url = `${API}/${c.srCompany}/postings?country=us&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`SmartRecruiters ${c.name} HTTP ${res.status}`);
    const data = (await res.json()) as SrListResponse;
    const page = normalizeSmartRecruiters(c, data);
    out.push(...page);
    if (page.length === 0 || offset + PAGE >= (data.totalFound ?? 0)) break;
  }
  return out;
}

interface SrDetailResponse {
  jobAd?: { sections?: Record<string, { text?: string } | undefined> };
  location?: { fullLocation?: string; city?: string; region?: string };
}

/** Fetch one posting's JD: every jobAd section joined into plain text. */
export async function fetchSmartRecruitersDetail(apiUrl: string): Promise<JobDetail> {
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SmartRecruiters detail HTTP ${res.status}`);
  const d = (await res.json()) as SrDetailResponse;
  const description = Object.values(d.jobAd?.sections ?? {})
    .map((s) => s?.text ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const l = d.location ?? {};
  const city = l.fullLocation ?? [l.city, l.region].filter(Boolean).join(", ");
  return { description, locations: city ? [city] : [] };
}
