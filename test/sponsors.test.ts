import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeEmployer,
  parseCsvLine,
  parseHubCsv,
  aggregateHubRows,
  buildSponsorIndex,
  matchSponsor,
  sponsorLine,
  sponsorAbsenceIsMeaningful,
  hasSponsorHistory,
  type SponsorIndex,
} from "../src/sponsors";

// A hand-cut slice of the real USCIS Data Hub export: the same column order and
// the same quirks (per-city rows, blank employers, "CHILDREN S" possessives).
const CSV = readFileSync(new URL("./fixtures/uscis-hub-sample.csv", import.meta.url), "utf8");

function rowsByFy() {
  const m = new Map<number, ReturnType<typeof parseHubCsv>>();
  for (const r of parseHubCsv(CSV)) {
    const list = m.get(r.fy);
    if (list) list.push(r);
    else m.set(r.fy, [r]);
  }
  return new Map([...m].sort((a, b) => a[0] - b[0]));
}

const fixtureFile = () =>
  aggregateHubRows(rowsByFy(), { source: "test", sourceUrl: "test", generatedAt: "2026-01-01" });

function fixtureIndex(): SponsorIndex {
  return buildSponsorIndex(fixtureFile());
}

describe("normalizeEmployer", () => {
  it("strips legal forms, punctuation and case", () => {
    expect(normalizeEmployer("JPMORGAN CHASE & CO")).toBe("jpmorgan chase");
    expect(normalizeEmployer("JPMorgan Chase")).toBe("jpmorgan chase");
    expect(normalizeEmployer("Salesforce, Inc.")).toBe("salesforce");
    expect(normalizeEmployer("SPOTIFY USA INC")).toBe("spotify");
  });
  it("glues possessives back together the way USCIS files them", () => {
    expect(normalizeEmployer("THE CHILDREN S HOSPITAL OF PHILADELPHIA")).toBe(
      "childrens hospital philadelphia",
    );
    expect(normalizeEmployer("Children's Hospital of Philadelphia")).toBe(
      "childrens hospital philadelphia",
    );
  });
  it("merges runs of initials so W.L. == WL and M&T == M T", () => {
    expect(normalizeEmployer("W.L. Gore")).toBe("wl gore");
    expect(normalizeEmployer("WL GORE & ASSOCIATES INC")).toBe("wl gore associates");
    expect(normalizeEmployer("M&T Bank")).toBe(normalizeEmployer("M T BANK"));
    expect(normalizeEmployer("S&P Global")).toBe(normalizeEmployer("S P GLOBAL INC"));
  });
  it("returns empty for a name with no identity tokens", () => {
    expect(normalizeEmployer("The Inc. LLC")).toBe("");
    expect(normalizeEmployer("   ")).toBe("");
  });
});

describe("parseCsvLine", () => {
  it("honours quoted fields and escaped quotes", () => {
    expect(parseCsvLine('2023,"ACME, INC",1,0')).toEqual(["2023", "ACME, INC", "1", "0"]);
    expect(parseCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
    expect(parseCsvLine("a,,b")).toEqual(["a", "", "b"]);
  });
});

describe("parseHubCsv", () => {
  const rows = parseHubCsv(CSV);
  it("skips the header and rows with no employer name", () => {
    expect(rows.every((r) => r.employer !== "")).toBe(true);
    expect(rows.some((r) => r.employer === "JPMORGAN CHASE & CO")).toBe(true);
  });
  it("reads initial/continuing approvals and the state", () => {
    const de = rows.find((r) => r.employer === "UNIVERSITY OF DELAWARE")!;
    expect(de).toMatchObject({ initial: 20, continuing: 25, state: "DE" });
  });
});

describe("aggregateHubRows", () => {
  const file = fixtureFile();
  it("covers every fiscal year found, oldest first", () => {
    expect(file.fiscalYears).toEqual([2022, 2023]);
  });
  it("sums an employer's per-city rows into one entry per FY", () => {
    const jpm = file.employers.find(([n]) => n.startsWith("JPMORGAN"))!;
    // FY2022: one NY row. FY2023: NY (500/3000) + DE (100/400).
    expect(jpm[1]).toEqual([[200, 2000], [600, 3400]]);
    expect(jpm[2].split("|")).toContain("NY");
  });
  it("encodes a fiscal year with no filings as 0", () => {
    const acme = file.employers.find(([n]) => n.startsWith("ACME"))!;
    expect(acme[1][1]).toBe(0); // nothing in FY2023
  });
  it("merges spelling variants under one normalized employer", () => {
    const acme = file.employers.filter(([n]) => n.startsWith("ACME"));
    expect(acme).toHaveLength(1); // "ACME ROBOTICS INC" + "... LLC"
    expect(acme[0][1][0]).toEqual([4, 4]);
  });
  it("drops employers with denials but no approvals", () => {
    expect(file.employers.some(([n]) => n === "DENIED ONLY LLC")).toBe(false);
  });
});

describe("matchSponsor", () => {
  const idx = fixtureIndex();

  it("matches exactly once the legal form is normalized away", () => {
    const h = matchSponsor(idx, "JPMorgan Chase");
    expect(h.confidence).toBe("exact");
    expect(h.matched).toBe("JPMORGAN CHASE & CO");
    expect(h.initialApprovals).toBe(800);
    expect(h.continuingApprovals).toBe(5400);
    expect(h.lastFy).toBe(2023);
  });

  it("falls back to a prefix-anchored fuzzy match for a legal tail", () => {
    const h = matchSponsor(idx, "Capital One");
    expect(h.confidence).toBe("fuzzy");
    expect(h.matched).toBe("CAPITAL ONE SERVICES LLC");
    expect(h.initialApprovals).toBe(140);

    const gore = matchSponsor(idx, "W.L. Gore");
    expect(gore.confidence).toBe("fuzzy");
    expect(gore.matched).toBe("WL GORE & ASSOCIATES INC");
  });

  it("refuses to give a one-word company someone else's filings", () => {
    // Four unrelated "ALLOY *" filers in the index — too ambiguous to pick one.
    const h = matchSponsor(idx, "Alloy");
    expect(h.confidence).toBe("none");
    expect(h.matched).toBeNull();
  });

  it("allows a one-word match when the name prefixes a single filer", () => {
    const h = matchSponsor(idx, "Comcast");
    expect(h.confidence).toBe("fuzzy");
    expect(h.matched).toBe("COMCAST CABLE COMMUNICATIONS LLC");
  });

  it("never drops a qualifying token — a shorter index name is a different employer", () => {
    // "CHILDRENS HOSPITAL <somewhere else>" must not absorb the Philadelphia one.
    const idx2 = buildSponsorIndex({
      source: "s",
      sourceUrl: "u",
      generatedAt: "2026-01-01",
      fiscalYears: [2023],
      employers: [["CHILDRENS HOSPITAL CORPORATION", [[200, 100]], "MA"]],
    });
    expect(matchSponsor(idx2, "Children's Hospital of Philadelphia").confidence).toBe("none");
    // …while the real Philadelphia filing matches exactly, possessive and all.
    expect(matchSponsor(idx, "Children's Hospital of Philadelphia").matched).toBe(
      "THE CHILDREN S HOSPITAL OF PHILADELPHIA",
    );
  });

  it("reports a clean miss rather than guessing", () => {
    const h = matchSponsor(idx, "Nonexistent Widgets");
    expect(h).toMatchObject({ confidence: "none", matched: null, initialApprovals: 0 });
    expect(h.nearMiss).toBe(false);
    expect(h.fyRange).toEqual([2022, 2023]);
  });

  it("flags a near miss when the first token is in the index but the rest isn't", () => {
    // The index knows "ALLOY STEEL"/"ALLOY THERAPEUTICS", so failing to place
    // "Alloy Automation" is our failure to reach the entity, not proof of absence.
    expect(matchSponsor(idx, "Alloy Automation").nearMiss).toBe(true);
    expect(matchSponsor(idx, "Alloy").nearMiss).toBe(true); // too ambiguous to pick
  });

  it("handles a company name that normalizes to nothing", () => {
    expect(matchSponsor(idx, "The Inc.").confidence).toBe("none");
  });
});

describe("sponsorLine", () => {
  const idx = fixtureIndex();

  it("states the approval count for a match", () => {
    expect(sponsorLine(matchSponsor(idx, "JPMorgan Chase"), "JPMorgan Chase")).toBe(
      "🛂 H-1B: 800 initial approvals FY22–23",
    );
  });
  it("names the employer it guessed when the match is fuzzy", () => {
    expect(sponsorLine(matchSponsor(idx, "Capital One"), "Capital One")).toContain(
      "(~CAPITAL ONE SERVICES LLC)",
    );
  });
  it("says 'none found' only for a name specific enough to mean it", () => {
    expect(sponsorLine(matchSponsor(idx, "Nonexistent Widgets"), "Nonexistent Widgets")).toBe(
      "🛂 no H-1B filings found FY22–23",
    );
    expect(sponsorLine(matchSponsor(idx, "Alloy"), "Alloy")).toBeNull();
  });
  it("stays quiet on a near miss rather than claim an employer doesn't sponsor", () => {
    expect(sponsorLine(matchSponsor(idx, "Alloy Automation"), "Alloy Automation")).toBeNull();
  });
  it("stays quiet about a cap-exempt employer with no filings on record", () => {
    const h = matchSponsor(idx, "Jefferson Health");
    expect(sponsorLine(h, "Jefferson Health", true)).toBeNull();
    expect(sponsorLine(h, "Jefferson Health", false)).not.toBeNull();
  });
  it("falls back to continuing approvals when there were no initial ones", () => {
    const idx2 = buildSponsorIndex({
      source: "s",
      sourceUrl: "u",
      generatedAt: "2026-01-01",
      fiscalYears: [2023],
      employers: [["VANTA INC", [[0, 15]], "CA"]],
    });
    expect(sponsorLine(matchSponsor(idx2, "Vanta"), "Vanta")).toBe(
      "🛂 H-1B: 15 continuing approvals FY23",
    );
  });
  it("is null with no history attached at all", () => {
    expect(sponsorLine(undefined, "Anything")).toBeNull();
  });
});

describe("sponsorAbsenceIsMeaningful / hasSponsorHistory", () => {
  const idx = fixtureIndex();
  it("treats a one-word or tiny name as inconclusive", () => {
    expect(sponsorAbsenceIsMeaningful("Alloy")).toBe(false);
    expect(sponsorAbsenceIsMeaningful("Ace Co")).toBe(false); // "co" is dropped -> one token
    expect(sponsorAbsenceIsMeaningful("Jump Trading")).toBe(true);
  });
  it("reports history only for a real match with approvals", () => {
    expect(hasSponsorHistory(matchSponsor(idx, "JPMorgan Chase"))).toBe(true);
    expect(hasSponsorHistory(matchSponsor(idx, "Nonexistent Widgets"))).toBe(false);
    expect(hasSponsorHistory(undefined)).toBe(false);
  });
});
