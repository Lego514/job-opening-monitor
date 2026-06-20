import { describe, it, expect } from "vitest";
import { extractKeywords, missingFromResume } from "../src/keywords";

const jd =
  "We need Python, SQL, and AWS. Experience with Spark and Airflow building data " +
  "pipelines. Docker and Kubernetes a plus. Java experience helpful. REST APIs.";

describe("extractKeywords", () => {
  it("finds and ranks the JD's skills", () => {
    const labels = extractKeywords(jd).map((h) => h.label);
    for (const s of ["Python", "SQL", "AWS", "Spark", "Airflow", "Docker", "Kubernetes", "Java", "REST"]) {
      expect(labels).toContain(s);
    }
  });
  it("does not match 'Java' inside 'JavaScript'", () => {
    const labels = extractKeywords("Senior JavaScript developer").map((h) => h.label);
    expect(labels).toContain("JavaScript");
    expect(labels).not.toContain("Java");
  });
});

describe("missingFromResume", () => {
  it("lists JD skills absent from the résumé", () => {
    const missing = missingFromResume(jd, "Built data apps in Python and SQL.");
    expect(missing).toContain("AWS");
    expect(missing).toContain("Spark");
    expect(missing).not.toContain("Python");
    expect(missing).not.toContain("SQL");
  });
});
