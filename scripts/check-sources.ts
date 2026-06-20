// Health-check every configured source's endpoint. Run with `npm run check`.
// Useful for catching a Workday tenant whose site id changed (e.g. a 422).
import { COMPANIES } from "../src/config";

const UA = "Mozilla/5.0 (compatible; job-opening-monitor)";
let bad = 0;

for (const c of COMPANIES) {
  if (c.ats !== "workday") {
    console.log(`-  ${c.name}: ${c.ats} (not health-checked)`);
    continue;
  }
  const url = `https://${c.tenant}.${c.wd}.myworkdayjobs.com/wday/cxs/${c.tenant}/${c.site}/jobs`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "analyst" }),
      signal: AbortSignal.timeout(20_000),
    });
    let total: unknown = "?";
    try {
      total = ((await r.json()) as { total?: number }).total;
    } catch {
      /* ignore */
    }
    if (r.ok) console.log(`✓  ${c.name}: HTTP ${r.status} (${total} for "analyst")`);
    else {
      console.log(`✗  ${c.name}: HTTP ${r.status}`);
      bad++;
    }
  } catch (e) {
    console.log(`✗  ${c.name}: ${(e as Error).message}`);
    bad++;
  }
}

console.log(`\n${bad === 0 ? "✅ all sources healthy" : `❌ ${bad} source(s) failing`}`);
process.exit(bad === 0 ? 0 : 1);
