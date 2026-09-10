import { describe, it, expect } from "vitest";
import { normalizePageUp, normalizePageUpDetail } from "../src/adapters/pageup";
import { type CompanySource } from "../src/types";

const ud: CompanySource = {
  name: "University of Delaware",
  ats: "pageup",
  pageupUrl: "https://careers.udel.edu/en-us/listing/",
};

// Shape copied from the live careers.udel.edu listing table.
const LISTING = `
<table><tbody>
  <tr>
    <td> <a class="job-link" href="/en-us/job/503461/bus-driver-casual-wage">Bus Driver - Casual Wage</a> </td>
    <td> <span class="location">Newark, DE</span> </td>
    <td class="closing-date"> <span class="close-date"><time datetime="2026-09-30T23:30:00Z">Sep 30 2026 </time></span> </td>
  </tr>
  <tr>
    <td> <a class="job-link" href="/en-us/job/503736/clinical-applications-analyst-i">Clinical Applications Analyst I, College of Health &amp; Sciences</a> </td>
    <td> <span class="location">Newark, DE</span> </td>
    <td class="closing-date"> <span class="close-date">Open until filled</span> </td>
  </tr>
</tbody></table>`;

describe("normalizePageUp", () => {
  it("maps listing rows to postings with absolute urls and numeric ids", () => {
    const out = normalizePageUp(ud, LISTING);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: "503461",
      company: "University of Delaware",
      title: "Bus Driver - Casual Wage",
      location: "Newark, DE",
      url: "https://careers.udel.edu/en-us/job/503461/bus-driver-casual-wage",
    });
    expect(out[0].pageupDetail).toBe(out[0].url);
  });

  it("decodes HTML entities in titles", () => {
    expect(normalizePageUp(ud, LISTING)[1].title).toBe(
      "Clinical Applications Analyst I, College of Health & Sciences",
    );
  });

  // The listing's only date is when the role CLOSES; treating it as a posting
  // date would read as posted-in-the-future and skew the recency filter.
  it("leaves postedOn empty rather than using the closing date", () => {
    expect(normalizePageUp(ud, LISTING).map((p) => p.postedOn)).toEqual(["", ""]);
  });

  it("does not let a location-less row borrow the next row's city", () => {
    const html = `
      <tr><td><a class="job-link" href="/en-us/job/1/a">Role A</a></td></tr>
      <tr><td><a class="job-link" href="/en-us/job/2/b">Role B</a></td>
          <td><span class="location">Lewes, DE</span></td></tr>`;
    const out = normalizePageUp(ud, html);
    expect(out.map((p) => p.location)).toEqual(["", "Lewes, DE"]);
  });

  it("returns nothing for a page with no job rows (e.g. a WAF challenge page)", () => {
    expect(normalizePageUp(ud, "<html><body>Checking your browser</body></html>")).toEqual([]);
  });
});

// Header + body shape copied from a live careers.udel.edu job page.
const DETAIL = `
<p>
  <b>Job no:</b> <span class="job-externalJobNo">503736</span><br>
  <b>Work type:</b> <span class="work-type staff">Staff</span><br>
  <b>Location:</b> <span class="location">Newark, DE</span><br>
  <b>Categories:</b> <span class="categories">Administrative Support, Full Time</span><br>
</p>
<div id="job-details">
  <p><strong>CONTEXT OF THE JOB:</strong></p>
  <p>Reporting to the Manager, Health IT.</p>
  <p>The University does <b>not</b> sponsor.</p>
  <p> <b>Applications close:</b> <span class="closing-date">Open until filled</span> </p>
  <p><a class="back-link button" href="/en-us/listing/?">Back to search results</a></p>
</div>`;

describe("normalizePageUpDetail", () => {
  it("extracts the plain-text JD and the location", () => {
    const d = normalizePageUpDetail(DETAIL);
    expect(d.description).toContain("Reporting to the Manager, Health IT.");
    expect(d.description).toContain("The University does not sponsor.");
    expect(d.description).not.toContain("<");
    expect(d.locations).toEqual(["Newark, DE"]);
  });

  it("stops the JD at the applications-close footer", () => {
    expect(normalizePageUpDetail(DETAIL).description).not.toContain("Back to search results");
  });
});
