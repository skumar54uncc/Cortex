export const SEARCH_ENGINES = [
  "Google",
  "Bing",
  "DuckDuckGo",
  "YouTube",
  "LinkedIn",
  "Google Flights",
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number];

export interface ParsedSearch {
  engine: SearchEngine;
  query: string;
}

function host(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function cleanQuery(value: string | null): string {
  return String(value ?? "")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function googleHost(hostname: string): boolean {
  const h = host(hostname);
  return h === "google.com" || h.startsWith("google.") || h.endsWith(".google.com");
}

/** Pull a search query off a known engine URL. Returns null when there is no text query. */
export function parseSearchQuery(raw: string): ParsedSearch | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const h = host(url.hostname);
  const path = url.pathname.toLowerCase();

  if (googleHost(url.hostname) && path.startsWith("/travel/flights")) {
    const query = cleanQuery(url.searchParams.get("q"));
    return query ? { engine: "Google Flights", query } : null;
  }

  if ((h === "youtube.com" || h === "m.youtube.com") && path.startsWith("/results")) {
    const query = cleanQuery(url.searchParams.get("search_query"));
    return query ? { engine: "YouTube", query } : null;
  }

  if (h === "bing.com" && path.startsWith("/search")) {
    const query = cleanQuery(url.searchParams.get("q"));
    return query ? { engine: "Bing", query } : null;
  }

  if (h === "duckduckgo.com") {
    const query = cleanQuery(url.searchParams.get("q"));
    return query ? { engine: "DuckDuckGo", query } : null;
  }

  if ((h === "linkedin.com" || h.endsWith(".linkedin.com")) && path.startsWith("/search")) {
    const query = cleanQuery(url.searchParams.get("keywords") ?? url.searchParams.get("q"));
    return query ? { engine: "LinkedIn", query } : null;
  }

  if (googleHost(url.hostname) && path.startsWith("/search")) {
    const query = cleanQuery(url.searchParams.get("q"));
    return query ? { engine: "Google", query } : null;
  }

  return null;
}
