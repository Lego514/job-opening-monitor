import { describe, it, expect } from "vitest";
import { normalizeLever } from "../src/adapters/lever";
import { type CompanySource } from "../src/types";

const sp: CompanySource = { name: "Spotify", ats: "lever", leverToken: "spotify" };

describe("normalizeLever", () => {
  it("maps Lever postings (with inline description) to Postings", () => {
    const out = normalizeLever(sp, [
      {
        id: "abc-123",
        text: "Data Analyst",
        categories: { location: "New York, NY" },
        hostedUrl: "https://jobs.lever.co/spotify/abc-123",
        createdAt: 1_717_000_000_000,
        descriptionPlain: "We do not offer visa sponsorship.",
      },
    ]);
    expect(out[0]).toMatchObject({
      id: "abc-123",
      company: "Spotify",
      title: "Data Analyst",
      location: "New York, NY",
      url: "https://jobs.lever.co/spotify/abc-123",
      description: "We do not offer visa sponsorship.",
    });
    expect(out[0].postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("handles an empty list", () => {
    expect(normalizeLever(sp, [])).toEqual([]);
  });
});
