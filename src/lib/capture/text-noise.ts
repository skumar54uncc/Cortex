/**
 * Page chrome that survives extraction and then reads as content.
 *
 * Accessibility skip links sit first in the DOM, so on sites whose main column
 * Readability cannot find (LinkedIn above all) the first words of the "text"
 * are "Skip to sidebar Skip to primary content Skip to aside". That text is
 * what a summary is built from, so it led every People card.
 *
 * Text only: nothing here touches the network and nothing is stored beyond
 * what the caller already had.
 */

/** Targets seen in real skip links. Longest first so "main content" wins. */
const SKIP_TARGETS = [
  "active conversation details",
  "primary content",
  "search results",
  "message list",
  "main content",
  "page content",
  "top of page",
  "navigation",
  "conversation",
  "sidebar",
  "comments",
  "content",
  "results",
  "footer",
  "search",
  "player",
  "aside",
  "feed",
  "menu",
  "main",
  "chat",
  "nav",
]
  .sort((a, b) => b.length - a.length)
  .join("|");

const SKIP_LINK_RE = new RegExp(`\\bskip to (?:the )?(?:${SKIP_TARGETS})\\b`, "gi");

/** Buttons LinkedIn renders next to a name; only a run of them is chrome. */
const ACTION_RUN_RE =
  /\b(?:More|Message|Connect|Follow|Following|Save|Share profile|View profile)\b(?:\s+\b(?:More|Message|Connect|Follow|Following|Save)\b)+/g;

const PRONOUN_CHIP_RE = /\b(?:She\/Her|He\/Him|They\/Them)\b/gi;

/** Collapse repeated LinkedIn / a11y chrome that still leaks into extracted strings */
export function stripIndexedTextNoise(text: string, hostname: string): string {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return t;

  const patterns: RegExp[] = [
    SKIP_LINK_RE,
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

const MAX_SUMMARY_CHARS = 200;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trailing separators, and the stray connection counter LinkedIn leaves. */
function trimEdges(t: string): string {
  let out = t;
  for (let i = 0; i < 4; i++) {
    out = out
      .replace(/^[\s·|,:;\-\u2013\u2014/]+/, "")
      .replace(/[\s·|,:;\-\u2013\u2014/]+$/, "")
      .replace(/\s*·\s*\d{1,3}$/, "")
      .trim();
  }
  return out;
}

/**
 * What a People card should show under the name: the profile in the person's
 * own words, with the page's chrome and the name itself taken out.
 */
export function cleanProfileSummary(summary: string, name = ""): string {
  let t = stripIndexedTextNoise(summary, "linkedin.com");
  if (!t) return "";

  t = t.replace(ACTION_RUN_RE, " ").replace(PRONOUN_CHIP_RE, " ");

  const person = String(name ?? "").replace(/\s+/g, " ").trim();
  if (person.length >= 3) {
    t = t.replace(new RegExp(`\\b${escapeRe(person)}\\b`, "gi"), " ");
  }

  t = trimEdges(t.replace(/\s+/g, " ").trim());
  if (!t) return "";

  if (t.length > MAX_SUMMARY_CHARS) {
    const cut = t.slice(0, MAX_SUMMARY_CHARS - 1);
    const lastSpace = cut.lastIndexOf(" ");
    t = `${trimEdges(lastSpace > 40 ? cut.slice(0, lastSpace) : cut)}…`;
  }
  return t;
}
