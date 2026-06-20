// Detect whether a job description marks the role itself as remote-eligible, so
// a role tagged to an HQ city (e.g. "Santa Clara, CA") but actually remote still
// passes the location filter. Conservative — patterns target the *role* being
// remote, not generic "remote-friendly culture" copy. Pure + tested.

const REMOTE_PATTERNS: RegExp[] = [
  /\b(?:fully|100%|completely)\s*remote\b/i,
  /\bremote[\s-]?(?:eligible|position|role|opportunity|based)\b/i,
  /\bwork(?:s|ing)? from home\b/i,
  /\bthis (?:role|position|job) (?:is|can be|may be) (?:fully |100% )?remote\b/i,
  /\bopen to (?:fully )?remote\b/i,
  /\bremote\b[^.]{0,25}\b(?:within|across|anywhere in)\b[^.]{0,12}\b(?:the )?(?:us|u\.s\.|united states)\b/i,
];

export function detectRemote(description: string): boolean {
  return REMOTE_PATTERNS.some((re) => re.test(description));
}
