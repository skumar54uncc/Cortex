/**
 * Hard skips — whole-site classes where indexing is inappropriate for a default-safe product.
 */

export const ALWAYS_SKIP_DOMAINS: readonly string[] = [
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "capitalone.com",
  "citi.com",
  "usbank.com",
  "pnc.com",
  "discover.com",
  "mychart.com",
  "epic.com",
  "kaiserpermanente.org",
  "irs.gov",
  "usps.com",
  "ssa.gov",
  "1password.com",
  "lastpass.com",
  "bitwarden.com",
  "dashlane.com",
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "mail.yahoo.com",
  "drive.google.com",
  "dropbox.com",
  "onedrive.live.com",
  "workday.com",
  "adp.com",
  "gusto.com",
  "coinbase.com",
  "binance.com",
  "robinhood.com",
];

export const ALWAYS_SKIP_PATH_PATTERNS: readonly RegExp[] = [
  /\/checkout\//i,
  /\/payment\//i,
  /\/account\/security/i,
  /\/login/i,
  /\/signin/i,
  /\/auth/i,
  /\/oauth/i,
];

export function shouldAlwaysSkipUrl(urlStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  for (const d of ALWAYS_SKIP_DOMAINS) {
    const dom = d.toLowerCase();
    if (host === dom || host.endsWith(`.${dom}`)) return true;
  }

  const pathAndQuery = `${url.pathname}${url.search}`;
  for (const re of ALWAYS_SKIP_PATH_PATTERNS) {
    if (re.test(pathAndQuery)) return true;
  }

  return false;
}
