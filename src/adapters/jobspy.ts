import { readFileSync } from "node:fs";
import { type CompanySource, type Posting } from "../types";

/**
 * The long tail: Indeed / ZipRecruiter rows scraped by `scripts/jobspy_scrape.py`
 * (python-jobspy) in a step that runs BEFORE the Node process.
 *
 * Every other adapter here polls an employer's own ATS, which is precise and
 * legitimate but structurally blind to the small and mid-size employers —
 * Delaware-local ones especially — that never run a Workday/Greenhouse board and
 * only ever post to an aggregator. This adapter is how those roles get in.
 *
 * Why a file and not a fetch: the scraper is ToS-gray, fragile and blockable
 * (ZipRecruiter answered every local query with 403/429; Indeed answered all of
 * them). Keeping it out-of-process means the monitor never inherits its
 * failure modes — the Python step is `continue-on-error` with its own timeout,
 * and if it produced nothing this adapter logs one line and returns [].
 * **This adapter must never throw.**
 *
 * Like `githublist`, one "source" is not one employer: `CompanySource.name` is a
 * log label and every row carries its own `company`. `Posting.via` names the
 * board ("Indeed" / "ZipRecruiter") so an alert says where the role came from.
 *
 * Rows arrive with the full JD already attached, so they take the same
 * no-detail-fetch enrichment path as Ashby/Lever/PeopleAdmin — the sponsorship
 * scan, salary parse and LLM screen all run on it without a second request.
 *
 * Staffing-agency noise is expected and deliberately NOT filtered here: an
 * agency blocklist is unmaintainable and would also cut real employers. The LLM
 * stage judges fit. The one hard drop is a row with no employer name, which is
 * useless downstream (no sponsor lookup, no tracker row, no dedup).
 */

/** One row of the JSON written by scripts/jobspy_scrape.py. */
export interface JobSpyRow {
  site?: string;
  id?: string;
  company?: string;
  title?: string;
  location?: string;
  url?: string;
  /** The employer's own ATS URL when the board exposed it — preferred over the
   *  aggregator's redirect, both for applying and for cross-source dedup. */
  url_direct?: string | null;
  date_posted?: string;
  description?: string;
  is_remote?: boolean | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_interval?: string | null;
}

const SITE_LABELS: Record<string, string> = {
  indeed: "Indeed",
  zip_recruiter: "ZipRecruiter",
  ziprecruiter: "ZipRecruiter",
  linkedin: "LinkedIn",
  glassdoor: "Glassdoor",
  google: "Google Jobs",
};

function siteLabel(site: string, fallback: string): string {
  const s = site.trim().toLowerCase();
  return SITE_LABELS[s] ?? (s || fallback);
}

/** "YYYY-MM-DD" or "" — the recency filter treats "" as unknown age (passes). */
function isoDate(v: unknown): string {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : "";
}

/** "$95,000–$115,000 / yearly" from the board's structured pay fields, or null.
 *  The JD-derived `findSalary` still wins during enrichment; this is the floor
 *  for rows whose JD prose never states a number. */
export function salaryText(r: JobSpyRow): string | null {
  const min = typeof r.salary_min === "number" && r.salary_min > 0 ? r.salary_min : null;
  const max = typeof r.salary_max === "number" && r.salary_max > 0 ? r.salary_max : null;
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const range = min != null && max != null && max !== min ? `${fmt(min)}–${fmt(max)}` : fmt((min ?? max)!);
  const interval = (r.salary_interval ?? "").trim();
  return interval ? `${range} / ${interval}` : range;
}

/**
 * Pure: JSON rows -> Postings (unit-tested against a fixture from a real run).
 *
 * Defensive throughout — this file is written by a scraper whose upstream HTML
 * changes without notice, so a malformed row is skipped, never thrown.
 */
export function normalizeJobSpy(c: CompanySource, raw: unknown): Posting[] {
  if (!Array.isArray(raw)) return [];
  const out: Posting[] = [];
  for (const row of raw as JobSpyRow[]) {
    try {
      if (!row || typeof row !== "object") continue;
      const company = (row.company ?? "").trim();
      const title = (row.title ?? "").trim();
      // The aggregator URL is the guaranteed one; the direct URL is better when
      // present (it's the employer's own ATS link — which is also what lets
      // dedupe() collapse a row we already have from a direct adapter).
      const url = (row.url_direct ?? "").trim() || (row.url ?? "").trim();
      // No employer name = useless downstream. No title/URL = not a posting.
      if (!company || !title || !url) continue;
      const site = (row.site ?? "").trim().toLowerCase();
      const description = (row.description ?? "").trim();
      out.push({
        // Namespaced by board: the same req can appear on two boards with two
        // ids, and `postingKey` is `company:id`.
        id: `${site || "jobspy"}:${(row.id ?? "").trim() || url}`,
        company,
        title,
        location: (row.location ?? "").trim(),
        url,
        postedOn: isoDate(row.date_posted),
        via: siteLabel(site, c.name),
        // The board already gave us the JD, so enrich() uses it directly instead
        // of paying for a detail fetch (same path as Ashby/Lever).
        description: description || undefined,
        remote: row.is_remote === true || undefined,
        salary: salaryText(row),
      });
    } catch {
      continue; // one bad row never costs us the file
    }
  }
  return out;
}

/**
 * Read the JSON the Python step wrote. Never throws: a missing, unreadable or
 * malformed file means "this optional source produced nothing this run", which
 * is a normal outcome (the boards block, the step times out, or nobody set
 * JOBSPY_FILE locally).
 */
export async function fetchJobSpy(c: CompanySource): Promise<Posting[]> {
  const file = (process.env.JOBSPY_FILE ?? "").trim();
  if (!file) {
    console.log(`[fetch] ${c.name}: skipped (no file)`);
    return [];
  }
  let body: string;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    console.log(`[fetch] ${c.name}: skipped (no file) — ${file}`);
    return [];
  }
  try {
    return normalizeJobSpy(c, JSON.parse(body));
  } catch (e) {
    console.error(`[fetch] ${c.name}: unreadable JSON at ${file} — ${(e as Error).message}`);
    return [];
  }
}
