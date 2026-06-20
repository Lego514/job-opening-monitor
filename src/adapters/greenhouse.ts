import { type CompanySource, type Posting } from "../types";
import { type JobDetail } from "./workday";

const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";
const API = "https://boards-api.greenhouse.io/v1/boards";

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  updated_at?: string;
}
interface GreenhouseList {
  jobs?: GreenhouseJob[];
}

/** Pure: map a Greenhouse board listing into normalized Postings. */
export function normalizeGreenhouse(c: CompanySource, raw: GreenhouseList): Posting[] {
  const token = c.ghToken ?? "";
  return (raw.jobs ?? []).map((j) => ({
    id: String(j.id),
    company: c.name,
    title: j.title ?? "",
    location: j.location?.name ?? "",
    url: j.absolute_url,
    postedOn: j.updated_at ? j.updated_at.slice(0, 10) : "",
    detailApi: `${API}/${token}/jobs/${j.id}`,
  }));
}

/**
 * Fetch a whole Greenhouse board (Greenhouse has no server-side keyword search,
 * so we pull the list and filter by title client-side). One request per company.
 */
export async function fetchGreenhouse(c: CompanySource): Promise<Posting[]> {
  const res = await fetch(`${API}/${c.ghToken}/jobs`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Greenhouse ${c.name} HTTP ${res.status}`);
  return normalizeGreenhouse(c, (await res.json()) as GreenhouseList);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

interface GreenhouseDetail {
  content?: string;
  location?: { name?: string };
}

/** Fetch one Greenhouse job's full description (plain text) + location. */
export async function fetchGreenhouseDetail(apiUrl: string): Promise<JobDetail> {
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Greenhouse detail HTTP ${res.status}`);
  const d = (await res.json()) as GreenhouseDetail;
  const description = decodeEntities(d.content ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const locations = d.location?.name ? [d.location.name] : [];
  return { description, locations };
}
