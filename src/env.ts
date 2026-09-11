/**
 * Up-front environment checks.
 *
 * Without these, a missing secret isn't caught until `state.ts` first touches
 * Supabase — which happens *after* the ~3-minute fetch/enrich of every source.
 * The run burns its whole budget and then dies on the last step. Checking here
 * turns that into a one-second, actionable failure.
 */

export type RunMode = "dry-run" | "seed" | "live";

/** Hard requirements per mode. A dry run neither reads nor writes state. */
const REQUIRED: Record<RunMode, string[]> = {
  "dry-run": [],
  seed: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  live: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
};

export interface EnvCheck {
  /** Absent vars the mode cannot run without. */
  missing: string[];
  /** Present-but-incomplete channels: the run still works, minus that output. */
  degraded: string[];
}

/**
 * Classify the environment for a run mode.
 *
 * Optional channels stay optional — email in particular is documented as
 * opt-in, so a missing Resend key must not fail the run. But a silently
 * unconfigured channel is how you end up "succeeding" every 15 minutes while
 * never receiving an alert, so each one is reported before the work starts.
 */
export function checkEnv(env: NodeJS.ProcessEnv, mode: RunMode): EnvCheck {
  const missing = REQUIRED[mode].filter((k) => !env[k]);
  const degraded: string[] = [];

  // The LLM stage is an enhancement, never a requirement: with no key the run
  // still fetches, matches and alerts on the regex path exactly as it did
  // before. It is normally unset locally and set as a repo secret in CI, so
  // saying so out loud is what separates "working as designed" from a silent
  // downgrade. A seed run alerts on nothing, so it never classifies.
  if ((mode === "live" || mode === "dry-run") && !env.ANTHROPIC_API_KEY) {
    degraded.push("ANTHROPIC_API_KEY — LLM classification off, regex fallback");
  }

  if (mode === "live") {
    if (!env.TRACKER_USER_ID) degraded.push("TRACKER_USER_ID — matches won't be added to the tracker");
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) degraded.push("TELEGRAM_BOT_TOKEN/CHAT_ID — no Telegram alerts");
    if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) degraded.push("RESEND_API_KEY/ALERT_EMAIL_TO/FROM — no email alerts");
  }

  return { missing, degraded };
}

/** Human-readable failure text naming both places the value has to be set. */
export function missingEnvMessage(missing: string[], mode: RunMode): string {
  return (
    `Missing required env for a ${mode} run: ${missing.join(", ")}. ` +
    `Set it in .env for local runs, or as a GitHub Actions repo secret for the cron ` +
    `(Settings → Secrets and variables → Actions).`
  );
}
