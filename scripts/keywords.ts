// Résumé keyword helper.
//   npm run keywords -- <workday-or-greenhouse-job-url | path/to/jd.txt> [--resume path/to/resume.txt]
//
// Prints the tech keywords a job description emphasizes (so you can mirror them
// in your résumé / ATS), and — if you pass --resume — which ones you're missing.
import { readFileSync } from "node:fs";
import { fetchJobDetail } from "../src/adapters/workday";
import { fetchGreenhouseDetail } from "../src/adapters/greenhouse";
import { extractKeywords, missingFromResume } from "../src/keywords";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function getJdText(input: string): Promise<string> {
  if (input.includes("myworkdayjobs.com")) {
    return (await fetchJobDetail(input)).description;
  }
  if (input.includes("greenhouse.io")) {
    const m = input.match(/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
    if (m) {
      const api = `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`;
      return (await fetchGreenhouseDetail(api)).description;
    }
  }
  // Otherwise treat the input as a local file containing pasted JD text.
  return readFileSync(input, "utf8");
}

const input = process.argv[2];
if (!input || input.startsWith("--")) {
  console.error("Usage: npm run keywords -- <job-url | jd.txt> [--resume resume.txt]");
  process.exit(1);
}

const jd = await getJdText(input);
const hits = extractKeywords(jd);

console.log(`\nTop tech keywords in this job description (${hits.length}):\n`);
for (const h of hits) console.log(`  ${String(h.count).padStart(2)}×  ${h.label}`);

const resumePath = flag("--resume");
if (resumePath) {
  const resume = readFileSync(resumePath, "utf8");
  const missing = missingFromResume(jd, resume);
  console.log(`\n⚠️  In the JD but NOT on your résumé — add the ones you genuinely have:\n`);
  if (missing.length === 0) console.log("  ✅ your résumé already covers the JD's keywords.");
  else for (const m of missing) console.log(`  + ${m}`);
}
console.log("");
