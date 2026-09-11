// Cross-reference an employer against real US government H-1B filings.
//
// The JD almost never says whether a company sponsors — `classifySponsorship`
// can only ever answer "no" or "unknown", and the LLM usually reads "silent".
// So the remaining manual step was looking every employer up by hand. This
// module replaces that with data: USCIS publishes a per-employer, per-fiscal-year
// H-1B Employer Data Hub export (approvals + denials, initial + continuing), and
// `scripts/build-sponsor-index.ts` aggregates the last few FYs into
// `data/sponsors.json`. Here we just load that file and match a posting's
// company name against it.
//
// Everything except `loadSponsorIndex` is pure and unit-tested; the monitor never
// touches the network for this.

import { readFileSync } from "node:fs";

/** Per-fiscal-year approval counts for one employer. */
export interface SponsorFyCounts {
  initial: number; // brand-new H-1B petitions approved (the number that matters for a new grad)
  continuing: number; // extensions/transfers approved — still proof the employer files
}

export interface SponsorEmployer {
  name: string; // display name, as USCIS spells it
  fy: Record<number, SponsorFyCounts>;
  states: string[]; // up to 3 states with the most filings
}

/** What gets attached to a posting (see `Posting.sponsorHistory`). */
export interface SponsorHistory {
  matched: string | null; // the USCIS display name we matched, or null
  initialApprovals: number; // initial approvals summed over the indexed FYs
  continuingApprovals: number;
  lastFy: number | null; // most recent FY with any approval
  fyRange: [number, number]; // the FY window the index covers
  confidence: "exact" | "fuzzy" | "none";
  states: string[];
  /** No match, but the index DOES hold employers sharing this name's first token
   *  — i.e. we probably failed to reach the right legal entity rather than
   *  proved an absence. Suppresses the "no filings found" line. */
  nearMiss: boolean;
}

/** Deserialized shape of `data/sponsors.json` (compact on purpose — see the script). */
export interface SponsorIndexFile {
  source: string;
  sourceUrl: string;
  generatedAt: string;
  fiscalYears: number[];
  /** `[displayName, countsPerFy, states]`; a year with no filings is encoded as `0`. */
  employers: [string, (number[] | 0)[], string][];
}

export interface SponsorIndex {
  source: string;
  generatedAt: string;
  fiscalYears: number[];
  /** normalized name -> employer (the exact-match path) */
  byName: Map<string, SponsorEmployer>;
  /** first normalized token -> employers starting with it (the fuzzy path) */
  byFirstToken: Map<string, SponsorEmployer[]>;
}

// Tokens that carry no identity: legal forms, and the connective words that a
// company writes one way and USCIS writes another ("JPMorgan Chase" vs
// "JPMORGAN CHASE & CO"). Dropping them is what makes the exact path work.
const NOISE_TOKENS = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation",
  "co", "company", "companies", "plc", "sa", "ag", "gmbh", "nv", "bv", "pte", "pvt",
  "holdings", "holding", "usa", "us", "na", "the", "and", "of", "a",
]);

/**
 * Canonical form of an employer name: lowercase, punctuation-free, legal-suffix-free.
 *
 * Two fixups earn their keep against the real USCIS spellings:
 *  - **possessives.** The ATS writes "Children's Hospital of Philadelphia"; USCIS
 *    writes "THE CHILDREN S HOSPITAL OF PHILADELPHIA". Deleting the apostrophe on
 *    one side and gluing the orphaned "s" back on the other lands both on
 *    "childrens hospital philadelphia".
 *  - **initials.** "W.L. Gore" tokenizes to `w l gore`, but USCIS files as
 *    "WL GORE & ASSOCIATES INC". Merging a run of single-letter tokens fixes both
 *    directions at once (and does the same for "M&T Bank" ↔ "M T BANK",
 *    "S&P Global" ↔ "S P GLOBAL").
 */
export function normalizeEmployer(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !NOISE_TOKENS.has(t));

  const possessive: string[] = [];
  for (const t of raw) {
    const prev = possessive[possessive.length - 1];
    if (t === "s" && prev && prev.length >= 2) possessive[possessive.length - 1] = prev + "s";
    else possessive.push(t);
  }

  const out: string[] = [];
  let initials: string[] = [];
  const flush = () => {
    if (initials.length) out.push(initials.join(""));
    initials = [];
  };
  for (const t of possessive) {
    if (t.length === 1) initials.push(t);
    else { flush(); out.push(t); }
  }
  flush();
  return out.join(" ");
}

export function employerTokens(name: string): string[] {
  const n = normalizeEmployer(name);
  return n ? n.split(" ") : [];
}

/**
 * Is `short` a prefix-anchored subset of `long`? That is the whole fuzzy rule:
 * every token of the shorter name appears in the longer one, AND they start with
 * the same token. The anchor is what stops "Delaware" from matching
 * "UNIVERSITY OF DELAWARE" and, more importantly, stops the tail of a long
 * conglomerate name from swallowing an unrelated short one.
 */
function isAnchoredSubset(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length > long.length) return false;
  if (short[0] !== long[0]) return false;
  const set = new Set(long);
  return short.every((t) => set.has(t));
}

/** Total initial/continuing approvals for an employer across the indexed FYs. */
function totals(e: SponsorEmployer): { initial: number; continuing: number; lastFy: number | null } {
  let initial = 0;
  let continuing = 0;
  let lastFy: number | null = null;
  for (const [fy, c] of Object.entries(e.fy)) {
    initial += c.initial;
    continuing += c.continuing;
    if (c.initial + c.continuing > 0) {
      const y = Number(fy);
      if (lastFy == null || y > lastFy) lastFy = y;
    }
  }
  return { initial, continuing, lastFy };
}

// How many index employers may share a one-word company's only token before the
// fuzzy pass gives up on it (see matchSponsor).
const MAX_ONE_WORD_CANDIDATES = 3;

/**
 * Match a posting's company name against the index.
 *
 * Two passes, deliberately in this order:
 *  1. **exact** on the normalized name — handles the overwhelming majority
 *     ("JPMorgan Chase" ↔ "JPMORGAN CHASE & CO" both normalize to "jpmorgan chase").
 *  2. **fuzzy**, prefix-anchored subset — handles the leftover legal tails
 *     ("W.L. Gore" ↔ "W L GORE & ASSOCIATES INC").
 *
 * The false-positive guards, both learned from real misfires against the FY21–23
 * index:
 *  - **one direction only.** The posting's name must be the *subset*; the index
 *    name may only add tokens (a legal tail), never drop one. Allowing the
 *    reverse matched "Children's Hospital of Philadelphia" to Boston's
 *    "CHILDRENS HOSPITAL CORPORATION" — dropping "philadelphia" changed the
 *    employer.
 *  - **single-word names must be nearly unambiguous.** "Comcast" only ever
 *    prefixes one filer, so `Comcast` → `COMCAST CABLE COMMUNICATIONS LLC` is
 *    safe; "Alloy" prefixes four unrelated ones, so it matches nothing rather
 *    than inherit "ALLOY STEEL"'s filings. The cutoff is `MAX_ONE_WORD_CANDIDATES`.
 *
 * Among several fuzzy candidates the least-padded name wins (fewest extra
 * tokens), tie-broken by filing volume; for a one-word name volume decides
 * outright (it picks the operating company out of a family of subsidiaries).
 * Every fuzzy match is shown to the reader WITH the matched name, so a bad call
 * is visible rather than silent.
 *
 * Returns `confidence: "none"` when nothing matched, so the caller can decide
 * whether the absence is meaningful (see `sponsorAbsenceIsMeaningful`).
 */
export function matchSponsor(index: SponsorIndex, company: string): SponsorHistory {
  const fyRange: [number, number] = [
    index.fiscalYears[0] ?? 0,
    index.fiscalYears[index.fiscalYears.length - 1] ?? 0,
  ];
  const none: SponsorHistory = {
    matched: null,
    initialApprovals: 0,
    continuingApprovals: 0,
    lastFy: null,
    fyRange,
    confidence: "none",
    states: [],
    nearMiss: false,
  };

  const tokens = employerTokens(company);
  if (tokens.length === 0) return none;
  const norm = tokens.join(" ");

  const hit = (e: SponsorEmployer, confidence: "exact" | "fuzzy"): SponsorHistory => {
    const t = totals(e);
    return {
      matched: e.name,
      initialApprovals: t.initial,
      continuingApprovals: t.continuing,
      lastFy: t.lastFy,
      fyRange,
      confidence,
      states: e.states,
      nearMiss: false,
    };
  };

  const exact = index.byName.get(norm);
  if (exact) return hit(exact, "exact");

  // Employers filing under the same first word. A non-empty bucket with no
  // subset match means "we couldn't reach the right legal entity", not "this
  // employer doesn't sponsor" — e.g. "CapTech Consulting" vs the index's
  // "CAPTECH VENTURES INC". That distinction is what `nearMiss` records.
  const bucket = index.byFirstToken.get(tokens[0]) ?? [];
  const nearMiss = { ...none, nearMiss: bucket.length > 0 };
  const candidates = bucket.filter((e) => isAnchoredSubset(tokens, employerTokens(e.name)));
  if (candidates.length === 0) return nearMiss;
  if (tokens.length < 2 && candidates.length > MAX_ONE_WORD_CANDIDATES) return nearMiss;

  const padding = (e: SponsorEmployer) => employerTokens(e.name).length - tokens.length;
  const volume = (e: SponsorEmployer) => {
    const t = totals(e);
    return t.initial + t.continuing;
  };
  const better = (b: SponsorEmployer, a: SponsorEmployer) =>
    tokens.length < 2
      ? volume(b) > volume(a)
      : padding(b) < padding(a) || (padding(b) === padding(a) && volume(b) > volume(a));
  const best = candidates.reduce((a, b) => (better(b, a) ? b : a));
  return hit(best, "fuzzy");
}

/**
 * Is "we found nothing" worth saying out loud?
 *
 * Only for a name specific enough that its absence from 85k employers means
 * something. A one-token name may well be a short form of a longer legal name
 * we simply failed to reach (the fuzzy pass refuses single tokens), so for those
 * we stay quiet rather than tell Ray a company doesn't sponsor when it might.
 */
export function sponsorAbsenceIsMeaningful(company: string): boolean {
  const tokens = employerTokens(company);
  return tokens.length >= 2 && tokens.join("").length >= 6;
}

/**
 * Alert line for a posting's sponsor history, or null when there's nothing useful
 * to say.
 *
 * "None found" is claimed only when the absence is real evidence: not for a
 * cap-exempt employer (it doesn't need cap H-1B history to be worth applying to,
 * and these are exactly the employers whose legal filing name differs most from
 * their brand — "Jefferson Health" files as "THOMAS JEFFERSON UNIVERSITY"), not
 * for a near miss, and not for a name too short to be distinctive.
 */
export function sponsorLine(
  h: SponsorHistory | undefined,
  company: string,
  capExempt = false,
): string | null {
  if (!h) return null;
  const [from, to] = h.fyRange;
  const span = from === to ? `FY${String(from).slice(2)}` : `FY${String(from).slice(2)}–${String(to).slice(2)}`;
  if (h.confidence === "none") {
    return !capExempt && !h.nearMiss && sponsorAbsenceIsMeaningful(company)
      ? `🛂 no H-1B filings found ${span}`
      : null;
  }
  const n = h.initialApprovals;
  const detail =
    n > 0
      ? `${n.toLocaleString("en-US")} initial approval${n === 1 ? "" : "s"}`
      : `${h.continuingApprovals.toLocaleString("en-US")} continuing approvals`;
  const hedge = h.confidence === "fuzzy" ? ` (~${h.matched})` : "";
  return `🛂 H-1B: ${detail} ${span}${hedge}`;
}

/** Does this employer have any H-1B filing history at all? Used for ranking. */
export function hasSponsorHistory(h: SponsorHistory | undefined): boolean {
  return !!h && h.confidence !== "none" && h.initialApprovals + h.continuingApprovals > 0;
}

/** Build the runtime index from the deserialized file. Pure — tested off a fixture. */
export function buildSponsorIndex(file: SponsorIndexFile): SponsorIndex {
  const byName = new Map<string, SponsorEmployer>();
  const byFirstToken = new Map<string, SponsorEmployer[]>();
  for (const [name, counts, states] of file.employers) {
    const fy: Record<number, SponsorFyCounts> = {};
    file.fiscalYears.forEach((year, i) => {
      const c = counts[i];
      if (c) fy[year] = { initial: c[0] ?? 0, continuing: c[1] ?? 0 };
    });
    const e: SponsorEmployer = { name, fy, states: states ? states.split("|") : [] };
    const norm = normalizeEmployer(name);
    if (!norm) continue;
    // Same normalized name from two spellings (e.g. "ACME INC" / "ACME LLC"):
    // keep the one with more filings, so the merged entry is the real employer.
    const prev = byName.get(norm);
    if (prev) {
      for (const [y, c] of Object.entries(e.fy)) {
        const p = prev.fy[Number(y)];
        prev.fy[Number(y)] = p
          ? { initial: p.initial + c.initial, continuing: p.continuing + c.continuing }
          : c;
      }
      continue;
    }
    byName.set(norm, e);
    const first = norm.split(" ")[0];
    const bucket = byFirstToken.get(first);
    if (bucket) bucket.push(e);
    else byFirstToken.set(first, [e]);
  }
  return {
    source: file.source,
    generatedAt: file.generatedAt,
    fiscalYears: file.fiscalYears,
    byName,
    byFirstToken,
  };
}

// ---------------------------------------------------------------------------
// Index construction from the raw USCIS export. Lives here (not in the script)
// so it is a pure function the test suite can drive off a small CSV fixture —
// the script itself is only download + write.

export interface HubRow {
  fy: number;
  employer: string;
  initial: number;
  continuing: number;
  state: string;
}

/** Split one CSV line, honouring `"quoted, fields"` and `""` escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse one fiscal year's Data Hub export.
 *
 * Columns are `Fiscal Year, Employer, Initial Approval, Initial Denial,
 * Continuing Approval, Continuing Denial, NAICS, Tax ID, State, City, ZIP` —
 * one row per employer *per city*, so the same employer appears many times and
 * has to be summed. Denials are deliberately ignored: a denied petition still
 * proves the employer files, and we don't want to editorialize on rates.
 * Rows with a blank employer name (USCIS redacts a few) are dropped.
 */
export function parseHubCsv(text: string): HubRow[] {
  const rows: HubRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const employer = (f[1] ?? "").trim();
    if (!employer) continue;
    rows.push({
      fy: Number(f[0]) || 0,
      employer,
      initial: Number(f[2]) || 0,
      continuing: Number(f[4]) || 0,
      state: (f[8] ?? "").trim().toUpperCase(),
    });
  }
  return rows;
}

/**
 * Fold `{fy -> rows}` into the compact serialized index.
 *
 * Employers are keyed on the normalized name so the many city rows — and the
 * "ACME INC" / "ACME LLC" spelling drift between years — collapse into one
 * entry; the display name kept is the most common spelling. Employers with zero
 * approvals across the whole window are dropped (they only ever had denials),
 * which is what keeps the file to a few MB.
 */
export function aggregateHubRows(
  byFy: Map<number, HubRow[]>,
  opts: { source: string; sourceUrl: string; generatedAt: string },
): SponsorIndexFile {
  const fiscalYears = [...byFy.keys()].sort((a, b) => a - b);
  interface Acc {
    names: Map<string, number>; // spelling -> row count, to pick a display name
    fy: Map<number, [number, number]>;
    states: Map<string, number>;
  }
  const acc = new Map<string, Acc>();
  for (const fy of fiscalYears) {
    for (const r of byFy.get(fy) ?? []) {
      const key = normalizeEmployer(r.employer);
      if (!key) continue;
      let a = acc.get(key);
      if (!a) { a = { names: new Map(), fy: new Map(), states: new Map() }; acc.set(key, a); }
      a.names.set(r.employer, (a.names.get(r.employer) ?? 0) + 1);
      const cur = a.fy.get(fy) ?? [0, 0];
      a.fy.set(fy, [cur[0] + r.initial, cur[1] + r.continuing]);
      if (r.state) a.states.set(r.state, (a.states.get(r.state) ?? 0) + r.initial + r.continuing);
    }
  }

  const employers: SponsorIndexFile["employers"] = [];
  for (const a of acc.values()) {
    const counts = fiscalYears.map((fy) => {
      const c = a.fy.get(fy);
      return c && c[0] + c[1] > 0 ? c : (0 as const);
    });
    if (counts.every((c) => c === 0)) continue; // denials only — no evidence of sponsorship
    const name = [...a.names].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    const states = [...a.states]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 3)
      .map(([s]) => s);
    employers.push([name, counts, states.join("|")]);
  }
  employers.sort((a, b) => a[0].localeCompare(b[0]));
  return { ...opts, fiscalYears, employers };
}

let cached: SponsorIndex | null | undefined;

/**
 * Load `data/sponsors.json` once per process.
 *
 * A missing or unreadable index is NOT fatal: the monitor just runs without the
 * sponsor signal, exactly as it did before this existed. Returns null in that
 * case (logged once).
 */
export function loadSponsorIndex(): SponsorIndex | null {
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(new URL("../data/sponsors.json", import.meta.url), "utf8");
    cached = buildSponsorIndex(JSON.parse(raw) as SponsorIndexFile);
  } catch (e) {
    console.error(`[sponsor] index unavailable — continuing without it: ${(e as Error).message}`);
    cached = null;
  }
  return cached;
}
