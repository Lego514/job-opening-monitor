import { COMPANIES, SEARCH_TERMS, FILTERS, LOCAL_FILTERS } from "./config";
import { fetchWorkday, fetchJobDetail } from "./adapters/workday";
import { fetchGreenhouse, fetchGreenhouseDetail } from "./adapters/greenhouse";
import { fetchLever } from "./adapters/lever";
import { fetchIcims } from "./adapters/icims";
import { matches, locationAllowed, locationBlocked } from "./match";
import { classifySponsorship, findSalary } from "./sponsorship";
import { detectRemote } from "./remote";
import { loadSeenKeys, markSeen } from "./state";
import { addToTracker } from "./tracker";
import { sendTelegram } from "./notify/telegram";
import { sendEmail } from "./notify/email";
import { selectAlertable } from "./select";
import { postedDays } from "./recency";
import { isDelaware, h1bWageHint } from "./rank";
import { type CompanySource, type Posting, postingKey } from "./types";

const DRY_RUN = process.argv.includes("--dry-run");
const SEED = process.argv.includes("--seed"); // mark current matches seen, don't alert
const SKIP_NO_SPONSORSHIP = /^(1|true|yes)$/i.test(process.env.SKIP_NO_SPONSORSHIP ?? "");

/** Parse a positive-integer env var, falling back if unset/invalid (avoids a
 *  typo'd MAX_AGE_DAYS becoming NaN and silently filtering out every role). */
function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
// Default 14d: with the all-US net, only enrich/alert recent postings (perf + signal).
const MAX_AGE_DAYS = intEnv("MAX_AGE_DAYS", 14);
// Cap how many roles a single run pushes to Telegram/email (the tracker still
// gets them all) so a backlog can't blast a wall of messages.
const MAX_ALERTS_PER_RUN = intEnv("MAX_ALERTS_PER_RUN", 30);

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

function dedupe(list: Posting[]): Posting[] {
  const byKey = new Map<string, Posting>();
  for (const p of list) byKey.set(postingKey(p), p);
  return [...byKey.values()];
}

async function fetchCompany(c: CompanySource): Promise<Posting[]> {
  if (c.ats === "workday") {
    const byId = new Map<string, Posting>();
    let anyOk = false;
    let lastErr: Error | null = null;
    for (const term of SEARCH_TERMS) {
      try {
        for (const p of await fetchWorkday(c, term)) byId.set(p.id, p);
        anyOk = true;
      } catch (e) {
        // One failing search term must not lose the company's other terms.
        lastErr = e as Error;
        console.error(`[fetch] ${c.name} (term "${term}"): ${(e as Error).message}`);
      }
    }
    // Only surface a hard failure if every term failed (tenant likely broken).
    if (!anyOk && lastErr) throw lastErr;
    return [...byId.values()];
  }
  if (c.ats === "greenhouse") return fetchGreenhouse(c);
  if (c.ats === "lever") return fetchLever(c);
  if (c.ats === "icims") return fetchIcims(c);
  return [];
}

interface CollectResult {
  all: Posting[];
  failed: string[]; // company names whose fetch hard-failed this run
}

async function collectAll(): Promise<CollectResult> {
  const all: Posting[] = [];
  const failed: string[] = [];
  for (const c of COMPANIES) {
    try {
      const postings = await fetchCompany(c);
      for (const p of postings) p.capExempt = c.capExempt ?? false;
      console.log(`[fetch] ${c.name}: ${postings.length}`);
      all.push(...postings);
    } catch (e) {
      // One bad source must not abort the whole run.
      console.error(`[fetch] ${c.name}: FAILED — ${(e as Error).message}`);
      failed.push(c.name);
    }
  }
  return { all, failed };
}

/** Fetch the JD and attach sponsorship + salary signals (Workday postings only). */
async function enrich(p: Posting): Promise<void> {
  p.sponsorship = "unknown";
  try {
    let detail: { description: string; locations: string[] } | null = null;
    if (p.description) detail = { description: p.description, locations: [] }; // adapter gave it (Lever)
    else if (p.url.includes("myworkdayjobs.com")) detail = await fetchJobDetail(p.url);
    else if (p.detailApi) detail = await fetchGreenhouseDetail(p.detailApi);
    if (!detail) return;

    const { description, locations } = detail;
    const cls = classifySponsorship(description);
    p.sponsorship = cls.status;
    p.sponsorshipReason = cls.reason;
    p.salary = findSalary(description);
    p.remote = detectRemote(description);
    // Resolve the listing's opaque "N Locations" to the real cities.
    if (locations.length) p.location = locations.join(" · ");
  } catch (e) {
    console.error(`[detail] ${p.company} — ${p.title}: ${(e as Error).message}`);
  }
}

/** Enrich many postings with bounded concurrency (the JD detail fetch is the bottleneck). */
async function enrichAll(posts: Posting[], concurrency = 8): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < posts.length) await enrich(posts[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, posts.length) }, worker));
}

function metaLine(p: Posting): string {
  return [
    p.capExempt ? "✅ cap-exempt — no H-1B lottery" : null,
    p.remote ? "🏠 remote-eligible" : null,
    p.salary ? `💲${p.salary}` : null,
    h1bWageHint(p.salary),
    p.postedOn || null,
    p.sponsorship === "no"
      ? `⛔ no sponsorship${p.sponsorshipReason ? ` — ${p.sponsorshipReason}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function breakdown(list: Posting[]): string {
  const actionable = list.filter((p) => p.sponsorship !== "no").length;
  return `${actionable} sponsorable, ${list.length - actionable} flagged`;
}

function telegramMessage(list: Posting[], extra = 0): string {
  const lines = list.map((p) => {
    const meta = metaLine(p);
    const tag = p.sponsorship === "no" ? "⛔ " : "";
    return (
      `${tag}<b>${escapeHtml(p.company)}</b>: ${escapeHtml(p.title)}\n  ${escapeHtml(p.location)}` +
      (meta ? `\n  ${escapeHtml(meta)}` : "") +
      `\n  ${p.url}`
    );
  });
  const more = extra > 0 ? `\n\n…and ${extra} more — see the tracker.` : "";
  return `🔔 ${list.length + extra} new role(s) — ${breakdown(list)}:\n\n${lines.join("\n\n")}${more}`;
}

function emailHtml(list: Posting[], extra = 0): string {
  const items = list
    .map((p) => {
      const meta = metaLine(p);
      const tag = p.sponsorship === "no" ? "⛔ " : "";
      return (
        `<li>${tag}<strong>${escapeHtml(p.company)}</strong> — <a href="${p.url}">${escapeHtml(p.title)}</a>` +
        `<br><small>${escapeHtml(p.location)}${meta ? ` · ${escapeHtml(meta)}` : ""}</small></li>`
      );
    })
    .join("");
  const more = extra > 0 ? `<p>…and ${extra} more — see the tracker.</p>` : "";
  return `<p>${list.length + extra} new role(s) matched — ${breakdown(list)}:</p><ul>${items}</ul>${more}`;
}

async function main(): Promise<void> {
  const { all: fetched, failed } = await collectAll();
  // Roles in the DE area get the wider filter; everywhere else stays strict.
  const filtersFor = (p: Posting) => (isDelaware(p.location) ? LOCAL_FILTERS : FILTERS);
  const prefiltered = dedupe(fetched.filter((p) => matches(p, filtersFor(p))));
  // Recency filter BEFORE enrichment — caps the (now all-US) volume so we only
  // fetch JD details for postings recent enough to be worth alerting on.
  const recent = prefiltered.filter((p) => {
    const d = postedDays(p.postedOn);
    return d == null || d <= MAX_AGE_DAYS;
  });
  await enrichAll(recent);
  // Re-check location against the real cities resolved from each JD; keep roles
  // the JD marks as remote-eligible regardless of their tagged city.
  const matchedList = recent.filter((p) => {
    const f = filtersFor(p);
    return (
      !locationBlocked(p.location, f.blockLocations) &&
      (p.remote || locationAllowed(p.location, f.allowLocations))
    );
  });

  const flagged = matchedList.filter((p) => p.sponsorship === "no").length;
  console.log(
    `[match] ${matchedList.length} matched (US, ≤${MAX_AGE_DAYS}d) of ${fetched.length} fetched (${flagged} flagged no-sponsorship).`,
  );

  const opts = { skipNoSponsorship: SKIP_NO_SPONSORSHIP };

  if (DRY_RUN) {
    const ranked = selectAlertable(matchedList, opts);
    for (const p of ranked) {
      const meta = metaLine(p);
      console.log(`  • [${p.company}] ${p.title} — ${p.location}${meta ? ` · ${meta}` : ""}\n    ${p.url}`);
    }
    console.log(
      `[dry-run] ${ranked.length} would alert (skipNoSponsorship=${SKIP_NO_SPONSORSHIP}, maxAgeDays=${MAX_AGE_DAYS}).`,
    );
    return;
  }

  const seen = await loadSeenKeys();
  const fresh = matchedList.filter((p) => !seen.has(postingKey(p)));

  if (SEED) {
    await markSeen(fresh);
    console.log(`[seed] recorded ${fresh.length} current postings as seen; no alerts sent.`);
    return;
  }

  const alertable = selectAlertable(fresh, opts);
  console.log(`[diff] ${fresh.length} new; ${alertable.length} to alert.`);

  // Record ALL fresh (including aged-out / skipped) BEFORE alerting: if a
  // downstream alert fails we'd rather miss one than re-blast the whole batch
  // next run (which is exactly what happened when markSeen ran last).
  await markSeen(fresh);

  if (alertable.length > 0) {
    const shown = alertable.slice(0, MAX_ALERTS_PER_RUN);
    const extra = alertable.length - shown.length;
    await addToTracker(alertable); // the tracker gets them all, not just the shown ones
    await sendTelegram(telegramMessage(shown, extra));
    await sendEmail(`${alertable.length} new job match(es)`, emailHtml(shown, extra));
  }

  // Warn only when several sources fail at once (a systemic issue like a network
  // blip), not for one persistently-broken tenant — that would spam every run.
  // (Per-source consecutive-failure tracking would need a state table; see backlog.)
  if (failed.length >= 3) {
    await sendTelegram(`⚠️ ${failed.length} sources failed to fetch this run: ${failed.join(", ")}`);
  }
  console.log(
    `[done] alerted ${Math.min(alertable.length, MAX_ALERTS_PER_RUN)}/${alertable.length}, recorded ${fresh.length} new` +
      (failed.length ? `, ${failed.length} sources failed` : "") + ".",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
