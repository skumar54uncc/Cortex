/** Replacement used on the sync path only. The local library is not rewritten. */
export const SYNC_REDACTION = "[redacted]";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** 10 to 12 digit phone shapes: a leading plus, or separators between groups. */
const PHONE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;

/**
 * Digit runs of 13 to 19, with a single space or hyphen allowed between digits.
 * Wider than a Luhn check: any such run is removed before sync.
 */
const LONG_DIGITS = /(?:\d[ \t-]?){12,18}\d/g;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** Redact emails, phone numbers, and 13 to 19 digit sequences. */
export function redactForSync(text: string): string {
  const withoutEmail = text.replace(EMAIL, SYNC_REDACTION);
  const withoutLong = withoutEmail.replace(LONG_DIGITS, (match) => {
    const n = digitCount(match);
    return n >= 13 && n <= 19 ? SYNC_REDACTION : match;
  });
  return withoutLong.replace(PHONE, (match) => {
    const n = digitCount(match);
    return n >= 10 && n <= 12 ? SYNC_REDACTION : match;
  });
}
