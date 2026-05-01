/**
 * Best-effort redaction of high-risk patterns before text is indexed locally.
 * Does not replace dedicated secret management — conservative defaults only.
 */

export interface RedactPIIResult {
  redacted: string;
  foundTypes: string[];
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (Number.isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

interface PatternDef {
  name: string;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

const PII_PATTERNS: PatternDef[] = [
  {
    name: "credit_card",
    regex: /\b(?:\d[ \t-]*?){13,19}\b/g,
    validate: (m) => luhnValid(m),
  },
  { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: "jwt",
    regex:
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    name: "api_key",
    regex: /\b(sk-|pk_live_|pk_test_|api[_-]?key[_-]?)[A-Za-z0-9/_+=-]{16,}\b/gi,
  },
  {
    name: "bearer",
    regex: /\bBearer\s+[A-Za-z0-9_\-.]{20,}\b/gi,
  },
];

const REDACT = "[REDACTED]";

export function redactPII(text: string): RedactPIIResult {
  let redacted = text;
  const foundTypes: string[] = [];
  const seen = new Set<string>();

  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern.regex, (match) => {
      if (pattern.validate && !pattern.validate(match)) return match;
      if (!seen.has(pattern.name)) {
        seen.add(pattern.name);
        foundTypes.push(pattern.name);
      }
      return REDACT;
    });
  }

  return { redacted, foundTypes };
}
