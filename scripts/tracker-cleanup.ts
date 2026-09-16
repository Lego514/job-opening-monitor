/**
 * One-off cleanup: delete the tracker rows the monitor's old per-run bulk insert
 * left behind. Run with `npm run tracker:cleanup` (see the README).
 *
 * Until 2026-09-16 every alertable posting of every run became an `applications`
 * row, which produced 4,389 Wishlist rows and zero applications — the companion
 * app became unusable as a working surface. The monitor no longer writes those
 * rows (the daily apply queue does), but the backlog is still sitting there.
 *
 * This is deliberately a manual script and not part of any run. It is Ray's
 * data: the monitor gets to stop *adding* rows on its own, it does not get to
 * delete his on its own. So the script prints what it would delete and exits
 * unless `--yes` is passed, and it only ever touches rows that are
 * simultaneously:
 *
 *   - his (`user_id` = TRACKER_USER_ID),
 *   - written by the bulk insert (`notes` starts with BULK_NOTE — a daily-queue
 *     row carries QUEUE_NOTE instead and is never matched),
 *   - still `Wishlist` (anything he moved to Applied/Screen/… is untouched), and
 *   - never dated (`date_applied is null`), so a row he half-filled survives.
 *
 * Anything that fails one of those four is left exactly as it is.
 */
import { BULK_NOTE } from "../src/tracker";
import { sbFetch } from "../src/state";

const YES = process.argv.includes("--yes");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.TRACKER_USER_ID;
if (!url || !key || !userId) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TRACKER_USER_ID — " +
      "put them in .env (this script reads it) and re-run.",
  );
  process.exit(1);
}

const base = `${url.replace(/\/$/, "")}/rest/v1`;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// PostgREST's `like` wildcard is `*`, not `%`. Every clause is ANDed, and the
// same string is reused for the delete so the preview cannot drift from it.
const FILTER =
  `user_id=eq.${encodeURIComponent(userId)}` +
  `&status=eq.Wishlist` +
  `&date_applied=is.null` +
  `&notes=like.${encodeURIComponent(`${BULK_NOTE}*`)}`;

/** Exact row count for the filter, via PostgREST's Content-Range header. */
async function count(): Promise<number> {
  const res = await sbFetch(
    `${base}/applications?select=id&${FILTER}`,
    { headers: { ...headers, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } },
    "cleanup count",
  );
  if (!res.ok && res.status !== 206) {
    throw new Error(`count HTTP ${res.status}: ${await res.text()}`);
  }
  const range = res.headers.get("content-range") ?? ""; // e.g. "0-0/4389"
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/** A few real rows, so the filter is verified against data rather than trusted. */
async function sample(): Promise<{ company: string; role: string; notes: string }[]> {
  const res = await sbFetch(
    `${base}/applications?select=company,role,notes&${FILTER}&limit=5`,
    { headers },
    "cleanup sample",
  );
  if (!res.ok) throw new Error(`sample HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as { company: string; role: string; notes: string }[];
}

const total = await count();
console.log(
  `Monitor-inserted Wishlist rows never acted on: ${total}\n` +
    `  filter: user_id = yours · status = Wishlist · date_applied is null · ` +
    `notes starts with "${BULK_NOTE}"`,
);

if (total === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}

for (const r of await sample()) {
  console.log(`  e.g. ${r.company} — ${r.role}  [${r.notes.slice(0, 60)}…]`);
}

if (!YES) {
  console.log(
    `\nNothing deleted. This is a preview.\n` +
      `Re-run with --yes to delete these ${total} row(s):  npm run tracker:cleanup -- --yes`,
  );
  process.exit(0);
}

const res = await sbFetch(
  `${base}/applications?${FILTER}`,
  { method: "DELETE", headers: { ...headers, Prefer: "count=exact" } },
  "cleanup delete",
);
if (!res.ok) {
  console.error(`delete HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const left = await count();
console.log(`Deleted ${total - left} row(s). ${left} still match (should be 0).`);
