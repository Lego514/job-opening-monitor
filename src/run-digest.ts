/**
 * Daily apply queue — entrypoint (`npm run digest`, `.github/workflows/daily-digest.yml`).
 *
 * The monitor answers "what's new?" every 15 minutes. This answers the only
 * question that actually moves an application forward: "which five do I apply to
 * this morning?" It fetches nothing — every candidate was snapshotted by the
 * monitor run that first found it — so the whole job is three Supabase reads, a
 * sort, and one Telegram message.
 *
 * `--dry-run` prints the message and records nothing.
 */
import { selectDigest, digestMessage, todayKeyNY } from "./digest";
import { checkEnv, missingEnvMessage } from "./env";
import { sendTelegram } from "./notify/telegram";
import {
  MissingTableError,
  loadActedUrlKeys,
  loadCandidates,
  loadDigestedKeys,
  recordDigested,
} from "./state";

const DRY_RUN = process.argv.includes("--dry-run");

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DIGEST_SIZE = intEnv("DIGEST_SIZE", 5);
const DIGEST_MAX_AGE_DAYS = intEnv("DIGEST_MAX_AGE_DAYS", 10);
// How far back the candidate pool is read. Wider than the age limit on purpose:
// a posting with an unparseable date has no age, and dropping it from the pool
// would silently shrink the queue's reach.
const DIGEST_POOL_DAYS = intEnv("DIGEST_POOL_DAYS", 30);

async function main(): Promise<void> {
  const { missing, degraded } = checkEnv(process.env, "digest");
  if (missing.length > 0) throw new Error(missingEnvMessage(missing, "digest"));
  for (const d of degraded) console.warn(`[env] ${d}`);

  const now = Date.now();
  const candidates = await loadCandidates(DIGEST_POOL_DAYS);
  const [digestedKeys, actedUrlKeys] = await Promise.all([
    loadDigestedKeys(),
    loadActedUrlKeys(),
  ]);
  console.log(
    `[digest] pool ${candidates.length} (≤${DIGEST_POOL_DAYS}d), ` +
      `${digestedKeys.size} already digested, ${actedUrlKeys.size} already acted on in the tracker.`,
  );

  const result = selectDigest(candidates, {
    size: DIGEST_SIZE,
    maxAgeDays: DIGEST_MAX_AGE_DAYS,
    digestedKeys,
    actedUrlKeys,
    now,
  });
  const message = digestMessage(result, now);

  if (DRY_RUN) {
    console.log("\n----- would send -----\n");
    console.log(message);
    console.log(`\n----- ${message.length} chars, nothing sent or recorded -----`);
    return;
  }

  await sendTelegram(message);
  // Recorded only after the send succeeds in spirit: sendTelegram never throws
  // (it logs an HTTP failure), but keeping the write second means an outright
  // crash in the sender leaves the roles unburned for tomorrow.
  if (result.chosen.length > 0) {
    await recordDigested(
      result.chosen.map((c, i) => ({ key: c.key, rank: i + 1 })),
      todayKeyNY(now),
    );
  }
  console.log(
    `[digest] sent ${result.counts.shown} role(s) — ` +
      `${result.counts.pool} in pool, ${result.counts.fit} new-grad-fit.`,
  );
}

main().catch((e) => {
  // A missing migration is the one failure with an obvious fix, so say the fix
  // instead of dumping a stack. Still a non-zero exit: the queue didn't go out.
  if (e instanceof MissingTableError) {
    console.error(`[digest] ${e.message}`);
  } else {
    console.error(e);
  }
  process.exitCode = 1;
});
