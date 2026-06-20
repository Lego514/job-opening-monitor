import { COMPANIES } from "./config";
import { type Posting } from "./types";

/** Map an ATS location string to the tracker's Location enum. */
export function trackerLocation(raw: string): "Delaware" | "Remote" | "Other" {
  const s = raw.toLowerCase();
  if (s.includes("remote")) return "Remote";
  if (s.includes("delaware") || s.includes("wilmington") || s.includes("newark")) return "Delaware";
  return "Other";
}

/**
 * Insert new matches into the tracker's `applications` table as Wishlist rows,
 * via Supabase REST with the service_role key (bypasses RLS; sets user_id to
 * the tracker owner). No-op (with a warning) if the required env isn't set.
 */
export async function addToTracker(postings: Posting[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.TRACKER_USER_ID;
  if (!url || !key || !userId) {
    console.warn("[tracker] SUPABASE_URL/SERVICE_ROLE_KEY/TRACKER_USER_ID not set — skipping auto-add.");
    return;
  }
  if (postings.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const rows = postings.map((p) => {
    const c = COMPANIES.find((x) => x.name === p.company);
    // The JD scan overrides the company guess: a flagged role is sponsors=No.
    const sponsors = p.sponsorship === "no" ? "No" : (c?.sponsorsGuess ?? "Unknown");
    const notes = [
      `Auto-added by monitor ${today}`,
      p.location,
      p.postedOn,
      p.salary ? `Salary ${p.salary}` : null,
      p.sponsorship === "no" && p.sponsorshipReason ? `⚠ ${p.sponsorshipReason}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      user_id: userId,
      company: p.company,
      role: p.title,
      location: trackerLocation(p.location),
      status: "Wishlist",
      link: p.url,
      everify: c?.everifyGuess ?? "Unknown",
      sponsors,
      notes,
    };
  });

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/applications`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) console.error(`[tracker] insert HTTP ${res.status}: ${await res.text()}`);
}
