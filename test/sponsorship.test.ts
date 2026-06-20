import { describe, it, expect } from "vitest";
import { classifySponsorship, findSalary } from "../src/sponsorship";

describe("classifySponsorship", () => {
  it("flags the real WSFS phrasing", () => {
    const r = classifySponsorship("We will not be able to provide Relocation or Sponsorship. Salary Range: $64,491.");
    expect(r.status).toBe("no");
  });
  it("flags 'no sponsorship', 'without sponsorship', citizenship, clearance", () => {
    expect(classifySponsorship("No visa sponsorship is available for this role.").status).toBe("no");
    expect(classifySponsorship("Must be authorized to work in the US without sponsorship.").status).toBe("no");
    expect(classifySponsorship("Candidates must be a US citizen.").status).toBe("no");
    expect(classifySponsorship("This position requires an active security clearance.").status).toBe("no");
  });
  it("does NOT flag roles that offer sponsorship or say nothing", () => {
    expect(classifySponsorship("We are happy to provide visa sponsorship for the right candidate.").status).toBe("unknown");
    expect(classifySponsorship("Great team, competitive pay, hybrid in Wilmington.").status).toBe("unknown");
    expect(classifySponsorship("").status).toBe("unknown");
  });
});

describe("findSalary", () => {
  it("extracts a single figure and a range", () => {
    expect(findSalary("Salary Range: $64,491 per year")).toBe("$64,491");
    expect(findSalary("Pay: $60,000 - $80,000")).toBe("$60,000 - $80,000");
  });
  it("returns null when there's no salary", () => {
    expect(findSalary("No compensation details here.")).toBeNull();
  });
});
