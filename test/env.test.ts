import { describe, it, expect } from "vitest";
import { checkEnv } from "../src/env";

const FULL = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  TRACKER_USER_ID: "uid",
  TELEGRAM_BOT_TOKEN: "tok",
  TELEGRAM_CHAT_ID: "chat",
  RESEND_API_KEY: "rk",
  ALERT_EMAIL_TO: "a@b.c",
  ALERT_EMAIL_FROM: "d@e.f",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("checkEnv", () => {
  it("passes cleanly when everything is configured", () => {
    expect(checkEnv(FULL, "live")).toEqual({ missing: [], degraded: [] });
  });

  it("flags the Supabase secrets a live run cannot start without", () => {
    const { missing } = checkEnv({ ...FULL, SUPABASE_URL: undefined }, "live");
    expect(missing).toEqual(["SUPABASE_URL"]);
    expect(checkEnv({}, "live").missing).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("requires nothing for a dry run — it neither reads nor writes state", () => {
    expect(checkEnv(FULL, "dry-run")).toEqual({ missing: [], degraded: [] });
    expect(checkEnv({}, "dry-run").missing).toEqual([]);
  });

  it("reports a missing Anthropic key as degraded, not fatal (regex fallback)", () => {
    for (const mode of ["live", "dry-run"] as const) {
      const { missing, degraded } = checkEnv({ ...FULL, ANTHROPIC_API_KEY: undefined }, mode);
      expect(missing).toEqual([]);
      expect(degraded).toContain("ANTHROPIC_API_KEY — LLM classification off, regex fallback");
    }
  });

  it("does not mention the LLM on a seed run, which classifies nothing", () => {
    const { degraded } = checkEnv({ SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" }, "seed");
    expect(degraded).toEqual([]);
  });

  it("requires state secrets for a seed run", () => {
    expect(checkEnv({}, "seed").missing).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("treats an unconfigured alert channel as degraded, not fatal", () => {
    // Email is opt-in by design, so a missing Resend key must never fail the run —
    // but it still has to be reported, or the run "succeeds" while sending nothing.
    const { missing, degraded } = checkEnv({ ...FULL, RESEND_API_KEY: undefined }, "live");
    expect(missing).toEqual([]);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("email");
  });

  it("reports a half-configured Telegram pair as degraded", () => {
    const { degraded } = checkEnv({ ...FULL, TELEGRAM_CHAT_ID: undefined }, "live");
    expect(degraded.some((d) => d.includes("Telegram"))).toBe(true);
  });

  it("does not nag about alert channels on a seed run, which sends nothing", () => {
    expect(checkEnv({ SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" }, "seed").degraded).toEqual([]);
  });
});
