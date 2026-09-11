/**
 * LLM classification stage — the real filter.
 *
 * The regex pre-filter (match.ts + FILTERS) is deliberately WIDE now: it lets
 * "Technology Development Program", "Applied Scientist", "2027 Analyst Program"
 * and friends through, because no keyword list can enumerate the names
 * employers invent for new-grad roles. Precision is bought here instead: Claude
 * reads title + location + JD and answers the two questions a regex cannot —
 * "is this realistically open to a new MS grad?" and "does this JD say anything
 * about visa sponsorship?" (the regex classifier could only ever say "no" or
 * "unknown"; ~80% of matches came back "unknown").
 *
 * Cost discipline, in order of how much it saves:
 *   1. Only NEW postings are classified (post-diff), never the ~280 matches.
 *   2. Verdicts are cached in Supabase by posting key, so a re-run, a seed, or
 *      a role that reappears costs nothing.
 *   3. The JD is truncated (JD_CHARS) — sponsorship and seniority language is
 *      near the top, and a full JD is mostly boilerplate benefits text.
 *   4. A hard per-run ceiling (LLM_MAX_PER_RUN) bounds the worst case.
 * Haiku 4.5 at ~1.2k in / ~120 out tokens per role is ~$0.0018 each.
 *
 * Graceful degradation is not optional: with no ANTHROPIC_API_KEY (the local
 * case) or during an API outage, every function here no-ops and the run falls
 * back to the regex behaviour it had before. An LLM failure must never cost a
 * run its alerts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { type LlmVerdict, type Posting, postingKey } from "./types";

/** Cheapest current model; this is a short, well-specified classification. */
export const LLM_MODEL = "claude-haiku-4-5";

// Haiku 4.5 list price, $ per token. Only used for the "[llm] … ~$X" log line —
// an estimate to keep the daily spend visible, not billing.
const PRICE_IN = 1 / 1_000_000;
const PRICE_OUT = 5 / 1_000_000;

/** JD characters sent per posting (~1 token per 4 chars). */
const JD_CHARS = 4000;

const SYSTEM_PROMPT = [
  "You screen US job postings for one specific candidate: an MS in Computer Science,",
  "graduating now, on F-1 STEM OPT, with ~0-2 years of professional experience.",
  "He needs H-1B sponsorship eventually. He wants data-analyst roles first (80%) and",
  "software-engineering roles second (20%).",
  "",
  "Judge the ROLE, not the title. Employers name new-grad roles many ways:",
  'rotational/development/"early career" programs, "Analyst" at banks, "Associate"',
  'and even "Senior Associate" at some firms (Capital One) are entry tiers, and a',
  '"2027 Analyst Program" is a new-grad pipeline. Conversely a role demanding 5+',
  "years, an existing team to lead, or a PhD plus publications is not open to him.",
  "",
  "For sponsorship, report what the JD actually says:",
  '- "will-sponsor" only if it affirmatively offers or considers visa sponsorship.',
  '- "no-sponsorship" if it rules it out, requires work authorization without',
  "  sponsorship now or in the future, requires US citizenship, or requires a",
  "  security clearance (all effectively disqualifying).",
  '- "silent" if the JD does not address it — this is the common case, and it is',
  "  NOT a negative signal. Never guess.",
  "Quote at most 12 words of the JD as the reason when it is not silent.",
  "",
  "Answer only by calling the record_classification tool.",
].join("\n");

/**
 * Strict tool = schema-valid arguments, so parseVerdict is a validator for
 * malformed/absent output rather than a parser doing real work. (Structured
 * output via a forced tool call, rather than free text we'd have to JSON.parse.)
 */
const CLASSIFY_TOOL = {
  name: "record_classification",
  description: "Record the screening verdict for one job posting.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      newGradFit: {
        type: "string",
        enum: ["yes", "maybe", "no"],
        description: "Is this realistically open to a new MS grad with 0-2 years experience?",
      },
      seniority: {
        type: "string",
        enum: ["intern", "new-grad", "entry", "mid", "senior", "exec"],
      },
      roleFamily: {
        type: "string",
        enum: ["data-analyst", "data-engineer", "swe", "ml", "analyst-other", "other"],
      },
      sponsorship: {
        type: "string",
        enum: ["will-sponsor", "no-sponsorship", "silent"],
      },
      sponsorshipReason: {
        type: "string",
        description: "Short JD quote backing the sponsorship call; empty string when silent.",
      },
      remoteUS: { type: "boolean", description: "Remote-eligible from anywhere in the US." },
      summary: { type: "string", description: "Plain summary of the role, at most 20 words." },
    },
    required: [
      "newGradFit",
      "seniority",
      "roleFamily",
      "sponsorship",
      "sponsorshipReason",
      "remoteUS",
      "summary",
    ],
    additionalProperties: false,
  },
};

/** True when the API key is configured; every caller no-ops when it isn't. */
export function llmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** The per-posting user message. Pure, so the prompt shape is unit-testable. */
export function buildUserPrompt(p: Posting): string {
  const jd = (p.jdText ?? p.description ?? "").replace(/\s+/g, " ").trim().slice(0, JD_CHARS);
  return [
    `Company: ${p.company || "unknown"}`,
    `Title: ${p.title || "unknown"}`,
    `Location: ${p.location || "unknown"}`,
    "",
    "Job description (may be truncated):",
    jd || "(no description available — judge from the title and location alone)",
  ].join("\n");
}

const FITS = ["yes", "maybe", "no"];
const SENIORITIES = ["intern", "new-grad", "entry", "mid", "senior", "exec"];
const FAMILIES = ["data-analyst", "data-engineer", "swe", "ml", "analyst-other", "other"];
const SPONSORSHIPS = ["will-sponsor", "no-sponsorship", "silent"];

function pick<T extends string>(v: unknown, allowed: string[]): T | null {
  return typeof v === "string" && allowed.includes(v) ? (v as T) : null;
}

/**
 * Validate one raw tool input into a verdict, or null if it isn't usable.
 *
 * `strict: true` should make this redundant, but a rejected verdict costs one
 * posting its classification while a trusted bad one (an unknown seniority, a
 * missing field) would poison the alert filter for that role. Everything
 * optional is defaulted; anything enum-typed must be exact.
 */
export function parseVerdict(raw: unknown): LlmVerdict | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const newGradFit = pick<LlmVerdict["newGradFit"]>(o.newGradFit, FITS);
  const seniority = pick<LlmVerdict["seniority"]>(o.seniority, SENIORITIES);
  const roleFamily = pick<LlmVerdict["roleFamily"]>(o.roleFamily, FAMILIES);
  const sponsorship = pick<LlmVerdict["sponsorship"]>(o.sponsorship, SPONSORSHIPS);
  if (!newGradFit || !seniority || !roleFamily || !sponsorship) return null;

  const reason = typeof o.sponsorshipReason === "string" ? o.sponsorshipReason.trim() : "";
  const summary = typeof o.summary === "string" ? o.summary.replace(/\s+/g, " ").trim() : "";

  return {
    newGradFit,
    seniority,
    roleFamily,
    sponsorship,
    // Only carry a reason when there is something to justify; a quote attached
    // to "silent" is the model inventing evidence.
    ...(reason && sponsorship !== "silent" ? { sponsorshipReason: reason.slice(0, 160) } : {}),
    remoteUS: o.remoteUS === true,
    summary: summary.slice(0, 200),
  };
}

/**
 * Write a verdict onto the posting.
 *
 * The LLM only ever ADDS a "no": a regex-flagged role stays flagged even if the
 * model reads the JD as silent, because the regex disqualifiers are literal
 * phrases and a false negative here is an application wasted on a dead end.
 */
export function applyVerdict(p: Posting, v: LlmVerdict): void {
  p.llm = v;
  if (v.sponsorship === "no-sponsorship" && p.sponsorship !== "no") {
    p.sponsorship = "no";
    p.sponsorshipReason = v.sponsorshipReason ?? "LLM: JD rules out sponsorship";
  }
  if (v.remoteUS) p.remote = true;
}

export interface ClassifyResult {
  classified: number; // verdicts obtained from the API this run
  cached: number; // verdicts served from the Supabase cache
  failed: number; // postings the API could not classify (left to the regex path)
  costUsd: number; // estimated spend for this run
  fresh: Map<string, LlmVerdict>; // API verdicts, for the caller to persist
}

export interface ClassifyOpts {
  /** Verdicts already known (Supabase cache), keyed by posting key. */
  cache?: Map<string, LlmVerdict>;
  /** Hard ceiling on API calls this run. */
  max: number;
  concurrency?: number;
  client?: Anthropic; // injected in tests; never constructed there
}

interface OneResult {
  verdict: LlmVerdict | null;
  inTokens: number;
  outTokens: number;
}

/** One API call, already wrapped by the caller's try/catch. */
async function classifyOne(client: Anthropic, p: Posting): Promise<OneResult> {
  const res = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 512, // a classification; the tool schema bounds the output
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
    messages: [{ role: "user", content: buildUserPrompt(p) }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  return {
    verdict: block ? parseVerdict(block.input) : null,
    inTokens: res.usage?.input_tokens ?? 0,
    outTokens: res.usage?.output_tokens ?? 0,
  };
}

/**
 * Classify postings, attaching a verdict to each one it can.
 *
 * Cache hits are applied for free. Everything else goes through a bounded
 * worker pool; a per-posting try/catch means one bad JD, one timeout, or a
 * total API outage costs those roles their verdict and nothing more — they keep
 * the regex-derived fields and stay in the alert set.
 */
export async function classifyAll(posts: Posting[], opts: ClassifyOpts): Promise<ClassifyResult> {
  const fresh = new Map<string, LlmVerdict>();
  let cached = 0;
  let failed = 0;
  let inTokens = 0;
  let outTokens = 0;

  const todo: Posting[] = [];
  for (const p of posts) {
    const hit = opts.cache?.get(postingKey(p));
    if (hit) {
      applyVerdict(p, hit);
      cached++;
    } else {
      todo.push(p);
    }
  }

  // Newest first, so when the ceiling bites it drops the stalest roles.
  const batch = todo.slice(0, Math.max(0, opts.max));
  const skipped = todo.length - batch.length;
  if (skipped > 0) console.warn(`[llm] ceiling reached — ${skipped} posting(s) left unclassified.`);

  if (batch.length > 0) {
    // The SDK's own retry covers 429/529/5xx and connection errors; the timeout
    // stops one hung request from holding a worker for the whole run.
    const client =
      opts.client ?? new Anthropic({ maxRetries: 3, timeout: 30_000 });
    let i = 0;
    const worker = async () => {
      while (i < batch.length) {
        const p = batch[i++];
        try {
          const { verdict: v, inTokens: ti, outTokens: to } = await classifyOne(client, p);
          inTokens += ti;
          outTokens += to;
          if (v) {
            applyVerdict(p, v);
            fresh.set(postingKey(p), v);
          } else {
            failed++;
            console.error(`[llm] ${p.company} — ${p.title}: unusable verdict`);
          }
        } catch (e) {
          failed++;
          console.error(`[llm] ${p.company} — ${p.title}: ${(e as Error).message}`);
        }
      }
    };
    const lanes = Math.min(opts.concurrency ?? 6, batch.length);
    await Promise.all(Array.from({ length: lanes }, worker));
  }

  return {
    classified: fresh.size,
    cached,
    failed,
    costUsd: inTokens * PRICE_IN + outTokens * PRICE_OUT,
    fresh,
  };
}
