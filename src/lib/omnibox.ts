/**
 * Address bar search (Phase 5.2): keyword "cx". Chrome parses suggestion
 * descriptions as XML (<match>, <dim>, <url>), so every piece of page text is
 * escaped before our own markup is added.
 */
import { safeHttpHttpsHref } from "./url-security";

export const OMNIBOX_MAX_SUGGESTIONS = 5;

export function escapeOmniboxXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markMatches(title: string, query: string): string {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  if (!terms.length) return escapeOmniboxXml(title);
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  return title
    .split(re)
    .map((part, i) => (i % 2 === 1 ? `<match>${escapeOmniboxXml(part)}</match>` : escapeOmniboxXml(part)))
    .join("");
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").slice(0, 120);
}

export interface OmniboxHit {
  url: string;
  title: string;
}

export function formatSuggestion(hit: OmniboxHit, query: string): chrome.omnibox.SuggestResult {
  let host = "";
  try {
    host = new URL(hit.url).hostname;
  } catch {
    /* ignore */
  }
  const title = (hit.title || host || hit.url).replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    content: hit.url,
    description: `${markMatches(title, query)} <dim>-</dim> <url>${escapeOmniboxXml(displayUrl(hit.url))}</url>`,
  };
}

export function toSuggestions(hits: OmniboxHit[], query: string): chrome.omnibox.SuggestResult[] {
  const seen = new Set<string>();
  const out: chrome.omnibox.SuggestResult[] = [];
  for (const h of hits) {
    const safe = safeHttpHttpsHref(h.url);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    out.push(formatSuggestion({ ...h, url: safe }, query));
    if (out.length >= OMNIBOX_MAX_SUGGESTIONS) break;
  }
  return out;
}

/** A picked suggestion carries its URL as text; free text opens the best hit. */
export function resolveEnteredUrl(text: string, bestHitUrl: string | null): string | null {
  const direct = safeHttpHttpsHref(text.trim());
  if (direct && /^https?:\/\//i.test(text.trim())) return direct;
  return bestHitUrl ? safeHttpHttpsHref(bestHitUrl) : null;
}
