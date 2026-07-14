/** Telegram's hard limit is 4096 chars per message; stay under it with headroom. */
const TG_LIMIT = 4000;

/**
 * Split text into chunks ≤ limit, preferring paragraph (`\n\n`) then line (`\n`)
 * boundaries so each job entry — and its balanced HTML tags — stays intact.
 * A single oversized line (e.g. a very long URL) is hard-split as a last resort.
 */
export function chunkMessage(text: string, limit = TG_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) chunks.push(buf);
    buf = "";
  };
  for (const para of text.split("\n\n")) {
    const joined = buf ? `${buf}\n\n${para}` : para;
    if (joined.length <= limit) {
      buf = joined;
      continue;
    }
    flush();
    if (para.length <= limit) {
      buf = para;
      continue;
    }
    // Single paragraph too long: fall back to line boundaries, then hard-split.
    for (const line of para.split("\n")) {
      if (line.length > limit) {
        flush();
        for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
        continue;
      }
      const joinedLine = buf ? `${buf}\n${line}` : line;
      if (joinedLine.length <= limit) {
        buf = joinedLine;
      } else {
        flush();
        buf = line;
      }
    }
  }
  flush();
  return chunks;
}

async function postMessage(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) console.error(`[telegram] HTTP ${res.status}: ${await res.text()}`);
}

/** Send a Telegram message via the Bot API, splitting into multiple messages if
 *  it exceeds the length limit. No-op (warn) if not configured. */
export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/CHAT_ID not set — skipping.");
    return;
  }
  for (const part of chunkMessage(text)) {
    await postMessage(token, chatId, part);
  }
}
