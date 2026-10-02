/**
 * Shared empty-state copy for popup, options Library, overlay Ask / search / digest.
 * Truthful lead + one next step. No marketing headlines. No em dashes.
 */

export const EMPTY_LIBRARY_LEAD = "No pages in your library yet.";
export const EMPTY_LIBRARY_NEXT = "Browse normally. Cortex saves pages on this device.";

export const EMPTY_VISITS_LEAD = "No visits logged yet.";
export const EMPTY_VISITS_NEXT = "Keep browsing. Recent pages show up here.";

export const EMPTY_SEARCH_TITLE = "No matching pages in your library.";
export const EMPTY_SEARCH_TIPS = [
  "Try fewer words or a phrase you remember.",
  "Include a site or topic.",
  "Visit more pages. Your index grows as you read.",
] as const;

export const EMPTY_ASK_TITLE = "Ask about pages you have read.";
export const EMPTY_ASK_HINT =
  "Answers stay grounded in your local library, with citations.";

export function emptyDigestTitle(rangeLabel: string): string {
  return `Nothing indexed for ${rangeLabel}.`;
}
