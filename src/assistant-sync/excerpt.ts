export const DEFAULT_EXCERPT_MIN_DWELL_MINUTES = 5;
export const MAX_EXCERPT_CHARS = 1500;

/**
 * Main-text excerpt for the Content tab.
 * A missing dwell is not treated as a long read. No excerpt is returned.
 */
export function buildExcerpt(
  text: string,
  dwellMinutes: number | null,
  minDwellMinutes: number = DEFAULT_EXCERPT_MIN_DWELL_MINUTES
): string | null {
  if (dwellMinutes == null || !Number.isFinite(dwellMinutes) || dwellMinutes < minDwellMinutes) {
    return null;
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= MAX_EXCERPT_CHARS) return cleaned;
  const slice = cleaned.slice(0, MAX_EXCERPT_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_EXCERPT_CHARS - 80 ? slice.slice(0, lastSpace) : slice;
  return cut.trim();
}
