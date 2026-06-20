/** Send an email via the Resend HTTP API. No-op (warn) if not configured. */
export async function sendEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    console.warn("[email] RESEND_API_KEY/ALERT_EMAIL_TO/FROM not set — skipping.");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error(`[email] Resend HTTP ${res.status}: ${await res.text()}`);
}
