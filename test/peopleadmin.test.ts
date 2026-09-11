import { describe, it, expect } from "vitest";
import { normalizePeopleAdmin } from "../src/adapters/peopleadmin";
import { type CompanySource } from "../src/types";

const rutgers: CompanySource = {
  name: "Rutgers University",
  ats: "peopleadmin",
  paHost: "jobs.rutgers.edu",
  capExempt: true,
};

// Shape copied from the live jobs.rutgers.edu/postings/search.atom feed.
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom" xmlns:pa="jobs.rutgers.edu">
  <title>Rutgers University-New Brunswick: All Jobs</title>
  <entry>
    <id>https://jobs.rutgers.edu/postings/280755</id>
    <published>2026-09-11T10:20:09-04:00</published>
    <link rel="alternate" type="text/html" href="https://jobs.rutgers.edu/postings/280755"/>
    <title>Data Analyst &amp; Reporting Specialist</title>
    <content>&lt;div&gt;Builds &amp;amp; maintains dashboards.&lt;/div&gt;</content>
    <author><name>RBHS</name></author>
    <pa:city>New Brunswick</pa:city>
    <pa:state>NJ</pa:state>
    <pa:other_advertising_sources/>
  </entry>
  <entry>
    <id>https://jobs.rutgers.edu/postings/280756</id>
    <published>2026-09-10T08:00:00-04:00</published>
    <link rel="alternate" type="text/html" href="https://jobs.rutgers.edu/postings/280756"/>
    <title>Research Assistant</title>
    <content/>
  </entry>
</feed>`;

describe("normalizePeopleAdmin", () => {
  it("maps an entry, decoding entities and joining city/state", () => {
    const out = normalizePeopleAdmin(rutgers, feed);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "280755",
      company: "Rutgers University",
      title: "Data Analyst & Reporting Specialist",
      location: "New Brunswick, NJ",
      url: "https://jobs.rutgers.edu/postings/280755",
      postedOn: "2026-09-11",
      description: "Builds & maintains dashboards.",
    });
  });

  it("leaves an entry with no pa:city and no paLocation unlocated", () => {
    const out = normalizePeopleAdmin(rutgers, feed);
    expect(out[1].location).toBe("");
    expect(out[1].description).toBe("");
  });

  it("falls back to paLocation when the feed omits city/state", () => {
    const dtcc: CompanySource = {
      name: "Delaware Technical Community College",
      ats: "peopleadmin",
      paHost: "dtcc.peopleadmin.com",
      paLocation: "Dover, DE",
    };
    const out = normalizePeopleAdmin(dtcc, feed);
    expect(out[1].location).toBe("Dover, DE");
    // A feed-supplied location still wins over the fallback.
    expect(out[0].location).toBe("New Brunswick, NJ");
  });

  it("yields an ISO postedOn that the recency filter can read", () => {
    expect(normalizePeopleAdmin(rutgers, feed)[1].postedOn).toBe("2026-09-10");
  });

  it("handles an empty / malformed feed without throwing", () => {
    expect(normalizePeopleAdmin(rutgers, "")).toEqual([]);
    expect(normalizePeopleAdmin(rutgers, "<feed><entry><id>x</id></entry></feed>")).toEqual([]);
  });
});
