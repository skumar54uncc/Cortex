/** Second-person digest copy for the Digest tab (post-LLM normalize). */
export function personalizeDigestNarrative(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "Your reading activity will appear here once Cortex has indexed pages.";

  if (/^the user(?:'s)?\s+/i.test(s)) {
    s = s.replace(/^the user's\s+/i, "Your ");
    s = s.replace(/^the user\s+/i, "You ");
  }

  if (/^their\s+/i.test(s)) {
    s = s.replace(/^their\s+/i, "Your ");
  }

  if (!/^your\b/i.test(s) && !/^you\b/i.test(s)) {
    const lower = s.charAt(0).toLowerCase() + s.slice(1);
    s = `Your recent reading focused on ${lower}`;
  }

  return s;
}
