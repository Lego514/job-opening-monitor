import { type CompanySource, type Posting } from "../types";
import { type JobDetail } from "./workday";

/**
 * PageUp career sites (e.g. University of Delaware at careers.udel.edu).
 *
 * Unlike every other adapter here, this one needs a real browser. PageUp itself
 * serves the job table as plain server-rendered HTML — but UD fronts it with an
 * AWS WAF challenge that answers a plain `fetch` with HTTP 202 and a 2KB
 * JavaScript proof-of-work page. No header combination gets past it; the
 * challenge has to actually run. So we drive headless Chromium, let it solve the
 * challenge, and then parse the HTML it ends up with.
 *
 * Playwright is imported dynamically so a missing or broken browser install
 * fails only this source (collectAll catches it) instead of the whole run.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// The listing takes a page size; UD's full board is ~170 roles, so one generous
// page avoids pagination entirely (and one page load is one WAF challenge).
const PAGE_ITEMS = Number(process.env.PAGEUP_PAGE_ITEMS) || 500;
const NAV_TIMEOUT = 60_000;

/* ------------------------------------------------------------------ parsing */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Pure: turn a PageUp listing page's HTML into normalized Postings (unit-tested).
 *
 * Each row is `<a class="job-link" href="/en-us/job/{id}/{slug}">Title</a>`
 * followed by `<span class="location">`. We scan link-first and then look ahead
 * a bounded window for the location, so a row that omits a cell (some do) can't
 * swallow the next row's data.
 *
 * NOTE `postedOn` is deliberately left empty. The only date PageUp puts in the
 * listing is the *closing* date ("Closes: Sep 30 2026", often "Open until
 * filled"), and feeding that to postedDays() would read as a future posting and
 * corrupt the recency filter. Unknown age passes the filter, so UD roles reach
 * the alert path on their first sighting and the `seen` state stops repeats.
 */
export function normalizePageUp(c: CompanySource, html: string): Posting[] {
  const base = new URL(c.pageupUrl ?? "https://example.invalid").origin;
  const out: Posting[] = [];
  const linkRe = /<a[^>]*class="[^"]*job-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (let m = linkRe.exec(html); m; m = linkRe.exec(html)) {
    const href = m[1];
    const title = text(m[2]);
    if (!title) continue;

    // Look ahead only as far as the next job link, so a location-less row
    // doesn't inherit the following row's city.
    const rest = html.slice(m.index + m[0].length);
    const nextLink = rest.search(/<a[^>]*class="[^"]*job-link/);
    const window = nextLink === -1 ? rest : rest.slice(0, nextLink);
    const loc = /<span[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(window);

    out.push({
      id: /\/job\/(\d+)/.exec(href)?.[1] ?? href,
      company: c.name,
      title,
      location: loc ? text(loc[1]) : "",
      url: href.startsWith("http") ? href : base + href,
      postedOn: "", // closing date only — see the note above
      pageupDetail: href.startsWith("http") ? href : base + href,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ browser */

type Chromium = Awaited<typeof import("playwright")>["chromium"];
type LaunchedBrowser = Awaited<ReturnType<Chromium["launch"]>>;
type BrowserContext = Awaited<ReturnType<LaunchedBrowser["newContext"]>>;

let session: { browser: LaunchedBrowser; context: BrowserContext } | null = null;

/** Launch once and reuse: the launch costs ~1s and each WAF challenge a few more. */
async function getContext(): Promise<BrowserContext> {
  if (!session) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    session = { browser, context: await browser.newContext({ userAgent: USER_AGENT }) };
  }
  return session.context;
}

/**
 * Close the shared browser, if one was started. Safe to call unconditionally —
 * and necessary: a live Chromium keeps the Node process alive after main().
 */
export async function closePageUpBrowser(): Promise<void> {
  const s = session;
  session = null;
  if (s) await s.browser.close();
}

/**
 * Load a PageUp page through the browser and return its HTML once the WAF
 * challenge has resolved. `waitFor` is matched with state "attached", not
 * "visible": UD's rows live inside a collapsed filter panel, so they exist in
 * the DOM long before (or without ever) being visible.
 */
async function loadHtml(url: string, waitFor: string): Promise<string> {
  const page = await (await getContext()).newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForSelector(waitFor, { state: "attached", timeout: NAV_TIMEOUT });
    return await page.content();
  } finally {
    await page.close();
  }
}

/** Fetch every current posting from a PageUp career site. */
export async function fetchPageUp(c: CompanySource): Promise<Posting[]> {
  const url = new URL(c.pageupUrl ?? "");
  url.searchParams.set("page-items", String(PAGE_ITEMS));
  return normalizePageUp(c, await loadHtml(url.toString(), "a.job-link"));
}

/**
 * Pure: pull the JD text + location out of a PageUp job detail page
 * (unit-tested). The description body is everything after the header block;
 * `Location: <city>` sits in the same block, so both come from one parse.
 */
export function normalizePageUpDetail(html: string): JobDetail {
  // The JD lives in `<div id="job-details">` and runs until the "Applications
  // close:" footer line. Nested divs make a balanced-tag regex unreliable, so
  // cut on that trailing marker instead (falling back to the page footer).
  const start = html.indexOf('<div id="job-details"');
  const rest = start === -1 ? html : html.slice(start);
  const stop = rest.search(/Applications close:|class="back-link|<footer/);
  const description = text(stop === -1 ? rest : rest.slice(0, stop));

  // Same `.location` span the listing rows use: `<b>Location:</b> <span
  // class="location">Newark, DE</span>`.
  const loc = /<span[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  const city = loc ? text(loc[1]) : "";
  return { description, locations: city ? [city] : [] };
}

/** Fetch one PageUp posting's JD (for sponsorship / salary / remote signals). */
export async function fetchPageUpDetail(jobUrl: string): Promise<JobDetail> {
  return normalizePageUpDetail(await loadHtml(jobUrl, "body"));
}
