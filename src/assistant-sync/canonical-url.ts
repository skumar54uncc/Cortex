/** Query keys kept on a synced URL. Everything else, and the fragment, is dropped. */
export const CANONICAL_QUERY_ALLOWLIST = ["q", "query", "search_query", "v"] as const;

const ALLOWED = new Set<string>(CANONICAL_QUERY_ALLOWLIST);

/** Stable http(s) URL for the sheet. Returns null when the input is not http(s). */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    const name = key.toLowerCase();
    if (ALLOWED.has(name)) kept.push([name, value]);
  }
  kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

export function domainFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}
