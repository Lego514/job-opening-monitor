import { type Posting } from "./types";
import { FILTERS, type MatchFilters } from "./config";

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function isExcluded(title: string, excludeKeywords: string[]): boolean {
  return excludeKeywords.some((k) => {
    // "Senior/Sr Associate" is an early-career tier at some employers (e.g. Capital
    // One), so don't let the "senior"/"sr" excludes knock it out.
    const key = k.toLowerCase();
    if ((key === "senior" || key === "sr") && /\b(?:senior|sr\.?)\s+associate\b/.test(title)) {
      return false;
    }
    return hasWord(title, k);
  });
}

/** True if the location names a blocked (e.g. foreign) region. */
export function locationBlocked(location: string, block: string[]): boolean {
  const loc = (location ?? "").toLowerCase();
  return block.some((b) => loc.includes(b.toLowerCase()));
}

const US_STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
];
const US_ABBR_RE =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

/** Heuristic: does this location look US-based? (used in "all US" mode). */
export function isUSLocation(location: string): boolean {
  const loc = location ?? "";
  const lower = loc.toLowerCase();
  if (/\b(?:usa|u\.?s\.?a|united states|u\.?s\.?)\b/.test(lower)) return true;
  if (/\bremote\b/.test(lower)) return true; // US-remote (foreign-remote caught by blockLocations)
  if (US_STATE_NAMES.some((s) => lower.includes(s))) return true;
  return US_ABBR_RE.test(loc); // abbreviations like "VA", "TX" (original case)
}

export function locationAllowed(location: string, allow: string[]): boolean {
  const loc = (location ?? "").toLowerCase().trim();
  // Workday hides multi-location roles as "2 Locations" (no cities) — let those
  // (and unknown locations) through; the JD-detail fetch resolves the real cities,
  // and the post-enrich filter re-checks them.
  if (loc === "" || /^\d+\s+locations?$/.test(loc)) return true;
  // Empty allow-list = "all US": require a US signal (precise — no foreign-blocklist
  // whack-a-mole). Otherwise substring-match the configured locations (DE-narrow mode).
  if (allow.length === 0) return isUSLocation(location);
  return allow.some((l) => loc.includes(l.toLowerCase()));
}

/**
 * Pure predicate: does this posting match the configured filters?
 * - title contains an include keyword (substring, case-insensitive), AND
 * - title contains no exclude keyword (whole-word, e.g. "lead" won't hit "leadership"), AND
 * - location is allowed (matches an allowed term, or is unknown/multi-location).
 */
export function matches(p: Posting, filters: MatchFilters = FILTERS): boolean {
  const title = (p.title ?? "").toLowerCase();

  if (!filters.includeKeywords.some((k) => title.includes(k.toLowerCase()))) return false;
  if (isExcluded(title, filters.excludeKeywords)) return false;
  if (locationBlocked(p.location, filters.blockLocations)) return false;
  if (!locationAllowed(p.location, filters.allowLocations)) return false;
  return true;
}
