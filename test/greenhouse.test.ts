import { describe, it, expect } from "vitest";
import { normalizeGreenhouse } from "../src/adapters/greenhouse";
import { type CompanySource } from "../src/types";

const gl: CompanySource = { name: "GitLab", ats: "greenhouse", ghToken: "gitlab" };

describe("normalizeGreenhouse", () => {
  it("maps board jobs to postings with a detail API url", () => {
    const out = normalizeGreenhouse(gl, {
      jobs: [
        {
          id: 123,
          title: "Data Analyst",
          location: { name: "Remote, US" },
          absolute_url: "https://boards.greenhouse.io/gitlab/jobs/123",
          updated_at: "2026-06-01T12:00:00Z",
        },
      ],
    });
    expect(out[0]).toEqual({
      id: "123",
      company: "GitLab",
      title: "Data Analyst",
      location: "Remote, US",
      url: "https://boards.greenhouse.io/gitlab/jobs/123",
      postedOn: "2026-06-01",
      detailApi: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/123",
    });
  });
  it("handles an empty board", () => {
    expect(normalizeGreenhouse(gl, {})).toEqual([]);
  });
});
