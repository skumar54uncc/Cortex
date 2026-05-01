/**
 * Normalize user- or model-produced URLs for href / chrome.tabs.create.
 * Blocks javascript:, data:, chrome-extension: opener abuse from string payloads.
 */
export function safeHttpHttpsHref(urlString: string): string | null {
  try {
    const u = new URL(urlString.trim());
    if (
      (u.protocol === "http:" || u.protocol === "https:") &&
      u.hostname.length > 0
    ) {
      return u.href;
    }
  } catch {
    /* ignore */
  }
  return null;
}
