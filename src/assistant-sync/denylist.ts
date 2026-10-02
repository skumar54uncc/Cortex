import { isBlockedDomain, looksSensitiveHostname } from "../lib/privacy";
import { shouldAlwaysSkipUrl } from "../lib/sensitive-domains";

export const PASSWORD_INPUT_SELECTOR = 'input[type="password"]';

export type SyncDenyReason = "password" | "sensitive" | "user" | "local" | "browser";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

function browserProtocol(protocol: string): boolean {
  return (
    protocol === "chrome:" ||
    protocol === "chrome-extension:" ||
    protocol === "edge:" ||
    protocol === "about:" ||
    protocol === "devtools:" ||
    protocol === "file:"
  );
}

/**
 * Hard skip for the sync path. Returns null when the page may be stored.
 * Does not change what Cortex indexes locally.
 */
export function syncDenyReason(
  raw: string,
  opts?: { userDomains?: string[]; hasPasswordInput?: boolean }
): SyncDenyReason | null {
  if (opts?.hasPasswordInput) return "password";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "browser";
  }

  if (browserProtocol(url.protocol)) return "browser";
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) return "local";
  if (shouldAlwaysSkipUrl(raw)) return "sensitive";
  if (looksSensitiveHostname(url.hostname, url.pathname)) return "sensitive";
  if (isBlockedDomain(url.hostname, opts?.userDomains ?? [])) return "user";
  return null;
}

export function documentHasPasswordInput(doc: { querySelector: (selector: string) => unknown }): boolean {
  return doc.querySelector(PASSWORD_INPUT_SELECTOR) != null;
}
