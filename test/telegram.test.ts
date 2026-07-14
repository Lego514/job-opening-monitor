import { describe, it, expect } from "vitest";
import { chunkMessage } from "../src/notify/telegram";

describe("chunkMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkMessage("hello", 4000)).toEqual(["hello"]);
  });

  it("keeps every chunk within the limit", () => {
    const para = "x".repeat(300);
    const text = Array.from({ length: 50 }, () => para).join("\n\n");
    const chunks = chunkMessage(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it("splits on paragraph boundaries so entries stay intact", () => {
    const entries = ["<b>A</b>: role", "<b>B</b>: role", "<b>C</b>: role"];
    const text = entries.join("\n\n");
    const chunks = chunkMessage(text, 20);
    // No <b> tag is broken across a chunk boundary.
    for (const c of chunks) {
      expect((c.match(/<b>/g) ?? []).length).toBe((c.match(/<\/b>/g) ?? []).length);
    }
    expect(chunks.join("\n\n")).toContain("<b>C</b>: role");
  });

  it("hard-splits a single oversized line as a last resort", () => {
    const long = "y".repeat(50);
    const chunks = chunkMessage(long, 20);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.join("")).toBe(long);
  });
});
