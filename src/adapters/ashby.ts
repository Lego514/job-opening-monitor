import { type CompanySource, type Posting } from "../types";

/**
 * Ashby job boards (e.g. Ramp, OpenAI, Harvey).
 *
 * The richest source here: one unauthenticated call returns the whole board
 * *including* the plain-text JD and a parsed salary range, so unlike Workday or
 * Oracle these postings need no per-role detail fetch — the description is
 * attached at fetch time and `enrich` uses it directly (same path as Lever).
 */

const API = "https://api.ashbyhq.com/posting-api/job-board";
const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";

interface AshbyJob {
  id: string;
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  publishedAt?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  isListed?: boolean;
  compensation?: {
    scrapeableCompensationSalarySummary?: string;
    compensationTierSummary?: string;
  };
}

export interface AshbyResponse {
  jobs?: AshbyJob[];
}

/** Pure: turn an Ashby board response into normalized Postings (unit-tested). */
export function normalizeAshby(c: CompanySource, raw: AshbyResponse): Posting[] {
  return (raw.jobs ?? [])
    // Unlisted roles are still returned but aren't public — don't alert on them.
    .filter((j) => j.isListed !== false)
    .map((j) => {
      // Ashby reports the pay range as structured data rather than in the JD, so
      // append it to the description — that's what findSalary reads.
      const pay =
        j.compensation?.scrapeableCompensationSalarySummary ??
        j.compensation?.compensationTierSummary ??
        "";
      const description = [j.descriptionPlain ?? "", pay && `Compensation: ${pay}`]
        .filter(Boolean)
        .join("\n\n");

      return {
        id: j.id,
        company: c.name,
        title: j.title ?? "",
        location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l?.location)]
          .filter(Boolean)
          .join(" · "),
        url: j.jobUrl ?? `https://jobs.ashbyhq.com/${c.ashbyToken}/${j.id}`,
        postedOn: (j.publishedAt ?? "").slice(0, 10), // ISO date — postedDays parses it
        description: description || undefined,
      };
    });
}

/** Fetch an Ashby board. One call returns every listed role, JD included. */
export async function fetchAshby(c: CompanySource): Promise<Posting[]> {
  const res = await fetch(`${API}/${c.ashbyToken}?includeCompensation=true`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Ashby ${c.name} HTTP ${res.status}`);
  return normalizeAshby(c, (await res.json()) as AshbyResponse);
}
