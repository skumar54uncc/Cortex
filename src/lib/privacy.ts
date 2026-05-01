/** Conservative defaults — users opt in to broader capture via settings */

export const DEFAULT_SENSITIVE_DOMAIN_HINTS: readonly string[] = [
  "bank",
  "paypal",
  "stripe.com/checkout",
  "chase.com",
  "wellsfargo",
  "mint.intuit",
  "turbotax",
  "creditkarma",
  "healthcare",
  "myhealth",
  "studentaid.gov",
  "passwords.google",
  "vault.bitwarden",
];

export function looksSensitiveHostname(hostname: string, pathname: string): boolean {
  const h = hostname.toLowerCase();
  const p = pathname.toLowerCase();

  if (h.includes("accounts.google") && p.includes("signin")) return true;
  if (h.endsWith(".gov") || h.includes(".mil")) return true;

  for (const x of DEFAULT_SENSITIVE_DOMAIN_HINTS) {
    if (h.includes(x) || p.includes(x)) return true;
  }

  return false;
}

export function isBlockedDomain(hostname: string, blocklist: string[]): boolean {
  const h = hostname.toLowerCase();
  return blocklist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    return h === e || h.endsWith(`.${e}`);
  });
}
