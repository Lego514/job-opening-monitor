/**
 * Diagnostic for the email-alert source: `npm run alerts -- --dump`.
 *
 * The parsers in src/adapters/emailalerts.ts were written against each board's
 * documented URL shapes, not against a real send — nobody had set the alerts up
 * yet when they were written. This command is how they get corrected: it
 * connects to the alert inbox READ-ONLY, prints every recent message with the
 * number of job links it yielded, and (with `--dump`) writes any message that
 * yielded ZERO links to disk so its HTML can be read and the parser fixed.
 *
 * A message with 0 links is either not an alert at all (a receipt, a newsletter)
 * or a template whose URL shape is missing from JOB_URL_SHAPES. The dumped file
 * tells you which.
 *
 * Reads nothing but mail, writes nothing but local files, sends nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inboxConfig,
  readAlertInbox,
  mergeAlerts,
  type AlertMessage,
} from "../src/adapters/emailalerts";

const DUMP = process.argv.includes("--dump");
const dumpDir = (process.env.ALERT_DUMP_DIR ?? "").trim() || join(tmpdir(), "job-alert-dumps");

const cfg = inboxConfig(process.env);
if (!cfg) {
  console.error(
    "No inbox configured. Set ALERT_INBOX_USER and ALERT_INBOX_APP_PASSWORD (see .env.example)\n" +
      "— for Gmail that is an App Password from https://myaccount.google.com/apppasswords,\n" +
      "not the account password, and IMAP must be enabled in Gmail settings.",
  );
  process.exit(1);
}

console.log(
  `[alerts] ${cfg.user} @ ${cfg.host}:${cfg.port} · mailbox ${cfg.mailbox} · last ${cfg.days}d · ` +
    `cap ${cfg.maxMessages} · budget ${cfg.budgetMs / 1000}s (READ-ONLY)`,
);
if (DUMP) {
  mkdirSync(dumpDir, { recursive: true });
  console.log(`[alerts] zero-link messages will be written to ${dumpDir}`);
}

const empty: AlertMessage[] = [];
const bySource = new Map<string, number>();
let links = 0;

const result = await readAlertInbox(cfg, (m) => {
  const when = m.date ? m.date.replace("T", " ").slice(0, 16) : "(no date)";
  console.log(
    `\n  uid ${m.uid} · ${when} · ${m.from || "(no sender)"}\n` +
      `    "${m.subject || "(no subject)"}" → ${m.postings.length} job link(s)` +
      (m.html ? "" : "  [no HTML part]"),
  );
  for (const p of m.postings.slice(0, 8)) {
    const src = (p.via ?? "").replace(/ alert$/, "");
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    console.log(
      `      • [${src}] ${p.title} — ${p.company}${p.location ? ` — ${p.location}` : " — (no location)"}\n` +
        `        ${p.url}`,
    );
  }
  if (m.postings.length > 8) console.log(`      … and ${m.postings.length - 8} more`);
  links += m.postings.length;
  if (m.postings.length === 0) {
    empty.push(m);
    if (DUMP) {
      // Sanitize the sender for a filename; keep the uid so it's traceable.
      const tag = (m.from || "unknown").replace(/[^a-z0-9._@-]/gi, "_").slice(0, 60);
      const file = join(dumpDir, `uid-${m.uid}-${tag}.html`);
      writeFileSync(
        file,
        `<!-- from: ${m.from}\n     subject: ${m.subject}\n     date: ${m.date}\n-->\n${m.html}`,
        "utf8",
      );
      console.log(`      ⚠ no links — dumped ${file}`);
    } else {
      console.log("      ⚠ no links — re-run with `-- --dump` to write this message to disk");
    }
  }
});

const merged = mergeAlerts(result.postings);
console.log(
  `\n[alerts] ${result.messages} message(s) read of ${result.matched} in the window · ` +
    `${links} link(s) → ${merged.length} after dedup · ${empty.length} message(s) yielded nothing` +
    (result.errors ? ` · ${result.errors} unreadable` : "") +
    (result.stopped === "cap" ? ` · CAPPED at ${cfg.maxMessages}` : "") +
    (result.stopped === "budget" ? ` · STOPPED at the ${cfg.budgetMs / 1000}s budget` : ""),
);
if (bySource.size > 0) {
  console.log(
    `[alerts] by source: ${[...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
}
if (empty.length > 0) {
  const senders = [...new Set(empty.map((m) => m.from || "(no sender)"))];
  console.log(
    `[alerts] senders whose messages yielded no links: ${senders.join(", ")}\n` +
      `         If one of those IS a job alert, its URL shape is missing from\n` +
      `         JOB_URL_SHAPES in src/adapters/emailalerts.ts — read the dumped HTML,\n` +
      `         add a row to that table, and add a fixture to test/emailalerts.test.ts.`,
  );
}
