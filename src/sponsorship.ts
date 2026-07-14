// Scan a job description for signals that rule out an F-1 / visa-sponsorship
// candidate. Pure + unit-tested. Conservative by design: it only returns "no"
// on clear disqualifiers, otherwise "unknown" (we never claim a role *does*
// sponsor, since that's rarely stated). We FLAG rather than silently drop, so a
// false positive never hides a real opportunity.

const DISQUALIFIERS: [RegExp, string][] = [
  [/\bno\b[^.]{0,25}\bsponsorship\b/i, "no sponsorship"],
  [/\bnot\b[^.]{0,40}\b(?:provide|offer|sponsor)\w*[^.]{0,25}\bsponsorship\b/i, "states it won't provide sponsorship"],
  [/\bsponsorship\b[^.]{0,25}\bnot\b[^.]{0,25}\b(?:available|offered|provided|considered|possible)\b/i, "sponsorship not available"],
  [/\bwithout\b[^.]{0,30}\bsponsorship\b/i, "requires work authorization without sponsorship"],
  // "...will not require (work visa) sponsorship now or in the future" — candidate
  // must not need sponsorship. Kills future H-1B even if OK during OPT.
  [/\bnot\b[^.]{0,30}\brequir\w*\b[^.]{0,25}\bsponsor(?:ship|ing)?\b/i, "candidate must not require sponsorship"],
  // "unable / not able / not in a position to sponsor"
  [/\b(?:unable|not able|not in a position)\b[^.]{0,25}\bsponsor(?:ship|ing)?\b/i, "unable to sponsor"],
  // Generic "will not ... sponsor(ship)". NOTE: use \bsponsor(?:ship|ing)?\b, not
  // \bsponsor\b — the latter's trailing word boundary never matches "sponsorship"
  // (no boundary between "sponsor" and "ship"), which silently missed real JDs.
  [/\bnot\b[^.]{0,40}\bsponsor(?:ship|ing)?\b/i, "states it will not sponsor"],
  [/\b(?:u\.?s\.?|united states)\s+citizen(?:ship)?\b[^.]{0,30}\b(?:required|only|must|mandatory)\b/i, "US citizenship required"],
  [/\bmust be (?:a |an )?(?:u\.?s\.?|united states)\s+citizen\b/i, "must be a US citizen"],
  [/\b(?:active |current )?security clearance\b/i, "requires security clearance"],
  [/\bmust be (?:a )?u\.?s\.? person\b/i, "must be a US person"],
];

export interface SponsorshipResult {
  status: "no" | "unknown";
  reason?: string;
}

export function classifySponsorship(description: string): SponsorshipResult {
  for (const [re, reason] of DISQUALIFIERS) {
    if (re.test(description)) return { status: "no", reason };
  }
  return { status: "unknown" };
}

/** Best-effort salary extraction from JD text, e.g. "$64,491" or "$60,000 - $80,000". */
export function findSalary(text: string): string | null {
  const m = /\$\s?[\d,]{3,}(?:\s*(?:-|–|—|to)\s*\$?\s?[\d,]{3,})?/.exec(text);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}
