import { type CompanySource, type Posting } from "../types";
import { US_STATE_NAMES } from "../match";

/**
 * Job-alert emails, read over IMAP.
 *
 * Every other source here is polled directly. Five boards cannot be: Handshake
 * is behind school SSO, and LinkedIn / ZipRecruiter / Glassdoor / part of Indeed
 * sit behind Cloudflare, a WAF or hard rate limits. None of that is worth
 * fighting — no proxy rotation, no CAPTCHA solving, no automated SSO. But every
 * one of them will *push* its inventory to an inbox if you save a search with
 * email alerts turned on, so this adapter reads those alert emails instead.
 * No bot detection is involved, and a site redesigning its search UI doesn't
 * break it.
 *
 * Like `githublist` and `jobspy`, one "source" is not one employer:
 * `CompanySource.name` is a log label and every row carries its own company.
 * `Posting.via` names the alert ("Handshake alert", "LinkedIn alert", …).
 *
 * **Parse links, not layout.** These templates are regenerated constantly and no
 * two sends are structurally identical, so nothing here pins a table shape: the
 * parser pulls every anchor out of the HTML, keeps the hrefs whose *URL shape*
 * says "this is a job posting" (JOB_URL_SHAPES below), and takes the anchor text
 * as the title. Company and location are read from the text around the anchor,
 * which is the only genuinely layout-dependent step — and when it can't be read
 * the company falls back to the alert source rather than to a guess.
 *
 * Degradation, in order of likelihood:
 *  - No `ALERT_INBOX_USER` / `ALERT_INBOX_APP_PASSWORD` (the local dry run, and
 *    CI until the secrets exist): one log line, zero rows.
 *  - IMAP unreachable / auth rejected / a slow inbox past the time budget: the
 *    error is logged and whatever was parsed so far is returned.
 *  - One unparseable message: skipped, never thrown.
 * **This adapter must never throw** and must never mutate the mailbox — it opens
 * READ-ONLY, so nothing is marked as read and no flag is touched.
 *
 * There is no JD to fetch (the email only carries a title, and often not even a
 * company), so `description` is left unset and the LLM stage judges from the
 * title + location alone — `buildUserPrompt` has an explicit branch for that.
 */

// ---------------------------------------------------------------------------
// URL shapes — the table that decides "is this anchor a job?"
// ---------------------------------------------------------------------------

export interface JobUrlShape {
  /** Id namespace, so two boards' ids can never collide in `Posting.id`. */
  key: string;
  /** Label for `via` ("<source> alert") and the company fallback. */
  source: string;
  /** Tested against the URL's hostname. */
  host: RegExp;
  /** Tested against the pathname. Capture group 1, when present, is the job id. */
  path: RegExp;
  /** …or the id lives in a query param (Indeed's `jk`, Glassdoor's `jobListingId`). */
  idParams?: string[];
  /** Query params kept on the stored URL (defaults to `idParams`). Everything
   *  else is dropped: alert links are drenched in per-send tracking params, and
   *  two sends of the same job must produce the same URL or dedup fails. */
  keepParams?: string[];
  /** Post-process a path capture (LinkedIn's slug carries the id in its tail). */
  idFromPath?: (captured: string) => string;
  /** Rewrite the stored path to the board's canonical one (LinkedIn's `/comm/`
   *  prefix is an email-only alias for the same page), so a row here can still
   *  dedupe against the same job arriving from another source. */
  rewritePath?: (path: string) => string;
}

/**
 * Known job-URL shapes, newest-first by how much we trust them. Extending this
 * is the intended way to add a board: one row, no other change.
 *
 * Verified against the boards' public URL formats, NOT yet against a real alert
 * send for every provider — see the README note. A shape that turns out to be
 * wrong shows up in `npm run alerts -- --dump` as a message that yielded zero
 * links, which is exactly what that command exists for.
 */
export const JOB_URL_SHAPES: JobUrlShape[] = [
  {
    // app.joinhandshake.com/jobs/7654321 — also /stu/jobs/… and /emp/jobs/…
    key: "handshake",
    source: "Handshake",
    host: /(^|\.)joinhandshake\.com$/i,
    path: /\/jobs\/(\d+)/i,
  },
  {
    // linkedin.com/comm/jobs/view/4123456789 (the /comm/ prefix is email-only),
    // or a slug whose tail is the id: /jobs/view/data-analyst-at-acme-4123456789
    key: "linkedin",
    source: "LinkedIn",
    host: /(^|\.)linkedin\.com$/i,
    path: /\/(?:comm\/)?jobs\/view\/([^/?#]+)/i,
    idParams: ["currentJobId"],
    keepParams: ["currentJobId"],
    idFromPath: (s) => /(\d{6,})$/.exec(s)?.[1] ?? s,
    rewritePath: (p) => p.replace(/^\/comm\//i, "/"),
  },
  {
    // indeed.com/rc/clk?jk=… · /viewjob?jk=… · /pagead/clk?… (sponsored) · /m/… (mobile)
    key: "indeed",
    source: "Indeed",
    host: /(^|\.)indeed\.com$/i,
    path: /^\/(?:m\/)?(?:rc\/clk|viewjob|pagead\/clk|job)\b/i,
    idParams: ["jk"],
    // `/rc/clk?jk=…` is a click redirector for the page at `/viewjob?jk=…`.
    // Storing the canonical one means an alert row dedupes against the same req
    // arriving from the JobSpy scraper, which publishes `/viewjob?jk=`.
    rewritePath: (p) => (/^\/(?:m\/)?(?:rc\/clk|viewjob)/i.test(p) ? "/viewjob" : p),
  },
  {
    // ziprecruiter.com/c/Acme/Job/Data-Analyst/-in-Wilmington,DE?jid=…
    // ziprecruiter.com/jobs/acme-1a2b3c/data-analyst-4d5e6f
    key: "ziprecruiter",
    source: "ZipRecruiter",
    host: /(^|\.)ziprecruiter\.com$/i,
    path: /^\/(?:jobs|c|k|job)\//i,
    idParams: ["jid", "lvk"],
  },
  {
    // glassdoor.com/job-listing/data-analyst-acme-JV_IC1234_KO0,12.htm
    // glassdoor.com/partner/jobListing.htm?…&jobListingId=1009876543
    // NOT `/Job/<city>-<title>-jobs-SRCH_…htm` — that is Glassdoor's search page,
    // which is what the "see all jobs" button in these alerts points at.
    key: "glassdoor",
    source: "Glassdoor",
    host: /(^|\.)glassdoor\.(com|[a-z]{2,3}(\.[a-z]{2})?)$/i,
    path: /^\/(?:job-listing\/|partner\/jobListing\.htm)/i,
    idParams: ["jobListingId", "jl"],
  },
];

/** Query params whose value is the *real* destination, wrapped by a click
 *  tracker. Checked in order; the first one holding an http(s) URL wins. */
const REDIRECT_PARAMS = [
  "url",
  "targeturl",
  "target_url",
  "redirect",
  "redirect_url",
  "redirecturl",
  "destination",
  "dest",
  "deeplink",
  "deep_link_url",
  "link",
  "u",
  "q",
];

/** FNV-1a 32-bit — a stable id for a job whose URL carries no explicit one. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  bull: "•",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/** Decode the HTML entities that actually appear in these templates (plus any
 *  numeric one). Pure — the parser runs over raw email HTML, never a DOM. */
export function decodeEntities(s: string): string {
  return (s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/**
 * Follow a click-tracking wrapper to the URL it actually points at.
 *
 * Two shapes, both common in these sends:
 *  - the destination sits in a query param (`?url=https%3A%2F%2F…`);
 *  - the destination is embedded in the *path*, SendGrid-style
 *    (`…/CL0/https:%2F%2Fapp.joinhandshake.com%2Fjobs%2F1/1/0100…`).
 * Bounded to a few hops so a self-referential wrapper can't spin.
 */
export function unwrapTracking(raw: string, depth = 0): string {
  const url = (raw ?? "").trim();
  if (!url || depth >= 4) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  for (const p of REDIRECT_PARAMS) {
    for (const [k, v] of u.searchParams.entries()) {
      if (k.toLowerCase() !== p) continue;
      const inner = decodeMaybe(v);
      if (/^https?:\/\//i.test(inner) && inner !== url) return unwrapTracking(inner, depth + 1);
    }
  }
  // Embedded-in-path form. Skip the first character of the string so the wrapper's
  // own scheme never matches, and take the LAST embedded URL (trackers nest).
  const embedded = [...url.slice(1).matchAll(/https?(?::|%3A)(?:\/|%2F){2}[^\s"'<>]+/gi)].map(
    (m) => m[0],
  );
  const last = embedded[embedded.length - 1];
  if (last) {
    const inner = decodeMaybe(last);
    if (/^https?:\/\//i.test(inner) && inner !== url) return unwrapTracking(inner, depth + 1);
  }
  return url;
}

function decodeMaybe(s: string): string {
  const once = s.replace(/%2F/gi, "/").replace(/%3A/gi, ":");
  try {
    return decodeURIComponent(once);
  } catch {
    return once; // a stray % that isn't an escape — use what we have
  }
}

export interface JobLink {
  key: string; // shape key, e.g. "handshake"
  source: string; // "Handshake"
  id: string; // site job id (or a hash when the URL carries none)
  url: string; // tracking-free application URL
}

/**
 * Does this href point at a job posting on a board we know? Returns the source,
 * the site's own job id and a stripped URL — or null, which is the answer for
 * every unsubscribe link, logo link, "see all jobs" button and footer link.
 *
 * Pure + unit-tested; this is the function the whole adapter's precision rests on.
 */
export function matchJobUrl(href: string): JobLink | null {
  const cleaned = unwrapTracking(decodeEntities((href ?? "").trim()));
  if (!cleaned) return null;
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  for (const shape of JOB_URL_SHAPES) {
    if (!shape.host.test(u.hostname)) continue;
    const m = shape.path.exec(u.pathname);
    if (!m) continue;
    const path = (shape.rewritePath ? shape.rewritePath(u.pathname) : u.pathname).replace(/\/+$/, "");
    const fromPath = m[1] ? (shape.idFromPath ? shape.idFromPath(m[1]) : m[1]) : "";
    const explicit = (firstParam(u, shape.idParams ?? []) || fromPath).trim();
    if (explicit) {
      // The id is in the URL, so the URL can be reduced to its canonical form:
      // everything but the identifying params goes, and two sends of the same job
      // produce byte-identical URLs.
      return {
        key: shape.key,
        source: shape.source,
        id: explicit.toLowerCase(),
        url: rebuild(u, path, shape.keepParams ?? shape.idParams ?? []),
      };
    }
    // No id anywhere — an Indeed `pagead/clk` sponsored link, a ZipRecruiter
    // slug, a Glassdoor `job-listing` page. The query IS part of the identity
    // here, so keep it (minus known tracking noise, which changes per send) and
    // hash the result. Stripping it instead would collapse every sponsored link
    // in the run onto the single URL `indeed.com/pagead/clk`.
    const url = rebuild(u, path, null);
    return { key: shape.key, source: shape.source, id: hashId(url), url };
  }
  return null;
}

/** Params that only say where a click came from — they differ between two sends
 *  of the same job, so they must not reach an id or a dedup key. */
const TRACKING_PARAMS = new Set([
  "tk", "from", "fromjk", "vjs", "trk", "trkinfo", "refid", "trackingid", "midtoken",
  "midsig", "eid", "otptoken", "lipi", "licu", "gclid", "fbclid", "mc_cid", "mc_eid",
  "_hsenc", "_hsmi", "src", "source", "ref", "campaign", "campaignid", "sid", "cid",
  "email_source", "guid", "ea", "s", "ao", "pos",
]);

function isTracking(k: string): boolean {
  const n = k.toLowerCase();
  return n.startsWith("utm_") || TRACKING_PARAMS.has(n);
}

/** Rebuild a URL keeping either an explicit allow-list of params (`keep`), or —
 *  when `keep` is null — everything that isn't obvious tracking noise. */
function rebuild(u: URL, path: string, keep: string[] | null): string {
  const allow = keep?.map((k) => k.toLowerCase());
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => (allow ? allow.includes(k.toLowerCase()) : !isTracking(k)))
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return `${u.protocol}//${u.host}${path || "/"}${kept.length ? `?${kept.join("&")}` : ""}`;
}

function firstParam(u: URL, names: string[]): string {
  for (const n of names) {
    for (const [k, v] of u.searchParams.entries()) {
      if (k.toLowerCase() === n.toLowerCase() && v.trim()) return v.trim();
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// HTML -> anchors -> postings
// ---------------------------------------------------------------------------

interface Anchor {
  href: string;
  text: string;
  start: number; // index of "<a" in the source HTML
  end: number; // index just past "</a>"
}

/** Every `<a href=…>` in the document, with its plain-text label and position.
 *  Regex rather than a DOM parser on purpose: email HTML is frequently invalid
 *  (unclosed tags, Outlook conditional comments) and a strict parser would
 *  throw away the whole message over one of them. */
export function extractAnchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  // The label capture refuses to cross another `<a`, so one unclosed anchor —
  // these templates are full of invalid HTML — can't swallow the next job's card
  // and turn it into a 400-character "title".
  const re = /<a\b([^>]*)>((?:(?!<a\b)[\s\S])*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) {
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!href) continue;
    out.push({
      href: (href[1] ?? href[2] ?? href[3] ?? "").trim(),
      text: htmlToText(m[2]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Tags -> nothing, block boundaries -> newlines, entities decoded. */
function htmlToText(html: string): string {
  return decodeEntities(
    (html ?? "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|td|tr|li|h[1-6]|table)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Generic anchor labels that are a button, not a job title. */
const GENERIC_TEXT =
  /^(apply|apply now|view job|view details?|see job|see details?|view|details?|learn more|read more|(see|view|show|browse) (all|more)\b.*|more jobs\b.*|unsubscribe\b.*|manage (your )?(alerts?|preferences|settings)|(email )?(preferences|settings)|jobs?|save|saved|share|open|click here|here|next|previous|home)$/i;

/** Lines around an anchor that are chrome, not company/location. */
const NOISE_SEGMENT =
  /^(new|promoted|actively hiring|easy apply|be an early applicant|reposted?|hiring|sponsored|featured|recommended|urgently hiring|full[- ]time|part[- ]time|contract|internship|temporary|apply|apply now|view job|save|saved|\d+\s*(new )?(applicants?|connections?)|posted .*|\d+\s*(minutes?|hours?|days?|weeks?|months?)\s*ago|via .*|\$.*|[\d\W_]+)$/i;

const STATE_ABBR =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const STATE_NAME = new RegExp(`\\b(${US_STATE_NAMES.join("|")})\\b`, "i");

/** Does this fragment read like a place rather than a company? */
export function looksLikeLocation(s: string): boolean {
  const t = (s ?? "").trim();
  if (!t || t.length > 70) return false;
  // Whole-string only for the country words: "US Bank" and "USA Today" are
  // employers, and mistaking one for a place costs us the employer name.
  if (/^(anywhere|nationwide|united states|usa|u\.s\.?|us)$/i.test(t)) return true;
  if (/^remote\b/i.test(t)) return true; // "Remote", "Remote (United States)", "Remote - US"
  if (STATE_ABBR.test(t)) return true; // "Wilmington, DE"
  if (/\b(remote|hybrid|on-?site)\b/i.test(t)) return true;
  return STATE_NAME.test(t) && /,/.test(t); // "Philadelphia, Pennsylvania"
}

/** Split a context line into the fragments these templates concatenate with. */
function segments(line: string): string[] {
  return line
    .split(/\s[·•|]\s|\s[–—]\s|\s-\s/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export interface DerivedMeta {
  company: string;
  location: string;
}

/**
 * Read company + location out of the text surrounding a job link.
 *
 * The shape is nearly always "Company · City, ST" or the same pair on
 * consecutive lines, immediately after the title link. This is the one part of
 * the parser that depends on layout, so it is deliberately forgiving: it drops
 * chrome ("Promoted", "3 days ago", "Easy Apply"), finds the first fragment that
 * reads like a place, and takes the fragment before it as the employer.
 *
 * When it finds nothing, `company` is returned empty and the caller substitutes
 * the alert source — a wrong employer name is worse than a vague one, because
 * the USCIS sponsor lookup, the tracker row and dedup all key on it.
 */
export function deriveMeta(context: string[], title: string): DerivedMeta {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const t = norm(title);
  const frags: string[] = [];
  for (const line of context) {
    for (const seg of segments(line)) {
      if (!seg || seg.length > 90) continue;
      if (norm(seg) === t) continue; // the title repeated as alt text
      if (NOISE_SEGMENT.test(seg)) continue;
      frags.push(seg);
    }
  }
  const locIdx = frags.findIndex(looksLikeLocation);
  const locations = frags.filter(looksLikeLocation).slice(0, 3);
  let company = "";
  if (locIdx > 0) company = frags[locIdx - 1];
  else if (locIdx === -1) company = frags[0] ?? "";
  // Location first (some templates lead with the city): take the next fragment
  // that isn't itself a place. If there is none, the company is in an image alt
  // we can't read or in the subject line — leave it to the caller.
  else company = frags.slice(1).find((f) => !looksLikeLocation(f)) ?? "";
  return { company: cleanCompany(company), location: locations.join(" · ") };
}

function cleanCompany(s: string): string {
  const c = (s ?? "")
    .replace(/\s*\blogo\b\s*$/i, "") // "Acme Corp logo" (image alt text)
    .replace(/^\s*(at|by|from)\s+/i, "")
    .replace(/[\s,·•|–—-]+$/, "")
    .trim();
  // Anything this long is a sentence from the body, not an employer name.
  return c.length > 0 && c.length <= 80 && looksLikeLocation(c) === false ? c : "";
}

export interface AlertMeta {
  /** Sender address, used only for the diagnostic log. */
  from?: string;
  subject?: string;
  /** The email's Date header. */
  date?: Date | string;
}

/** "YYYY-MM-DD" from the email's Date header, or "" (= unknown age, passes). */
export function isoDay(d: Date | string | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

/**
 * Pure: one alert email's HTML -> Postings. Unit-tested against synthesized
 * fixtures for every provider.
 *
 * Never throws — a message that yields nothing yields an empty array, which is
 * the signal `npm run alerts -- --dump` writes to disk so the parser can be
 * refined against a real send.
 */
export function normalizeEmailAlerts(html: string, meta: AlertMeta = {}): Posting[] {
  const anchors = extractAnchors(html ?? "");
  const postedOn = isoDay(meta.date);
  const out: Posting[] = [];
  for (let i = 0; i < anchors.length; i++) {
    try {
      const a = anchors[i];
      const link = matchJobUrl(a.href);
      if (!link) continue;
      const title = a.text.replace(/\s+/g, " ").trim();
      // An image-only anchor (the logo next to the real link) or a bare "Apply"
      // button. Both point at a job, neither names one — and the same job's real
      // title link is nearly always a few bytes away in the same block.
      if (!title || title.length > 160 || GENERIC_TEXT.test(title)) continue;
      const after = contextAfter(html, a.end, anchors[i + 1]?.start);
      const { company: fwd, location } = deriveMeta(after, title);
      // Some templates put the employer ABOVE the title (Glassdoor's card header
      // is `<div>Company</div><a>Title</a>`), so fall back to looking backwards —
      // but only for the company, and only within the same card. Inheriting the
      // PREVIOUS job's location would be worse than having none, and an unknown
      // location passes the location filter anyway.
      const company = fwd || deriveMeta(contextBefore(html, anchors[i - 1]?.end ?? 0, a.start), title).company;
      out.push({
        id: `${link.key}:${link.id}`,
        // Never guess an employer: an unknown one is named after the alert, so a
        // wrong name can't poison the sponsor lookup or the tracker row.
        company: company || link.source,
        title,
        location,
        url: link.url,
        postedOn,
        via: `${link.source} alert`,
        // No JD exists — the email carries a title and (maybe) a teaser. The LLM
        // stage has an explicit "judge from the title alone" branch for this.
      });
    } catch {
      continue; // one bad anchor never costs us the message
    }
  }
  return mergeAlerts(out);
}

/** The text just AFTER a job link — normally "Company · City, ST" — stopping at
 *  the next anchor (i.e. the next job's card) or 400 characters in. */
function contextAfter(html: string, from: number, to: number | undefined): string[] {
  const end = Math.min(to ?? from + 400, from + 400, (html ?? "").length);
  return lines(html.slice(from, Math.max(from, end))).slice(0, 6);
}

/** Row-level tags. Sibling `<div>`/`<p>`/`<br>` inside one card are NOT
 *  boundaries — that is exactly where a company name sits — but a table cell or
 *  row is, because crossing one means we've walked into the previous job. */
const CARD_BOUNDARY = /<\/?(?:td|tr|table|tbody|body)\b[^>]*>/gi;

/** The text just BEFORE a job link, cut at the last card boundary so it can only
 *  ever see this job's own card. Last lines only: the company is whatever sits
 *  immediately above the title. */
function contextBefore(html: string, from: number, to: number): string[] {
  const slice = (html ?? "").slice(Math.max(from, to - 400), Math.max(0, to));
  let cut = 0;
  for (const m of slice.matchAll(CARD_BOUNDARY)) cut = (m.index ?? 0) + m[0].length;
  return lines(slice.slice(cut)).slice(-2);
}

function lines(html: string): string[] {
  if (!html) return [];
  return htmlToText(html)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Collapse re-alerts of the same job.
 *
 * Boards re-send the same posting for days, and Ray will have several saved
 * searches whose results overlap. The first copy wins (its email is the oldest,
 * so its date is closest to the real posting date) — but a later copy that names
 * the employer upgrades a copy that had to fall back to the source name, because
 * `postingKey` is `company:id` and a stable, real company name is worth more
 * than a stable fallback.
 */
export function mergeAlerts(list: Posting[]): Posting[] {
  const byId = new Map<string, Posting>();
  for (const p of list) {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, p);
      continue;
    }
    const prevIsFallback = prev.company === (prev.via ?? "").replace(/ alert$/, "");
    const nextIsFallback = p.company === (p.via ?? "").replace(/ alert$/, "");
    if (prevIsFallback && !nextIsFallback) prev.company = p.company;
    if (!prev.location && p.location) prev.location = p.location;
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// IMAP
// ---------------------------------------------------------------------------

export interface InboxConfig {
  user: string;
  pass: string;
  host: string;
  port: number;
  mailbox: string;
  days: number;
  maxMessages: number;
  budgetMs: number;
}

function intOr(v: string | undefined, fallback: number): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read the inbox settings, or null when it isn't configured.
 *
 * Null is the normal state locally and in CI until the secrets exist, so it must
 * be a quiet skip and never an error. Note the empty-string trap: an unset
 * GitHub Actions secret arrives as `""`, not as an absent variable.
 */
export function inboxConfig(env: NodeJS.ProcessEnv = process.env): InboxConfig | null {
  const user = (env.ALERT_INBOX_USER ?? "").trim();
  const pass = (env.ALERT_INBOX_APP_PASSWORD ?? "").trim();
  if (!user || !pass) return null;
  return {
    user,
    pass,
    host: (env.ALERT_INBOX_HOST ?? "").trim() || "imap.gmail.com",
    port: intOr(env.ALERT_INBOX_PORT, 993),
    mailbox: (env.ALERT_INBOX_MAILBOX ?? "").trim() || "INBOX",
    days: intOr(env.ALERT_INBOX_DAYS, 3),
    maxMessages: intOr(env.ALERT_INBOX_MAX_MESSAGES, 200),
    budgetMs: intOr(env.ALERT_INBOX_BUDGET_SEC, 90) * 1000,
  };
}

/** One message, as the diagnostic command sees it. */
export interface AlertMessage {
  uid: number;
  from: string;
  subject: string;
  date: string; // ISO
  html: string; // the HTML part (or the text part, when there is no HTML)
  postings: Posting[];
}

export interface InboxReadResult {
  postings: Posting[];
  messages: number; // messages actually parsed
  matched: number; // messages in the date window (before the cap)
  errors: number; // messages that threw (skipped)
  stopped: "" | "cap" | "budget";
}

/**
 * Connect, read the recent messages READ-ONLY, hand each one to `onMessage`.
 *
 * Bounded three ways, because this runs inside a 15-minute cron: the date window
 * (`ALERT_INBOX_DAYS`), a message cap, and a wall-clock budget. Everything is
 * per-message try/catch, and the mailbox is opened read-only so Ray's mail is
 * never marked as read.
 */
export async function readAlertInbox(
  cfg: InboxConfig,
  onMessage?: (m: AlertMessage) => void,
): Promise<InboxReadResult> {
  const started = Date.now();
  const result: InboxReadResult = {
    postings: [],
    messages: 0,
    matched: 0,
    errors: 0,
    stopped: "",
  };
  // Imported lazily: the unit tests exercise the parser only, and an unconfigured
  // run should never pay to load the IMAP + MIME stack.
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, // imapflow's default logger is very chatty pino JSON
    // This is a read-and-leave client, not a long-lived listener: an auto-IDLE
    // between commands would cost two extra round-trips each and keep the event
    // loop alive after the last fetch.
    disableAutoIdle: true,
    // A hung socket must not eat the run's budget.
    greetingTimeout: 15_000,
    connectionTimeout: 20_000,
    socketTimeout: 60_000,
  });

  let broke = false;
  await client.connect();
  try {
    // READ-ONLY: no \Seen flag is ever set, no flag is mutated. Ray's inbox looks
    // exactly the same after a run as it did before.
    await client.mailboxOpen(cfg.mailbox, { readOnly: true });
    const since = new Date(Date.now() - cfg.days * 86_400_000);
    const found = await client.search({ since }, { uid: true });
    const uids = Array.isArray(found) ? found : [];
    result.matched = uids.length;
    // Newest messages first when the cap bites — an old alert is a re-alert.
    const wanted = uids.slice(-cfg.maxMessages);
    if (wanted.length < uids.length) result.stopped = "cap";
    if (wanted.length === 0) return result;

    for await (const msg of client.fetch(
      wanted,
      { uid: true, envelope: true, source: { maxLength: 1_000_000 } },
      { uid: true },
    )) {
      if (Date.now() - started > cfg.budgetMs) {
        result.stopped = "budget";
        broke = true;
        break;
      }
      try {
        const env = msg.envelope ?? {};
        const from = env.from?.[0]?.address ?? "";
        const subject = env.subject ?? "";
        const date = env.date ?? msg.internalDate;
        let html = "";
        if (msg.source) {
          const parsed = await simpleParser(msg.source);
          html = (typeof parsed.html === "string" ? parsed.html : "") || parsed.textAsHtml || "";
        }
        const postings = normalizeEmailAlerts(html, { from, subject, date });
        result.messages++;
        result.postings.push(...postings);
        onMessage?.({
          uid: msg.uid,
          from,
          subject,
          date: date ? new Date(date).toISOString() : "",
          html,
          postings,
        });
      } catch (e) {
        result.errors++;
        console.error(`[alerts] message uid ${msg.uid}: ${(e as Error).message}`);
      }
    }
  } finally {
    // Breaking out of a fetch generator leaves the connection mid-command, so
    // close it hard rather than trying a graceful LOGOUT that would hang.
    try {
      if (broke) client.close();
      else await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
  }
  return result;
}

/**
 * Adapter entry point. Never throws: a missing inbox, an auth failure or a slow
 * server all degrade to "this optional source produced nothing this run", which
 * is a normal outcome — exactly like the JobSpy file adapter.
 */
export async function fetchEmailAlerts(c: CompanySource): Promise<Posting[]> {
  const cfg = inboxConfig(process.env);
  if (!cfg) {
    console.log(`[fetch] ${c.name}: skipped (no inbox configured)`);
    return [];
  }
  try {
    const r = await readAlertInbox(cfg);
    const merged = mergeAlerts(r.postings);
    console.log(
      `[alerts] ${cfg.mailbox}@${cfg.host}: ${r.messages} message(s) in the last ${cfg.days}d → ` +
        `${merged.length} job link(s)` +
        (r.errors ? `, ${r.errors} unreadable` : "") +
        (r.stopped === "cap" ? `, capped at ${cfg.maxMessages} of ${r.matched}` : "") +
        (r.stopped === "budget" ? `, stopped at the ${cfg.budgetMs / 1000}s budget` : ""),
    );
    return merged;
  } catch (e) {
    // Loud, but not fatal: the other ~115 sources still ran.
    console.error(`[fetch] ${c.name}: IMAP failed — ${(e as Error).message}`);
    return [];
  }
}
