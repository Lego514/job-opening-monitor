import { COMPANIES, SEARCH_TERMS, FILTERS, LOCAL_FILTERS } from "./config";
import { fetchWorkday, fetchJobDetail } from "./adapters/workday";
import { fetchGreenhouse, fetchGreenhouseDetail } from "./adapters/greenhouse";
import { fetchLever } from "./adapters/lever";
import { fetchIcims } from "./adapters/icims";
import { fetchOracle, fetchOracleDetail } from "./adapters/oracle";
import { fetchPageUp, fetchPageUpDetail, closePageUpBrowser } from "./adapters/pageup";
import { fetchAshby } from "./adapters/ashby";
import { fetchPeopleAdmin } from "./adapters/peopleadmin";
import { fetchGithubList } from "./adapters/githublist";
import {
  fetchSmartRecruiters,
  fetchSmartRecruitersDetail,
} from "./adapters/smartrecruiters";
import { matches, locationAllowed, locationBlocked } from "./match";
import { classifySponsorship, findSalary } from "./sponsorship";
import { detectRemote } from "./remote";
import { loadSeenKeys, markSeen, loadLlmVerdicts, saveLlmVerdicts } from "./state";
import { classifyAll, llmEnabled, LLM_MODEL } from "./llm";
import { addToTracker } from "./tracker";
import { sendTelegram } from "./notify/telegram";
import { sendEmail } from "./notify/email";
import { selectAlertable } from "./select";
import { postedDays } from "./recency";
import { normalizedUrlKey } from "./urlkey";
import { isDelaware, h1bWageHint } from "./rank";
import { loadSponsorIndex, matchSponsor, sponsorLine, type SponsorHistory } from "./sponsors";
import { checkEnv, missingEnvMessage, type RunMode } from "./env";
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
// Hard ceilings on LLM spend. A live run only classifies postings that are NEW
// and not already cached, so this bites only on an abnormal day; a dry run has
// no Supabase cache to lean on, so it stays deliberately tiny.
const LLM_MAX_PER_RUN = intEnv("LLM_MAX_PER_RUN", 80);
const LLM_DRY_RUN_MAX = intEnv("LLM_DRY_RUN_MAX", 15);

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

/** Dedup on two axes: the company-namespaced key, and the normalized application
 *  URL. The second one exists for the aggregator lists (`githublist`), which
 *  republish roles a direct ATS adapter already returned — same req, different id
 *  and often a different company spelling, so `company:id` alone lets it through
 *  twice. Direct-ATS sources are configured first and win, because only they have
 *  a JD-detail path for enrichment. */
function dedupe(list: Posting[]): Posting[] {
  const byKey = new Map<string, Posting>();
  const seenUrls = new Set<string>();
  for (const p of list) {
    const u = normalizedUrlKey(p.url);
    if (u && seenUrls.has(u)) continue;
    if (u) seenUrls.add(u);
    byKey.set(postingKey(p), p);
  }
  return [...byKey.values()];
}

/** Run a per-search-term fetcher (Workday/Oracle) over all SEARCH_TERMS, deduping
 *  by id. One failing term is logged and skipped; only an all-terms-failed run
 *  hard-throws (so a truly broken tenant surfaces). */
async function fetchByTerms(
  c: CompanySource,
  fetcher: (c: CompanySource, term: string) => Promise<Posting[]>,
): Promise<Posting[]> {
  const byId = new Map<string, Posting>();
  let anyOk = false;
  let lastErr: Error | null = null;
  for (const term of SEARCH_TERMS) {
    try {
      for (const p of await fetcher(c, term)) byId.set(p.id, p);
      anyOk = true;
    } catch (e) {
      lastErr = e as Error;
      console.error(`[fetch] ${c.name} (term "${term}"): ${(e as Error).message}`);
    }
  }
  if (!anyOk && lastErr) throw lastErr;
  return [...byId.values()];
}

async function fetchCompany(c: CompanySource): Promise<Posting[]> {
  if (c.ats === "workday") return fetchByTerms(c, fetchWorkday);
  if (c.ats === "oracle") return fetchByTerms(c, fetchOracle);
  if (c.ats === "greenhouse") return fetchGreenhouse(c);
  if (c.ats === "lever") return fetchLever(c);
  if (c.ats === "icims") return fetchIcims(c);
  if (c.ats === "pageup") return fetchPageUp(c);
  if (c.ats === "ashby") return fetchAshby(c);
  if (c.ats === "smartrecruiters") return fetchSmartRecruiters(c);
  if (c.ats === "peopleadmin") return fetchPeopleAdmin(c);
  if (c.ats === "githublist") return fetchGithubList(c);
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
    // Both Workday host shapes: dedicated myworkdayjobs, and the shared
    // myworkdaysite the university tenants (UPenn) sit on.
    else if (p.url.includes("myworkdayjobs.com") || p.url.includes("myworkdaysite.com"))
      detail = await fetchJobDetail(p.url);
    else if (p.oracleDetail) detail = await fetchOracleDetail(p.oracleDetail);
    else if (p.detailApi) detail = await fetchGreenhouseDetail(p.detailApi);
    else if (p.pageupDetail) detail = await fetchPageUpDetail(p.pageupDetail);
    else if (p.srDetail) detail = await fetchSmartRecruitersDetail(p.srDetail);
    if (!detail) return;

    const { description, locations } = detail;
    const cls = classifySponsorship(description);
    p.sponsorship = cls.status;
    p.sponsorshipReason = cls.reason;
    p.salary = findSalary(description);
    p.remote = detectRemote(description);
    // Keep a bounded slice of the JD for the LLM stage, so classification never
    // has to re-fetch the detail page it already paid for. Seniority and
    // sponsorship language lives near the top; the tail is benefits boilerplate.
    p.jdText = description.slice(0, 6000);
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

// How the LLM's new-grad verdict reads in an alert. "yes" is the expected case
// once rejects are filtered out, so it gets no badge — only a hedge is worth
// the line space.
const FIT_BADGE: Record<string, string> = {
  maybe: "🤔 maybe a fit",
  no: "🚫 not a new-grad fit",
};

function metaLine(p: Posting): string {
  const v = p.llm;
  return [
    p.capExempt ? "✅ cap-exempt — no H-1B lottery" : null,
    p.via ? `via ${p.via}` : null,
    p.remote ? "🏠 remote-eligible" : null,
    p.salary ? `💲${p.salary}` : null,
    h1bWageHint(p.salary),
    sponsorLine(p.sponsorHistory, p.company, p.capExempt),
    p.postedOn || null,
    p.sponsorship === "no"
      ? `⛔ no sponsorship${p.sponsorshipReason ? ` — ${p.sponsorshipReason}` : ""}`
      : null,
    // The LLM's read of the JD — the part that saves actually opening it.
    v?.sponsorship === "will-sponsor" ? "🛂 mentions sponsorship" : null,
    v ? FIT_BADGE[v.newGradFit] ?? null : null,
    v ? `🎓 ${v.seniority} · ${v.roleFamily}` : null,
    v?.summary ? `📝 ${v.summary}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Attach each posting's employer H-1B filing history from `data/sponsors.json`.
 *
 * Runs BEFORE `selectAlertable`, because the ordering uses it. Results are
 * memoized per company name — a run routinely carries dozens of roles from the
 * same employer, and the fuzzy pass is the only non-trivial work here. A missing
 * index is a no-op: every posting keeps `sponsorHistory` undefined and the alert
 * looks exactly as it did before this feature existed.
 */
function attachSponsorHistory(posts: Posting[]): void {
  const index = loadSponsorIndex();
  if (!index) return;
  const byCompany = new Map<string, SponsorHistory>();
  for (const p of posts) {
    let h = byCompany.get(p.company);
    if (!h) {
      h = matchSponsor(index, p.company);
      byCompany.set(p.company, h);
    }
    p.sponsorHistory = h;
  }
}

/** `[sponsor]` log line: how much of this run's alert set the index could speak to. */
function sponsorSummary(posts: Posting[]): string {
  const seen = new Map<string, SponsorHistory | undefined>();
  for (const p of posts) if (!seen.has(p.company)) seen.set(p.company, p.sponsorHistory);
  const vals = [...seen.values()];
  const matched = vals.filter((h) => h && h.confidence !== "none");
  const fuzzy = matched.filter((h) => h?.confidence === "fuzzy").length;
  const approvals = matched.reduce((n, h) => n + (h?.initialApprovals ?? 0), 0);
  return (
    `[sponsor] matched ${matched.length}/${vals.length} alertable employers ` +
    `(${fuzzy} fuzzy, ${approvals.toLocaleString("en-US")} initial H-1B approvals in view).`
  );
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

/**
 * Run the LLM classification stage over `posts`, attaching verdicts in place.
 *
 * No-ops entirely without an API key — that is the regex-only fallback path, and
 * it is the normal local configuration. `useCache` is off for a dry run, which
 * has no Supabase credentials at all.
 */
async function classifyStage(
  posts: Posting[],
  max: number,
  useCache: boolean,
): Promise<Set<string>> {
  if (!llmEnabled() || posts.length === 0) return new Set();
  const cache = useCache ? await loadLlmVerdicts(posts.map(postingKey)) : undefined;
  const r = await classifyAll(posts, { cache, max });
  if (useCache) await saveLlmVerdicts(r.fresh, LLM_MODEL);
  console.log(
    `[llm] classified ${r.classified} postings, ~$${r.costUsd.toFixed(4)} ` +
      `(${r.cached} from cache, ${r.failed} failed, ${r.deferred.size} deferred) — ${LLM_MODEL}`,
  );
  return r.deferred;
}

async function main(): Promise<void> {
  // Check secrets BEFORE the expensive fetch — a missing one used to surface
  // only at the first Supabase call, ~3 minutes and every source later.
  const mode: RunMode = DRY_RUN ? "dry-run" : SEED ? "seed" : "live";
  const { missing, degraded } = checkEnv(process.env, mode);
  if (missing.length > 0) throw new Error(missingEnvMessage(missing, mode));
  for (const d of degraded) console.warn(`[env] ${d}`);

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
  // Cross-reference every matched employer against USCIS H-1B filings. Cheap
  // (one in-memory map lookup per distinct company) and needed before ranking.
  attachSponsorHistory(matchedList);

  if (DRY_RUN) {
    // A dry run has no Supabase cache to amortize against, so classification is
    // capped hard: rank first, spend on the top of the list only, then re-rank
    // with the verdicts applied (unclassified roles pass through untouched).
    const candidates = selectAlertable(matchedList, { ...opts, skipLlmReject: false });
    await classifyStage(candidates.slice(0, LLM_DRY_RUN_MAX), LLM_DRY_RUN_MAX, false);
    const ranked = selectAlertable(matchedList, opts);
    for (const p of ranked) {
      const meta = metaLine(p);
      console.log(`  • [${p.company}] ${p.title} — ${p.location}${meta ? ` · ${meta}` : ""}\n    ${p.url}`);
    }
    console.log(sponsorSummary(ranked));
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

  // Classify only what's genuinely new — never the ~2500 that match every run.
  // Cached verdicts make a re-run or a reappearing role free. Rank order first,
  // so if the ceiling bites it bites the least promising roles.
  const deferred = await classifyStage(
    selectAlertable(fresh, { ...opts, skipLlmReject: false }),
    LLM_MAX_PER_RUN,
    true,
  );
  // A deferred posting was never looked at. Alerting on it unscreened AND
  // marking it seen would burn it permanently, so hold it back entirely: it
  // comes round again next run (in ~15 min) with budget to spare.
  const considered = deferred.size ? fresh.filter((p) => !deferred.has(postingKey(p))) : fresh;

  const alertable = selectAlertable(considered, opts);
  console.log(sponsorSummary(alertable));
  console.log(
    `[diff] ${fresh.length} new; ${alertable.length} to alert` +
      (deferred.size ? `; ${deferred.size} held for the next run` : "") + ".",
  );

  // Record everything we considered (including aged-out / skipped) BEFORE
  // alerting: if a downstream alert fails we'd rather miss one than re-blast
  // the whole batch next run (which is exactly what happened when markSeen ran
  // last). Deferred postings are deliberately NOT recorded.
  await markSeen(considered);

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
    `[done] alerted ${Math.min(alertable.length, MAX_ALERTS_PER_RUN)}/${alertable.length}, recorded ${considered.length} new` +
      (failed.length ? `, ${failed.length} sources failed` : "") + ".",
  );
}

// The PageUp adapter's headless Chromium keeps the event loop alive, so it has
// to be torn down on every exit path — including the error one, or a failing run
// would hang until the workflow's timeout instead of failing fast.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePageUpBrowser);
