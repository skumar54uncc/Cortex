import { Readability } from "@mozilla/readability";

export interface ExtractResult {
  title: string;
  text: string;
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const REMOVE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "SVG",
  "TEMPLATE",
]);

/** Remove global nav / notification shells that Readability often folds into “content” on SPAs. */
function stripSiteChromeLandmarks(
  root: Document | DocumentFragment,
  hostname: string
): void {
  const skipSelectors = [
    'a[href^="#"][class*="skip"]',
    "[data-test-link-name='skip-nav']",
    ".skip-link",
    "[class*='skip-to-content']",
  ];
  for (const sel of skipSelectors) {
    root.querySelectorAll(sel).forEach((el) => el.parentNode?.removeChild(el));
  }

  const host = hostname.toLowerCase();
  if (!host.includes("linkedin.com")) return;

  const rm = [
    "nav",
    "header",
    "footer",
    '[role="navigation"]',
    '[role="banner"]',
    ".global-nav",
    "#global-nav",
    ".share-box-feed-entry__closed-caption",
    ".msg-overlay-list-bubble-header",
    ".top-card-layout__entity-info-aside",
    "aside.scaffold-layout__aside",
  ];
  for (const sel of rm) {
    root.querySelectorAll(sel).forEach((el) => el.parentNode?.removeChild(el));
  }
}

/** Collapse repeated LinkedIn / a11y chrome that still leaks into extracted strings */
function stripIndexedTextNoise(text: string, hostname: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;

  const patterns: RegExp[] = [
    /\bskip to (?:main )?content\b/gi,
    /\bskip to search\b/gi,
    /\bclicked?\s+apply\b/gi,
    /\d+\s+notifications?\b/gi,
    /\bJob moved to\b[^.]{0,120}\./gi,
    /\bUnder\b\s+Clicked apply\b/gi,
    /\bOpen\s+(?:candidate\s+)?profile\b/gi,
  ];

  if (hostname.toLowerCase().includes("linkedin.com")) {
    patterns.push(
      /(\b(?:Home|My Network|Jobs|Messaging|Notifications|Me|For Business|Advertise)\b\s*){4,}/gi
    );
  }

  for (const re of patterns) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Strip scripts, forms, inputs, and rich-media chrome before Readability.
 * Reduces risk of indexing credentials / tokens that appear in DOM widgets.
 */
export function sanitizeDomForExtraction(root: Document | DocumentFragment): void {
  const dead: Element[] = [];

  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName;
    if (REMOVE_TAGS.has(tag)) {
      dead.push(el);
      return;
    }
    if (tag === "FORM") {
      dead.push(el);
      return;
    }
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      tag === "DATALIST" ||
      tag === "OPTION" ||
      tag === "LABEL"
    ) {
      dead.push(el);
    }
  });

  for (const el of dead) {
    el.parentNode?.removeChild(el);
  }

  const stripSelectors = [
    "[data-sensitive]",
    '[autocomplete="cc-number"]',
    '[autocomplete="cc-csc"]',
    '[autocomplete="one-time-code"]',
  ];
  for (const sel of stripSelectors) {
    root.querySelectorAll(sel).forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  }

  root.querySelectorAll("[contenteditable]").forEach((el) => {
    el.removeAttribute("contenteditable");
  });
}

/** Pull likely main column text on SPAs where Readability returns thin shells */
function extractMainColumnFallback(doc: Document, host: string): string {
  const parts: string[] = [];

  const main =
    doc.querySelector('[role="main"]') ??
    doc.querySelector("main") ??
    doc.querySelector("#main-content");

  if (main) parts.push(normalizeWs((main as HTMLElement).innerText || ""));

  if (host.includes("linkedin.com")) {
    const scoped =
      doc.querySelector(".scaffold-layout__main") ??
      doc.querySelector(".scaffold-layout-container main") ??
      doc.querySelector('[data-test-id="profile-main-container"]') ??
      doc.querySelector(".profile-content");

    if (scoped) parts.push(normalizeWs((scoped as HTMLElement).innerText || ""));
  }

  if (host.includes("twitter.com") || host === "x.com") {
    const tw =
      doc.querySelector('[data-testid="primaryColumn"]') ??
      doc.querySelector('article[data-testid="tweet"]')?.parentElement;
    if (tw) parts.push(normalizeWs((tw as HTMLElement).innerText || ""));
  }

  return parts.reduce((best, cur) => (cur.length > best.length ? cur : best), "");
}

/**
 * @param hostnameHint Optional host when `doc` has no `location` (e.g. DOMParser output).
 */
export function extractPageText(doc: Document, hostnameHint?: string): ExtractResult {
  const host =
    hostnameHint ??
    (typeof doc.location?.hostname === "string" ? doc.location.hostname : "");

  const clone = doc.cloneNode(true) as Document;
  sanitizeDomForExtraction(clone);
  stripSiteChromeLandmarks(clone, host);

  let title = (doc.title || "").trim();
  let readableText = "";

  try {
    const parsed = new Readability(clone).parse();
    if (parsed?.textContent?.trim()) {
      readableText = parsed.textContent.trim();
      title = (parsed.title || doc.title || "").trim();
    }
  } catch {
    /* ignore */
  }

  const bodyFallback = normalizeWs(doc.body?.innerText || "");
  const mainFallback = extractMainColumnFallback(doc, host);

  const candidates = [readableText, bodyFallback, mainFallback].filter(Boolean);
  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a), "");

  const text = stripIndexedTextNoise(longest, host);
  const titleClean = stripIndexedTextNoise(title, host);

  return {
    title: titleClean || title,
    text,
  };
}

/** Parse fetched HTML (service worker / extension pages). `pageUrl` drives hostname-specific fallbacks. */
export function extractPageTextFromHtml(
  html: string,
  pageUrl: string
): ExtractResult {
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* ignore */
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return extractPageText(doc, host);
}
