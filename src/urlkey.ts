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
  const path = u.pathname
    // Workday links are published both with and without a locale segment
    // ("…myworkdayjobs.com/en-US/Careers/job/…" vs "…/Careers/job/…"); 114 of the
    // SimplifyJobs Workday rows carry one and our own adapter never does.
    .replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return `${host}${path}`;
}
