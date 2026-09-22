import { Readability } from "@mozilla/readability";
import { stripIndexedTextNoise } from "../lib/capture/text-noise";

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
  // Sites name their skip links every way there is ("Skip to sidebar", "Skip
  // to aside"), so match what the link says rather than what it is called.
  root.querySelectorAll('a[href^="#"]').forEach((el) => {
    if (/^\s*skip to\b/i.test(el.textContent ?? "")) el.parentNode?.removeChild(el);
  });

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

export interface ExtractOptions {
  /**
   * Document-order indexes of tables already captured as table chunks
   * (Phase 5.7); they are left out of the article text so rows are not
   * indexed twice.
   */
  dropTableIndexes?: number[];
}

/** Sanitized copy of the page without the given tables (text fallbacks read it). */
function withoutTables(doc: Document, indexes: number[]): Document {
  const copy = doc.cloneNode(true) as Document;
  const tables = copy.querySelectorAll("table");
  const drop = new Set(indexes);
  const dead: Element[] = [];
  tables.forEach((t, i) => {
    if (drop.has(i)) dead.push(t);
  });
  for (const t of dead) t.parentNode?.removeChild(t);
  sanitizeDomForExtraction(copy);
  return copy;
}

/**
 * @param hostnameHint Optional host when `doc` has no `location` (e.g. DOMParser output).
 */
export function extractPageText(
  doc: Document,
  hostnameHint?: string,
  opts: ExtractOptions = {}
): ExtractResult {
  const host =
    hostnameHint ??
    (typeof doc.location?.hostname === "string" ? doc.location.hostname : "");

  const dropping = (opts.dropTableIndexes?.length ?? 0) > 0;
  // When tables were captured separately, every text candidate comes from a
  // sanitized copy without them (a detached copy has no layout, so innerText
  // falls back to textContent there).
  const source = dropping ? withoutTables(doc, opts.dropTableIndexes!) : doc;

  const clone = source.cloneNode(true) as Document;
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

  const bodyFallback = normalizeWs(
    (dropping ? source.body?.textContent : source.body?.innerText) || ""
  );
  const mainFallback = dropping ? "" : extractMainColumnFallback(doc, host);

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
