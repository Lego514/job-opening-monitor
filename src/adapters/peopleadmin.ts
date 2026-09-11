import { type CompanySource, type Posting } from "../types";

/**
 * PeopleAdmin — the dominant higher-ed ATS (Rutgers, Villanova, Fordham,
 * Hofstra, Delaware Tech …). Every instance publishes its whole open board as a
 * public Atom feed at `/postings/search.atom`: no key, no pagination, and the
 * `<content>` element carries the full HTML job description, so these postings
 * need no per-role detail fetch (same shortcut as Lever/Ashby).
 *
 * Field coverage varies by institution: Rutgers emits `<pa:city>`/`<pa:state>`,
 * while Villanova/Fordham/Hofstra/DTCC emit neither. For those, `paLocation` on
 * the source supplies the campus city so the location filter (and the
 * Delaware-wide-net check) has something to work with.
 *
 * All of these employers are universities, i.e. H-1B cap-exempt — the reason
 * this adapter exists.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" doesn't become "<"
}

/** Read one XML element's text from an entry, or "" if absent/self-closing. */
function tag(entry: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(entry);
  return m ? decodeEntities(m[1]).trim() : "";
}

/** Strip HTML down to plain text (the JD arrives as escaped markup). */
function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure: turn a PeopleAdmin Atom feed into normalized Postings (unit-tested).
 *
 * `<published>` is a full ISO timestamp, which postedDays() already parses — so
 * unlike the PageUp sources these do carry an age and respect MAX_AGE_DAYS.
 */
export function normalizePeopleAdmin(c: CompanySource, xml: string): Posting[] {
  const out: Posting[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  for (let m = entryRe.exec(xml); m; m = entryRe.exec(xml)) {
    const entry = m[1];
    const title = tag(entry, "title");
    if (!title) continue;

    const id = tag(entry, "id");
    const href = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry)?.[1];
    const url = decodeEntities(href ?? id);
    const city = tag(entry, "pa:city");
    const state = tag(entry, "pa:state");
    const feedLocation = [city, state].filter(Boolean).join(", ");

    out.push({
      id: /\/postings\/(\d+)/.exec(id || url)?.[1] || url,
      company: c.name,
      title,
      location: feedLocation || c.paLocation || "",
      url,
      postedOn: tag(entry, "published").slice(0, 10),
      // The feed already carries the JD, so enrichment needs no extra request.
      // (Empty for the institutions that publish a bare <content/>.)
      description: plain(tag(entry, "content")),
    });
  }
  return out;
}

/** Fetch a PeopleAdmin institution's whole open board (one unauthenticated GET). */
export async function fetchPeopleAdmin(c: CompanySource): Promise<Posting[]> {
  const res = await fetch(`https://${c.paHost}/postings/search.atom`, {
    headers: { Accept: "application/atom+xml, application/xml", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PeopleAdmin ${c.name} HTTP ${res.status}`);
  return normalizePeopleAdmin(c, await res.text());
}
