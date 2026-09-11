// Build `data/sponsors.json` from the USCIS H-1B Employer Data Hub.
//
//   npm run build:sponsors            # latest 3 fiscal years
//   npm run build:sponsors -- --years 5
//
// Run this OFFLINE of the monitor — never inside the ~4-hourly run. The monthly
// `.github/workflows/sponsor-data.yml` job does it in CI and commits the result
// if it changed (USCIS only publishes once a year, so most runs are a no-op).
//
// Why USCIS and not DOL: see the README section "Where the H-1B data comes from".
// Short version — the Data Hub is one ~2–4 MB CSV per FY with exactly the fields
// we need (employer, state, approvals), while the DOL OFLC LCA disclosure files
// are hundreds of MB of per-case rows per year. An LCA is only an *intent* to
// file; a Data Hub row is an actual approved petition, which is the stronger
// signal and a hundredth of the bytes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHubCsv, aggregateHubRows, type HubRow } from "../src/sponsors";

const HUB_PAGE =
  "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub/h-1b-employer-data-hub-files";
const csvUrl = (fy: number) =>
  `https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-${fy}.csv`;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const WANT_YEARS = intArg("years", 3);

/**
 * Which fiscal years does USCIS currently publish?
 *
 * Scraped from the download page rather than hardcoded, so the January a new FY
 * lands the monthly job picks it up with no code change. If the page shape ever
 * changes, fall back to probing the predictable URL for recent years.
 */
async function availableYears(): Promise<number[]> {
  try {
    const res = await fetch(HUB_PAGE, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const years = [...html.matchAll(/h1b_datahubexport-(\d{4})\.csv/g)].map((m) => Number(m[1]));
    const uniq = [...new Set(years)].sort((a, b) => a - b);
    if (uniq.length) return uniq;
    throw new Error("no export links found on the page");
  } catch (e) {
    console.warn(`[sponsors] hub page scrape failed (${(e as Error).message}) — probing URLs`);
    const now = new Date().getFullYear();
    const found: number[] = [];
    for (let fy = now - 6; fy <= now; fy++) {
      const r = await fetch(csvUrl(fy), { method: "HEAD" }).catch(() => null);
      if (r?.ok) found.push(fy);
    }
    return found;
  }
}

async function main(): Promise<void> {
  const all = await availableYears();
  if (all.length === 0) throw new Error("USCIS published no Data Hub exports we could find");
  const years = all.slice(-WANT_YEARS);
  console.log(`[sponsors] available FYs ${all[0]}–${all[all.length - 1]}; using ${years.join(", ")}`);

  const byFy = new Map<number, HubRow[]>();
  for (const fy of years) {
    const res = await fetch(csvUrl(fy), { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`FY${fy}: HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseHubCsv(text);
    console.log(`[sponsors] FY${fy}: ${(text.length / 1e6).toFixed(1)} MB, ${rows.length} rows`);
    byFy.set(fy, rows);
  }

  const file = aggregateHubRows(byFy, {
    source: "USCIS H-1B Employer Data Hub",
    sourceUrl: HUB_PAGE,
    generatedAt: new Date().toISOString().slice(0, 10),
  });

  const out = fileURLToPath(new URL("../data/sponsors.json", import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  // One employer per line: a diff of next year's refresh stays readable, and the
  // file is still plain JSON.
  const body = file.employers.map((e) => `  ${JSON.stringify(e)}`).join(",\n");
  const json =
    `{\n"source": ${JSON.stringify(file.source)},\n"sourceUrl": ${JSON.stringify(file.sourceUrl)},\n` +
    `"generatedAt": ${JSON.stringify(file.generatedAt)},\n"fiscalYears": ${JSON.stringify(file.fiscalYears)},\n` +
    `"employers": [\n${body}\n]\n}\n`;
  writeFileSync(out, json);
  console.log(
    `[sponsors] wrote ${out} — ${file.employers.length} employers, ` +
      `${(json.length / 1e6).toFixed(2)} MB, FY${file.fiscalYears.join("/")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
