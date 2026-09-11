/** Query params that IDENTIFY a posting rather than track where a click came
 *  from. Deliberately tiny: `jk` is Indeed's job key and `currentJobId` is
 *  LinkedIn's — the two aggregator boards the JobSpy source reads, whose URLs
 *  carry no id in the path at all. Mirrored in scripts/jobspy_scrape.py. */
const ID_PARAMS = new Set(["jk", "currentjobid"]);

/**
 * Normalized application-URL key, used as a second dedup axis in index.dedupe().
 *
 * Why: the community list adapters (`githublist`) republish roles that a direct
 * ATS adapter also returns — the same Workday/Greenhouse req arriving twice with
 * two different ids, so the `company:id` key can't catch it (the list's company
 * spelling often differs too: "Broadcom" vs "Broadcom Inc."). The application URL
 * is the one thing both copies agree on, so normalizing it collapses the pair.
 *
 * Pure + unit-tested. Returns "" when there's no usable URL, which callers treat
 * as "no URL signal" (never dedup two empty URLs together).
 */
export function normalizedUrlKey(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(u.protocol)) return "";
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // Drop the query/fragment: ATS links carry per-source tracking params
  // (?src=..., ?utm_source=..., Greenhouse's ?gh_src=, iCIMS' ?mobile=true) that
  // differ between the direct fetch and the list's copy of the same posting.
  // …with one exception: on the aggregator boards the *only* thing distinguishing
  // two postings is a query param — every Indeed job lives at
  // `indeed.com/viewjob?jk=<id>`. Dropping the query there would collapse a whole
  // board's rows into one. Keep the handful of params that identify a posting.
  const ids = [...u.searchParams.entries()]
    .filter(([k]) => ID_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
    .sort();
  const path = u.pathname
    // Workday links are published both with and without a locale segment
    // ("…myworkdayjobs.com/en-US/Careers/job/…" vs "…/Careers/job/…"); 114 of the
    // SimplifyJobs Workday rows carry one and our own adapter never does.
    .replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return ids.length ? `${host}${path}?${ids.join("&")}` : `${host}${path}`;
}
