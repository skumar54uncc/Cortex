/**
 * Where to open Cortex for a tab: the in-page overlay, or the side panel.
 *
 * The overlay lives in a closed shadow root inside the page, which means it
 * shares the page's keyboard. A content script runs in an isolated world, so
 * it cannot stop the page's own key handlers; src/content/key-shield.ts
 * repairs the characters a page cancels with preventDefault, and that is
 * enough for a site that merely binds "/" or Space.
 *
 * It is not enough for an app that pulls focus back to its own composer or
 * editor after every keystroke (claude.ai, reported by the owner). No
 * in-page trick wins that fight, because the app is not cancelling the key,
 * it is taking the caret away. The side panel is a different document with
 * its own focus, so those apps cannot reach it at all.
 *
 * This module is pure: no chrome.* calls, no DOM. Feed it a tab URL and the
 * stored user preference, get back a mode and the reason for it.
 */

import { isInjectableWebUrl } from "./injectable-url";

export type PanelMode = "overlay" | "side-panel";

/** The stored user setting (see `cortexPanelPreference` in the report). */
export type PanelPreference = "auto" | "always-side-panel" | "always-overlay";

export type PanelModeReason =
  /** chrome://, file://, about:, devtools://, view-source: … — no content script. */
  | "not-injectable"
  /** The Chrome Web Store: https, but Chrome refuses to script it. */
  | "extension-gallery"
  /** Chrome's built-in PDF viewer: https, but the overlay cannot be injected. */
  | "pdf"
  /** The user chose a mode for every page. */
  | "user-preference"
  /** The host is on KEYBOARD_CAPTURING_HOSTS. */
  | "keyboard-capturing-host"
  /** An ordinary web page: the in-page overlay, as always. */
  | "default";

export interface PanelModeDecision {
  mode: PanelMode;
  reason: PanelModeReason;
  /** One line, safe to devLog, for support and debugging. */
  detail: string;
  /** The KEYBOARD_CAPTURING_HOSTS entry that matched, when one did. */
  matchedHost?: string;
}

export interface ChoosePanelModeInput {
  /** `chrome.tabs.Tab.url`, which may be missing on a tab Cortex cannot see. */
  url: string | undefined | null;
  /** The stored setting; anything unrecognised (including undefined) is "auto". */
  userPreference?: PanelPreference | string | null;
}

/**
 * Hosts where the in-page overlay loses the keyboard.
 *
 * Each entry is a registrable domain (or one app subdomain of a shared one,
 * e.g. docs.google.com). An entry matches that exact host and any subdomain
 * of it — never a bare substring, so "claude.ai" does not match
 * "notclaude.ai.example" or "claude.ai.evil.example".
 *
 * To extend: add the host, lowercase, no scheme and no path, with a comment
 * saying what it does to the keyboard. tests/panel-mode.test.ts then checks
 * the entry and a subdomain of it automatically.
 *
 * The bar for this list is focus theft, not key binding. A site that only
 * cancels keys (YouTube, GitHub's single-letter shortcuts) is handled by the
 * key shield and keeps the nicer in-page overlay.
 */
export const KEYBOARD_CAPTURING_HOSTS: readonly string[] = [
  // Chat apps that re-focus their composer on every render.
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "aistudio.google.com",
  // Google editors: a hidden contenteditable owns the caret and swallows keys.
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "colab.research.google.com", // Monaco notebook cells.
  // Document apps with their own editor surface and global key bindings.
  "notion.so",
  "notion.com",
  "overleaf.com", // CodeMirror 6.
  // Canvas apps: the whole document is a keyboard-driven tool palette.
  "figma.com",
  "excalidraw.com",
  "miro.com",
  // Browser IDEs and playgrounds (Monaco / CodeMirror, aggressive re-focus).
  "codepen.io",
  "stackblitz.com",
  "replit.com",
  "codesandbox.io",
  "vscode.dev",
  "github.dev",
  "jsfiddle.net",
  "observablehq.com",
  "glitch.com",
];

/** Registrable-domain match: exact host, or a subdomain of it. */
function hostMatchesEntry(host: string, entry: string): boolean {
  return host === entry || host.endsWith(`.${entry}`);
}

/**
 * The KEYBOARD_CAPTURING_HOSTS entry this hostname belongs to, or null.
 * Case-insensitive; a trailing dot ("claude.ai.") is tolerated.
 */
export function isKeyboardCapturingHost(
  hostname: string | undefined | null
): string | null {
  if (typeof hostname !== "string" || !hostname) return null;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  for (const entry of KEYBOARD_CAPTURING_HOSTS) {
    if (hostMatchesEntry(host, entry)) return entry;
  }
  return null;
}

/** Anything unrecognised — including undefined — means "auto". */
export function normalizePanelPreference(
  value: unknown
): PanelPreference {
  return value === "always-side-panel" ||
    value === "always-overlay" ||
    value === "auto"
    ? value
    : "auto";
}

function parseWebUrl(url: string): URL | null {
  if (!isInjectableWebUrl(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname ? parsed : null;
  } catch {
    return null;
  }
}

/** The Chrome Web Store, old host and new: https, but never scriptable. */
function isExtensionGalleryUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (hostMatchesEntry(host, "chromewebstore.google.com")) return true;
  return (
    hostMatchesEntry(host, "chrome.google.com") &&
    /^\/webstore(\/|$)/i.test(parsed.pathname)
  );
}

/** Chrome's PDF viewer replaces the document; the overlay cannot be injected. */
function isPdfUrl(parsed: URL): boolean {
  return /\.pdf$/i.test(parsed.pathname);
}

/**
 * Decide where Cortex should open for a tab.
 *
 * Rules, in order:
 *  1. Not an injectable http(s) page (chrome://, file://, the Web Store,
 *     a PDF) — side panel, exactly as before this module existed.
 *  2. The user pinned a mode — honour it.
 *  3. The host is known to fight for the keyboard — side panel.
 *  4. Otherwise — the in-page overlay.
 */
export function choosePanelMode(
  input: ChoosePanelModeInput
): PanelModeDecision {
  const url = input?.url ?? "";
  const preference = normalizePanelPreference(input?.userPreference);

  const parsed = parseWebUrl(url);
  if (!parsed) {
    return {
      mode: "side-panel",
      reason: "not-injectable",
      detail: "Cortex cannot run inside this page, so it opens in the side panel.",
    };
  }

  if (isExtensionGalleryUrl(parsed)) {
    return {
      mode: "side-panel",
      reason: "extension-gallery",
      detail:
        "Chrome blocks extensions on the Web Store, so Cortex opens in the side panel.",
    };
  }

  if (isPdfUrl(parsed)) {
    return {
      mode: "side-panel",
      reason: "pdf",
      detail: "This is a PDF, so Cortex opens in the side panel.",
    };
  }

  if (preference === "always-side-panel") {
    return {
      mode: "side-panel",
      reason: "user-preference",
      detail: "You asked Cortex to always open in the side panel.",
    };
  }

  if (preference === "always-overlay") {
    return {
      mode: "overlay",
      reason: "user-preference",
      detail: "You asked Cortex to always open on the page.",
    };
  }

  const matchedHost = isKeyboardCapturingHost(parsed.hostname);
  if (matchedHost) {
    return {
      mode: "side-panel",
      reason: "keyboard-capturing-host",
      detail: `${matchedHost} takes the keyboard back from the page, so Cortex opens in the side panel where you can type.`,
      matchedHost,
    };
  }

  return {
    mode: "overlay",
    reason: "default",
    detail: "Cortex opens on the page.",
  };
}
