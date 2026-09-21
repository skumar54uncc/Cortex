import { describe, it, expect } from "vitest";
import {
  KEYBOARD_CAPTURING_HOSTS,
  choosePanelMode,
  isKeyboardCapturingHost,
  normalizePanelPreference,
  type ChoosePanelModeInput,
  type PanelMode,
  type PanelModeReason,
  type PanelPreference,
} from "../src/lib/panel-mode";

type Row = {
  name: string;
  url: string | undefined | null;
  preference?: PanelPreference;
  mode: PanelMode;
  reason: PanelModeReason;
};

/**
 * The decision table. Every rule, in the order it is applied, plus the
 * "looks similar but is not" cases that a substring match would get wrong.
 */
const TABLE: Row[] = [
  // ---- Rule 1: not an injectable http(s) page -> side panel (today's behaviour)
  {
    name: "chrome:// page",
    url: "chrome://extensions",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "chrome new tab",
    url: "chrome://newtab/",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "edge:// page",
    url: "edge://settings",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "extension page",
    url: "chrome-extension://abc/search-shell.html",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "devtools page",
    url: "devtools://devtools/bundled/inspector.html",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "file:// page",
    url: "file:///C:/notes.html",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "local PDF",
    url: "file:///C:/report.pdf",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "about:blank",
    url: "about:blank",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "view-source of a web page",
    url: "view-source:https://claude.ai/",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "empty url",
    url: "",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "missing url",
    url: undefined,
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "http(s) prefix with no host",
    url: "https://",
    mode: "side-panel",
    reason: "not-injectable",
  },

  // ---- Rule 1 continued: https pages Chrome still refuses to script
  {
    name: "Chrome Web Store (new host)",
    url: "https://chromewebstore.google.com/detail/cortex/abcdef",
    mode: "side-panel",
    reason: "extension-gallery",
  },
  {
    name: "Chrome Web Store (legacy host + path)",
    url: "https://chrome.google.com/webstore/detail/cortex/abcdef",
    mode: "side-panel",
    reason: "extension-gallery",
  },
  {
    name: "chrome.google.com outside /webstore is an ordinary page",
    url: "https://chrome.google.com/chrome/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "a host merely ending in the word chromewebstore is not the store",
    url: "https://notchromewebstore.google.com.example/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "remote PDF (Chrome's viewer, no content scripts)",
    url: "https://example.com/report.pdf",
    mode: "side-panel",
    reason: "pdf",
  },
  {
    name: "remote PDF, uppercase extension",
    url: "https://example.com/REPORT.PDF",
    mode: "side-panel",
    reason: "pdf",
  },
  {
    name: "remote PDF with query and hash",
    url: "https://example.com/a/report.pdf?dl=1#page=3",
    mode: "side-panel",
    reason: "pdf",
  },
  {
    name: "a path segment called pdf is not a PDF",
    url: "https://example.com/pdf/how-to-read",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "an html page about PDFs is not a PDF",
    url: "https://example.com/report.pdf.html",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "a host called pdf is not a PDF",
    url: "https://pdf.example.com/",
    mode: "overlay",
    reason: "default",
  },

  // ---- Rule 2: the user asked for the side panel everywhere
  {
    name: "always-side-panel on an ordinary page",
    url: "https://example.com/article",
    preference: "always-side-panel",
    mode: "side-panel",
    reason: "user-preference",
  },
  {
    name: "always-side-panel still reports the restricted reason first",
    url: "chrome://extensions",
    preference: "always-side-panel",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "always-overlay opts out of the host list",
    url: "https://claude.ai/chat/1",
    preference: "always-overlay",
    mode: "overlay",
    reason: "user-preference",
  },
  {
    name: "always-overlay cannot override a restricted page",
    url: "chrome://newtab/",
    preference: "always-overlay",
    mode: "side-panel",
    reason: "not-injectable",
  },
  {
    name: "always-overlay cannot override a PDF",
    url: "https://example.com/report.pdf",
    preference: "always-overlay",
    mode: "side-panel",
    reason: "pdf",
  },

  // ---- Rule 3: hosts known to fight for the keyboard
  {
    name: "claude.ai (the reported bug)",
    url: "https://claude.ai/chat/8f2c",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "claude.ai with www",
    url: "https://www.claude.ai/",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "a claude.ai subdomain",
    url: "https://app.staging.claude.ai/new",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "claude.ai over http",
    url: "http://claude.ai/",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "host case is ignored",
    url: "https://Claude.AI/chat",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "chatgpt.com",
    url: "https://chatgpt.com/c/123",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "chat.openai.com (legacy ChatGPT)",
    url: "https://chat.openai.com/",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "gemini.google.com",
    url: "https://gemini.google.com/app",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "docs.google.com",
    url: "https://docs.google.com/document/d/1abc/edit",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "sheets.google.com",
    url: "https://sheets.google.com/spreadsheet/d/1",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "slides.google.com",
    url: "https://slides.google.com/presentation/d/1",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "colab notebooks",
    url: "https://colab.research.google.com/drive/1abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "notion.so",
    url: "https://www.notion.so/My-Page-abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "notion.com",
    url: "https://www.notion.com/product",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "figma.com",
    url: "https://www.figma.com/file/abc/Design",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "overleaf.com",
    url: "https://www.overleaf.com/project/abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "codepen.io",
    url: "https://codepen.io/team/pen/abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "stackblitz.com",
    url: "https://stackblitz.com/edit/vite-abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "replit.com",
    url: "https://replit.com/@user/project",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "codesandbox.io",
    url: "https://codesandbox.io/p/sandbox/abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "vscode.dev",
    url: "https://vscode.dev/github/owner/repo",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "github.dev",
    url: "https://github.dev/owner/repo",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "jsfiddle.net",
    url: "https://jsfiddle.net/abc/1/",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "observablehq.com",
    url: "https://observablehq.com/@user/notebook",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "glitch.com",
    url: "https://glitch.com/edit/#!/project",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "excalidraw.com",
    url: "https://excalidraw.com/#room=abc",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },
  {
    name: "miro.com",
    url: "https://miro.com/app/board/abc/",
    mode: "side-panel",
    reason: "keyboard-capturing-host",
  },

  // ---- "looks similar but is not": a substring match would send these to the panel
  {
    name: "notclaude.ai.example is not claude.ai",
    url: "https://notclaude.ai.example/chat",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "claude.ai.evil.example is not claude.ai",
    url: "https://claude.ai.evil.example/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "myclaude.ai is not claude.ai",
    url: "https://myclaude.ai/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "a path that mentions claude.ai is not claude.ai",
    url: "https://example.com/claude.ai/notes",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "a query that mentions claude.ai is not claude.ai",
    url: "https://example.com/search?q=claude.ai",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "google.com itself is not docs.google.com",
    url: "https://www.google.com/search?q=docs",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "mail.google.com is not on the list",
    url: "https://mail.google.com/mail/u/0/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "notdocs.google.com is not docs.google.com",
    url: "https://notdocs.google.com/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "chatgpt.com.example is not chatgpt.com",
    url: "https://chatgpt.com.example/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "notion.so.example is not notion.so",
    url: "https://notion.so.example/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "figma.community.example is not figma.com",
    url: "https://figma.community.example/",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "github.com (not the web editor) keeps the overlay",
    url: "https://github.com/owner/repo/blob/main/index.ts",
    mode: "overlay",
    reason: "default",
  },

  // ---- Rule 4: everything else keeps the in-page overlay
  {
    name: "an ordinary https article",
    url: "https://example.com/blog/post",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "an ordinary http page",
    url: "http://localhost:3000/app",
    mode: "overlay",
    reason: "default",
  },
  {
    name: "youtube keeps the overlay (the key shield handles it)",
    url: "https://www.youtube.com/watch?v=abc",
    mode: "overlay",
    reason: "default",
  },
];

describe("choosePanelMode", () => {
  for (const row of TABLE) {
    it(`${row.mode} (${row.reason}): ${row.name}`, () => {
      const decision = choosePanelMode({
        url: row.url,
        userPreference: row.preference,
      });
      expect({ mode: decision.mode, reason: decision.reason }).toEqual({
        mode: row.mode,
        reason: row.reason,
      });
    });
  }

  it("always explains itself", () => {
    for (const row of TABLE) {
      const decision = choosePanelMode({
        url: row.url,
        userPreference: row.preference,
      });
      expect(decision.detail.length).toBeGreaterThan(0);
    }
  });

  it("names the list entry that matched", () => {
    expect(choosePanelMode({ url: "https://app.claude.ai/x" }).matchedHost).toBe(
      "claude.ai"
    );
    expect(
      choosePanelMode({ url: "https://docs.google.com/document/d/1" })
        .matchedHost
    ).toBe("docs.google.com");
    expect(choosePanelMode({ url: "https://example.com" }).matchedHost).toBe(
      undefined
    );
  });

  it("defaults to auto when no preference is stored", () => {
    expect(choosePanelMode({ url: "https://claude.ai/" }).mode).toBe(
      "side-panel"
    );
    expect(
      choosePanelMode({ url: "https://claude.ai/", userPreference: undefined })
        .mode
    ).toBe("side-panel");
  });

  it("treats an unknown stored preference as auto", () => {
    const decision = choosePanelMode({
      url: "https://example.com",
      userPreference: "nonsense" as unknown as PanelPreference,
    });
    expect(decision.mode).toBe("overlay");
    expect(decision.reason).toBe("default");
  });

  it("survives a missing input object", () => {
    expect(
      choosePanelMode({} as unknown as ChoosePanelModeInput).mode
    ).toBe("side-panel");
  });
});

describe("normalizePanelPreference", () => {
  it("keeps the three known values", () => {
    expect(normalizePanelPreference("auto")).toBe("auto");
    expect(normalizePanelPreference("always-side-panel")).toBe(
      "always-side-panel"
    );
    expect(normalizePanelPreference("always-overlay")).toBe("always-overlay");
  });

  it("falls back to auto for anything else", () => {
    expect(normalizePanelPreference(undefined)).toBe("auto");
    expect(normalizePanelPreference(null)).toBe("auto");
    expect(normalizePanelPreference("")).toBe("auto");
    expect(normalizePanelPreference("sidepanel")).toBe("auto");
    expect(normalizePanelPreference(true)).toBe("auto");
  });
});

describe("isKeyboardCapturingHost", () => {
  it("matches a listed host and its subdomains, never a bare substring", () => {
    expect(isKeyboardCapturingHost("claude.ai")).toBe("claude.ai");
    expect(isKeyboardCapturingHost("www.claude.ai")).toBe("claude.ai");
    expect(isKeyboardCapturingHost("CLAUDE.AI")).toBe("claude.ai");
    expect(isKeyboardCapturingHost("notclaude.ai.example")).toBe(null);
    expect(isKeyboardCapturingHost("claude.ai.example")).toBe(null);
    expect(isKeyboardCapturingHost("xclaude.ai")).toBe(null);
    expect(isKeyboardCapturingHost("")).toBe(null);
  });

  it("covers every entry in the published list, plus a subdomain of each", () => {
    for (const host of KEYBOARD_CAPTURING_HOSTS) {
      expect(isKeyboardCapturingHost(host)).toBe(host);
      expect(isKeyboardCapturingHost(`sub.${host}`)).toBe(host);
      expect(isKeyboardCapturingHost(`not${host}.example`)).toBe(null);
      expect(isKeyboardCapturingHost(`${host}.example`)).toBe(null);
    }
  });

  it("keeps the list lowercase, deduplicated and free of schemes or paths", () => {
    const seen = new Set<string>();
    for (const host of KEYBOARD_CAPTURING_HOSTS) {
      expect(host).toBe(host.toLowerCase());
      expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(seen.has(host)).toBe(false);
      seen.add(host);
    }
    expect(KEYBOARD_CAPTURING_HOSTS).toContain("claude.ai");
  });
});
