import { type CompanySource, type Posting } from "../types";

const USER_AGENT = "Mozilla/5.0 (compatible; job-opening-monitor)";

interface LeverPosting {
  id: string;
  text: string; // title
  categories?: { location?: string };
  hostedUrl: string;
  createdAt?: number; // epoch ms
  descriptionPlain?: string;
}

/** Pure: map a Lever postings array into normalized Postings (description inline). */
export function normalizeLever(c: CompanySource, raw: LeverPosting[]): Posting[] {
  return (raw ?? []).map((j) => ({
    id: j.id,
    company: c.name,
    title: j.text ?? "",
    location: j.categories?.location ?? "",
    url: j.hostedUrl,
    postedOn: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : "",
    description: j.descriptionPlain ?? "",
  }));
}

/** Fetch a Lever company's full postings list (one request; includes descriptions). */
export async function fetchLever(c: CompanySource): Promise<Posting[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${c.leverToken}?mode=json`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Lever ${c.name} HTTP ${res.status}`);
  return normalizeLever(c, (await res.json()) as LeverPosting[]);
}
