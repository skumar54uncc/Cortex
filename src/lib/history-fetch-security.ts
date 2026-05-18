/** Guards for history backfill HTTP fetches (Security Review 1). */

export const HISTORY_FETCH_MAX_BYTES = 5_000_000;

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function isPrivateOrLocalIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateOrLocalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.endsWith(".lan") || h.endsWith(".home")) return true;

  if (h.startsWith("[")) {
    const inner = h.slice(1, -1).toLowerCase();
    if (inner === "::1") return true;
    if (inner.startsWith("fe80:")) return true;
    if (inner.startsWith("fc") || inner.startsWith("fd")) return true;
    return false;
  }

  const v4 = parseIpv4(h);
  if (v4) return isPrivateOrLocalIpv4(v4);
  return false;
}

/** Hosts that block extension-origin fetch (CORS) — skip before fetch to avoid console noise. */
function isExtensionCorsBlockedTarget(hostname: string, pathname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "chromewebstore.google.com") return true;
  if (h === "chrome.google.com" && pathname.toLowerCase().includes("webstore")) {
    return true;
  }
  return false;
}

/** Block RFC1918 / loopback / link-local targets during history import fetch. */
export function isHistoryFetchAllowedUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!u.hostname) return false;
    if (isExtensionCorsBlockedTarget(u.hostname, u.pathname)) return false;
    return !isPrivateOrLocalHostname(u.hostname);
  } catch {
    return false;
  }
}
