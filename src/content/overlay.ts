/** XSS / sinks: see docs/INNERHTML_AUDIT.md: escape user- or page-derived text via esc() before HTML interpolation. */
import shadowCss from "./overlay.shadow.css";
import { getBrandFontFaceCss } from "../styles/brand-fonts";

import { confidenceTier } from "./confidence";
import { observePanelLayout } from "./layout-mode";
import { installKeyShield } from "./key-shield";
import { renderMarkdown } from "./markdown-render";
import { createChatDrawerToggle, type ChatDrawerToggle } from "./chat-drawer";
import {
  createPendingDelete,
  filterConversations,
  groupConversationsByRecency,
  type ConversationSummary,
  type PendingDelete,
} from "./chat-history";
import { buildExamplePrompts, type RecentVisitLite } from "./example-prompts";
import {
  isExtensionRuntimeAlive,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import type { ChatStreamEvent } from "../lib/chat/chat-engine";
import {
  ChatStreamController,
  type ChatErrorData,
  type ChatStreamState,
} from "./chat-stream-controller";
import { createStreamRenderer, type StreamRenderer } from "./stream-renderer";
import { createFocusTrap, focusOnceAfterTransition } from "./focus-trap";
import { createForgetMenu } from "./forget-menu";
import { renderPeopleView, type PersonRow } from "./people-view";
import { createScopeBar, type ScopeCollection } from "./scope-bar";
import { applyThemeToHost, themeTokensCss } from "../shared/theme";
import { getUserSettings } from "../shared/extension-settings";
import type { DigestRange, DigestResult } from "../lib/chat/digest-types";
import type { ChunkWithDoc } from "../lib/search-engine";
import { CHAT_LIMITS } from "../lib/limits";
import { safeHttpHttpsHref } from "../lib/url-security";
import { buildSourceItem, citationLink, type StoredCitation } from "./citation-cards";
import { citationDetail, citationHref } from "../lib/kind-labels";
import type { ChunkKind, ChunkLocator } from "../db/schema";
import { ERROR_CODES } from "../lib/errors";

let overlayHost: HTMLDivElement | null = null;
let overlayShadowRoot: ShadowRoot | null = null;

/** Prevent duplicate chrome.runtime / window listeners if mountOverlay ever runs twice */
let overlayListenersInstalled = false;
/** Side-panel / extension shell: fill panel instead of page modal */
let overlayShellMode = false;

/** One controller per mounted overlay; routes CORTEX_CHAT_PUSH by requestId. */
let chatController: ChatStreamController | null = null;
let digestResultSink:
  | ((msg: {
      ok?: boolean;
      result?: DigestResult;
      error?: string;
    }) => void)
  | null = null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

const CORTEX_SETTINGS_PHRASE = "Cortex settings";

/** Plain segment: optionally link the exact phrase "Cortex settings" to the options page. */
function openExtensionOptionsFromOverlay(): void {
  void sendRuntimeMessage({ type: "CORTEX_OPEN_OPTIONS" }).catch(() => {
    /* invalidated extension / no receiver */
  });
}

function appendPlainWithOptionalSettingsLink(
  el: ParentNode,
  chunk: string,
  linkClass: string,
  linkSettingsPhrase: boolean
): void {
  if (!chunk) return;
  if (!linkSettingsPhrase) {
    el.appendChild(document.createTextNode(chunk));
    return;
  }
  let p = 0;
  while (p < chunk.length) {
    const i = chunk.indexOf(CORTEX_SETTINGS_PHRASE, p);
    if (i === -1) {
      el.appendChild(document.createTextNode(chunk.slice(p)));
      break;
    }
    if (i > p) el.appendChild(document.createTextNode(chunk.slice(p, i)));
    const a = document.createElement("a");
    a.href = "#";
    a.setAttribute("data-cortex-open-options", "");
    a.role = "link";
    a.className = linkClass;
    a.textContent = CORTEX_SETTINGS_PHRASE;
    a.title = "Open Cortex settings";
    el.appendChild(a);
    p = i + CORTEX_SETTINGS_PHRASE.length;
  }
}

/** Turn bare URLs in plain text into clickable links (errors, hints, assistant answers). */
function appendTextWithUrls(
  el: ParentNode,
  text: string,
  linkClass: string = "cortex-inline-link",
  options?: { linkCortexSettingsPhrase?: boolean }
): void {
  const linkSettingsPhrase = Boolean(options?.linkCortexSettingsPhrase);
  const re = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      appendPlainWithOptionalSettingsLink(
        el,
        text.slice(last, m.index),
        linkClass,
        linkSettingsPhrase
      );
    }
    const raw = m[1]!;
    const display = raw.replace(/[.,);!?]+$/, "");
    const a = document.createElement("a");
    a.href = safeHttpUrl(display);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = linkClass;
    a.textContent = raw;
    el.appendChild(a);
    last = m.index + m[0].length;
  }
  appendPlainWithOptionalSettingsLink(
    el,
    text.slice(last),
    linkClass,
    linkSettingsPhrase
  );
}

function safeHttpUrl(u: string): string {
  return safeHttpHttpsHref(u) ?? "#";
}

function pageHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

function focusExistingOverlaySearch(): void {
  const input = overlayShadowRoot?.querySelector<HTMLInputElement>(
    ".cortex-search-input"
  );
  input?.focus({ preventScroll: true });
}

export type MountOverlayOptions = {
  /** True when running in search-shell.html (chrome:// fallback side panel). */
  shell?: boolean;
};

export function mountOverlay(opts?: MountOverlayOptions): void {
  overlayShellMode = Boolean(opts?.shell);
  if (overlayListenersInstalled) return;
  overlayListenersInstalled = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CORTEX_OPEN_SEARCH" && !overlayShellMode) {
      openCortexOverlay();
      sendResponse({ ok: true as const });
      return true;
    }
    if (msg?.type === "CORTEX_OPEN_SEARCH_SHELL" && overlayShellMode) {
      openCortexOverlay();
      return undefined;
    }
    if (msg?.type === "CORTEX_CHAT_PUSH") {
      chatController?.handleEvent(
        msg.event as ChatStreamEvent,
        typeof msg.requestId === "number" ? msg.requestId : undefined
      );
      return undefined;
    }
    if (msg?.type === "CORTEX_DIGEST_PUSH") {
      digestResultSink?.(msg);
      return undefined;
    }
    return undefined;
  });
}

function faviconUrlForHost(hostname: string): string {
  const h = hostname.trim().toLowerCase();
  if (!h) return "";
  return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(h)}`;
}

type OverlayMode = "search" | "ask" | "digest" | "people";

/** Opens the panel if closed. Idempotent: avoids double Ctrl+Shift+K (command + key handler). */
export function openCortexOverlay(): void {
  if (!isExtensionRuntimeAlive()) return;

  const existingRoot = document.getElementById("cortex-overlay-root");
  if (existingRoot?.isConnected) {
    focusExistingOverlaySearch();
    return;
  }

  existingRoot?.remove();
  overlayHost = null;
  overlayShadowRoot = null;

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement("div");
  host.id = "cortex-overlay-root";
  if (overlayShellMode) {
    host.classList.add("cortex-overlay-host--shell");
  }

  const shadow = host.attachShadow({
    mode: __CORTEX_DEBUG__ || __CORTEX_E2E_OPEN_SHADOW__ ? "open" : "closed",
  });
  overlayShadowRoot = shadow;

  const iconUrl = chrome.runtime.getURL("icons/icon-48.png");

  const style = document.createElement("style");
  style.textContent = `${getBrandFontFaceCss()}
${themeTokensCss()}
${shadowCss}`;
  shadow.appendChild(style);

  // Theme: light / dark / system (Phase 2.6). Applied before first paint from
  // the default, then refreshed once storage answers.
  const applyTheme = (setting: Parameters<typeof applyThemeToHost>[1]): (() => void) => {
    const stopHost = applyThemeToHost(host, setting);
    // Side panel shell: mirror on <html> so the page background matches.
    const stopDoc = overlayShellMode
      ? applyThemeToHost(document.documentElement, setting)
      : () => undefined;
    return () => {
      stopHost();
      stopDoc();
    };
  };
  let stopTheme = applyTheme("system");
  /** People tab visible only while people memory is on (Phase 5.1). */
  let peopleTabEnabled = false;
  void getUserSettings()
    .then((s) => {
      if (!host.isConnected) return;
      stopTheme();
      stopTheme = applyTheme(s.theme);
      if (s.peopleMemoryEnabled !== peopleTabEnabled) {
        peopleTabEnabled = s.peopleMemoryEnabled;
        rebuildTabs();
      }
    })
    .catch(() => undefined);

  const shell = document.createElement("div");
  shell.className = "cortex-shell";
  shell.innerHTML = `
    <div class="cortex-backdrop" data-act="close"></div>
    <div class="cortex-panel" role="dialog" aria-modal="true" aria-labelledby="cortex-overlay-title" aria-describedby="cortex-overlay-tagline">
      <div id="cortex-announcer" class="cortex-sr-only" aria-live="polite" aria-atomic="true"></div>
      <div class="cortex-head">
        <div class="cx-brand">
          <span class="cx-brand-link" aria-hidden="true">
            <img class="cx-brand-mark" src="${iconUrl}" alt="" width="26" height="26" />
          </span>
          <div class="cx-brand-text">
            <span id="cortex-overlay-title" class="cx-brand-wordmark">Cortex</span>
            <span id="cortex-overlay-tagline" class="cx-brand-tagline">Private memory from pages you read</span>
          </div>
        </div>
        <div class="cortex-head-actions">
          <button
            type="button"
            class="cortex-icon-btn"
            data-cortex-open-options
            aria-label="Privacy and settings"
            title="Privacy and settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button type="button" class="cortex-x" data-act="close" aria-label="Close">×</button>
        </div>
      </div>
      <p id="cortex-forget-status" class="cortex-forget-status" role="status" hidden></p>
      <div class="cortex-tabs" role="tablist"></div>
      <div class="cortex-body"></div>
    </div>
  `;
  shadow.appendChild(shell);

  try {
    const mountParent = overlayShellMode ? document.body : document.documentElement;
    mountParent.appendChild(host);
    overlayHost = host;
  } catch {
    overlayHost = null;
    overlayShadowRoot = null;
    return;
  }

  const panel = shell.querySelector<HTMLElement>(".cortex-panel")!;
  const tabBar = shell.querySelector<HTMLElement>(".cortex-tabs")!;
  const bodyEl = shell.querySelector<HTMLElement>(".cortex-body")!;

  const stopLayoutObserver = observePanelLayout(
    panel,
    panel.getBoundingClientRect().width || window.innerWidth
  );

  const announcePolite = (text: string): void => {
    const el = shell.querySelector<HTMLElement>("#cortex-announcer");
    if (!el) return;
    el.textContent = "";
    window.requestAnimationFrame(() => {
      el.textContent = text;
    });
  };

  // Forget controls in the header (Phase 4.3).
  const forgetMenu = createForgetMenu({
    shell: overlayShellMode,
    send: (m) => sendRuntimeMessage(m),
    onDone: (message) => {
      announcePolite(message);
      const status = shell.querySelector<HTMLElement>("#cortex-forget-status");
      if (status) {
        status.textContent = message;
        status.hidden = false;
        window.setTimeout(() => {
          status.hidden = true;
        }, 6000);
      }
      if (currentMode === "ask") void refreshChatSidebar();
    },
  });
  shell
    .querySelector<HTMLElement>(".cortex-head-actions")
    ?.insertBefore(forgetMenu.root, shell.querySelector("[data-cortex-open-options]"));

  /** Collection that Search and Ask are scoped to (Phase 5.4); null = all pages. */
  let activeCollectionId: number | null = null;

  const makeScopeBar = (onChange?: () => void) => {
    const bar = createScopeBar({
      list: async () => {
        const res = (await sendRuntimeMessage({ type: "CORTEX_COLLECTIONS_LIST" })) as
          | { ok?: boolean; collections?: ScopeCollection[] }
          | undefined;
        return res?.ok ? res.collections ?? [] : [];
      },
      addPage: async (collectionId) =>
        ((await sendRuntimeMessage({ type: "CORTEX_COLLECTION_ADD_PAGE", collectionId })) as
          | { ok?: boolean; error?: string }
          | undefined) ?? { ok: false },
      onChange: (id) => {
        activeCollectionId = id;
        onChange?.();
      },
      showAddPage: !overlayShellMode,
      announce: announcePolite,
      initial: activeCollectionId,
    });
    void bar.refresh();
    return bar;
  };

  let currentMode: OverlayMode = "search";
  let currentConversationId: number | null = null;

  let selectedHitIndex = -1;
  let searchTimer: number | undefined;

  const applyHitSelection = (): void => {
    shell.querySelectorAll<HTMLElement>(".cortex-hit-card").forEach((el, i) => {
      const on = i === selectedHitIndex;
      el.classList.toggle("cortex-hit-card-selected", on);
      if (on) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
      if (on) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  const getSearchInput = (): HTMLInputElement | null =>
    shell.querySelector<HTMLInputElement>(".cortex-search-input");

  const getAskInput = (): HTMLTextAreaElement | null =>
    shell.querySelector<HTMLTextAreaElement>(".cortex-ask-input");

  const focusAskInput = (ta: HTMLTextAreaElement): void => {
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    try {
      ta.setSelectionRange(end, end);
    } catch {
      /* ignore */
    }
  };

  const focusPrimaryField = (): void => {
    if (currentMode === "search") {
      getSearchInput()?.focus({ preventScroll: true });
    } else if (currentMode === "ask") {
      const ta = getAskInput();
      if (ta) focusAskInput(ta);
    }
  };

  /** Single focus after the open transition (Phase 2.5); no retry bursts. */
  let cancelInitialFocus: (() => void) | null = null;

  const onOverlayNavKey = (ev: KeyboardEvent): void => {
    if (!overlayHost || currentMode !== "search") return;
    // Arrow keys belong to the forget menu while it has focus.
    if (shadow.activeElement?.closest(".cortex-menu")) return;
    const input = getSearchInput();
    if (!input) return;

    const hits = [...shell.querySelectorAll<HTMLElement>(".cortex-hit-card")];
    if (!hits.length) return;

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      ev.stopPropagation();
      if (selectedHitIndex < 0) selectedHitIndex = 0;
      else selectedHitIndex = Math.min(selectedHitIndex + 1, hits.length - 1);
      applyHitSelection();
      hits[selectedHitIndex]?.querySelector<HTMLElement>(".cortex-hit-link")?.focus({ preventScroll: true });
      return;
    }

    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      if (selectedHitIndex <= 0) {
        selectedHitIndex = -1;
        applyHitSelection();
        input.focus({ preventScroll: true });
        return;
      }
      selectedHitIndex--;
      applyHitSelection();
      hits[selectedHitIndex]?.querySelector<HTMLElement>(".cortex-hit-link")?.focus({ preventScroll: true });
      return;
    }

    if (ev.key === "Enter") {
      if (selectedHitIndex < 0) return;

      const bg = ev.ctrlKey || ev.metaKey;
      const idx = selectedHitIndex;
      if (idx < 0 || idx >= hits.length) return;

      ev.preventDefault();
      ev.stopPropagation();

      const link = hits[idx]?.querySelector<HTMLAnchorElement>(".cortex-hit-link");
      const url = link?.href;
      if (bg && url && url !== "#") {
        void chrome.runtime.sendMessage({
          type: "CORTEX_OPEN_TAB",
          url,
          active: false,
        });
      } else {
        link?.click();
      }
    }
  };

  const focusTrap = createFocusTrap(panel, {
    restoreTo: previousFocus,
    onEscape: () => closeOverlay(),
  });

  const onKeyCaptureRedirect = (ev: KeyboardEvent): void => {
    if (!overlayHost || currentMode !== "search") return;
    const input = getSearchInput();
    if (!input) return;

    const sr = host.shadowRoot;
    if (!sr || sr.activeElement === input) return;
    if (ev.isComposing) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "Escape") return;

    const target = ev.target as Node | null;
    if (target && sr.contains(target)) return;

    const typing =
      (ev.key.length === 1 && !ev.repeat) ||
      ev.key === "Backspace" ||
      ev.key === "Delete";

    if (!typing) return;

    ev.preventDefault();
    ev.stopPropagation();

    input.focus({ preventScroll: true });

    if (ev.key.length === 1 && !ev.repeat) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value =
        input.value.slice(0, start) + ev.key + input.value.slice(end);
      input.setSelectionRange(start + 1, start + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (ev.key === "Backspace") {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      if (start !== end) {
        input.value = input.value.slice(0, start) + input.value.slice(end);
        input.setSelectionRange(start, start);
      } else if (start > 0) {
        input.value =
          input.value.slice(0, start - 1) + input.value.slice(start);
        input.setSelectionRange(start - 1, start - 1);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (ev.key === "Delete") {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      if (start !== end) {
        input.value = input.value.slice(0, start) + input.value.slice(end);
        input.setSelectionRange(start, start);
      } else if (start < input.value.length) {
        input.value =
          input.value.slice(0, start) + input.value.slice(start + 1);
        input.setSelectionRange(start, start);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  shell.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-cortex-open-options]")) {
      e.preventDefault();
      openExtensionOptionsFromOverlay();
      return;
    }
    const t = (e.target as HTMLElement).closest("[data-act]");
    if (t?.getAttribute("data-act") === "close") closeOverlay();
  });

  document.addEventListener("keydown", onOverlayNavKey, true);
  document.addEventListener("keydown", onKeyCaptureRedirect, true);
  // Pages bind their own keys (YouTube plays or pauses on Space): keep every
  // key pressed inside the panel away from them (src/content/key-shield.ts).
  const removeKeyShield = installKeyShield(host);
  focusTrap.activate();

  function rebuildTabs(): void {
    tabBar.innerHTML = "";
    const tabs: Array<{ id: OverlayMode; label: string }> = [
      { id: "search", label: "Search" },
      { id: "ask", label: "Ask" },
      { id: "digest", label: "Digest" },
      ...(peopleTabEnabled ? [{ id: "people" as OverlayMode, label: "People" }] : []),
    ];

    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cortex-tab ${currentMode === tab.id ? "cortex-tab--active" : ""}`;
      btn.textContent = tab.label;
      btn.setAttribute("aria-label", `${tab.label} tab`);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(currentMode === tab.id));
      btn.addEventListener("click", () => switchMode(tab.id));
      tabBar.appendChild(btn);
    }
  }

  let askSidebarListEl: HTMLElement | null = null;
  let askDrawerToggle: ChatDrawerToggle | null = null;
  let askSidebarFilterEl: HTMLInputElement | null = null;
  let askUndoToastEl: HTMLElement | null = null;
  let sidebarConvs: ConversationSummary[] = [];
  let sidebarFilter = "";
  const pendingDeletes = new Map<number, PendingDelete>();

  async function commitDeleteConversation(convId: number): Promise<void> {
    pendingDeletes.delete(convId);
    const res = (await sendRuntimeMessage({
      type: "CORTEX_CHAT_DELETE",
      conversationId: convId,
    })) as { ok?: boolean } | undefined;
    if (!res?.ok) return;
    sidebarConvs = sidebarConvs.filter((c) => c.id !== convId);
    if (currentConversationId === convId) {
      currentConversationId = null;
      if (askMessagesEl) renderChatThread(askMessagesEl, []);
    }
  }

  function hideUndoToast(): void {
    askUndoToastEl?.remove();
    askUndoToastEl = null;
  }

  function showUndoToast(label: string, onUndo: () => void): void {
    hideUndoToast();
    const toast = document.createElement("div");
    toast.className = "cortex-undo-toast";
    toast.setAttribute("role", "status");
    const text = document.createElement("span");
    text.className = "cortex-undo-toast-text";
    text.textContent = `Deleted "${label}"`;
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "cortex-undo-toast-btn";
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      onUndo();
      hideUndoToast();
    });
    toast.append(text, undo);
    askSidebarListEl?.parentElement?.appendChild(toast);
    askUndoToastEl = toast;
    undo.focus({ preventScroll: true });
  }

  /** Hides the row now, deletes after 5s unless undone (Phase 2.7). */
  function deleteChatConversation(convId: number, label: string): void {
    pendingDeletes.get(convId)?.flush();
    const pd = createPendingDelete(convId, async (id) => {
      await commitDeleteConversation(id);
      if (askUndoToastEl && pendingDeletes.size === 0) hideUndoToast();
      renderChatSidebarList();
    });
    pendingDeletes.set(convId, pd);
    renderChatSidebarList();
    showUndoToast(label, () => {
      pd.undo();
      pendingDeletes.delete(convId);
      renderChatSidebarList();
    });
    if (askTextareaEl && !askUndoToastEl) focusAskInput(askTextareaEl);
  }

  function flushPendingDeletes(): void {
    for (const pd of pendingDeletes.values()) pd.flush();
    pendingDeletes.clear();
  }

  function sidebarRows(): HTMLElement[] {
    return askSidebarListEl
      ? [...askSidebarListEl.querySelectorAll<HTMLElement>(".cortex-chat-history-item")]
      : [];
  }

  function onSidebarKey(ev: KeyboardEvent): void {
    const rows = sidebarRows();
    if (!rows.length) return;
    const active = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
      ".cortex-chat-history-item"
    );
    const idx = active ? rows.indexOf(active) : -1;
    let next: number | null = null;
    if (ev.key === "ArrowDown") next = Math.min(rows.length - 1, idx + 1);
    else if (ev.key === "ArrowUp") next = Math.max(0, idx - 1);
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = rows.length - 1;
    else if ((ev.key === "Delete" || ev.key === "Backspace") && active) {
      ev.preventDefault();
      const id = Number(active.getAttribute("data-conversation-id"));
      const label = active.getAttribute("title") || "chat";
      if (Number.isFinite(id)) deleteChatConversation(id, label);
      return;
    } else return;
    ev.preventDefault();
    for (const r of rows) r.tabIndex = -1;
    const target = rows[next];
    target.tabIndex = 0;
    target.focus({ preventScroll: true });
  }

  function renderChatSidebarList(): void {
    const list = askSidebarListEl;
    if (!list) return;
    list.innerHTML = "";

    const visible = filterConversations(
      sidebarConvs.filter((c) => !pendingDeletes.has(c.id)),
      sidebarFilter
    );
    askDrawerToggle?.setCount(sidebarConvs.length);

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "cortex-chat-sidebar-empty cortex-muted";
      empty.textContent = sidebarFilter.trim()
        ? "No chats match your filter."
        : "No past chats yet.";
      list.appendChild(empty);
      return;
    }

    const groups = groupConversationsByRecency(visible, Date.now());
    let firstRow: HTMLButtonElement | null = null;
    for (const group of groups) {
      const heading = document.createElement("div");
      heading.className = "cortex-chat-group-label";
      heading.textContent = group.label;
      list.appendChild(heading);

      for (const conv of group.items) {
        const label = conv.title || "Untitled chat";
        const row = document.createElement("div");
        row.className = "cortex-chat-history-row";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cortex-chat-history-item";
        btn.setAttribute("data-conversation-id", String(conv.id));
        btn.title = label;
        btn.tabIndex = -1;
        const isActive = conv.id === currentConversationId;
        if (isActive) btn.setAttribute("aria-current", "true");
        if (isActive) btn.classList.add("cortex-chat-history-item--active");
        const title = document.createElement("span");
        title.className = "cortex-chat-history-title";
        title.textContent = label;
        const when = document.createElement("span");
        when.className = "cortex-chat-history-when";
        when.textContent = new Date(conv.updatedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        btn.append(title, when);
        btn.addEventListener("click", () => {
          currentConversationId = conv.id;
          void loadChatConversation(conv.id, askMessagesEl!);
          renderChatSidebarList();
          askDrawerToggle?.close();
        });
        if (!firstRow || isActive) firstRow = btn;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "cortex-chat-history-delete";
        delBtn.setAttribute("aria-label", `Delete chat: ${label}`);
        delBtn.title = "Delete chat";
        delBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
        delBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteChatConversation(conv.id, label);
        });

        row.append(btn, delBtn);
        list.appendChild(row);
      }
    }
    if (firstRow) firstRow.tabIndex = 0;
  }

  async function refreshChatSidebar(): Promise<void> {
    if (!askSidebarListEl) return;
    const res = (await sendRuntimeMessage({
      type: "CORTEX_CHAT_LIST",
    })) as
      | {
          ok?: boolean;
          conversations?: Array<{ id?: number; title: string; updatedAt: number }>;
        }
      | undefined;
    const list = res?.ok ? res.conversations ?? [] : [];
    sidebarConvs = list
      .filter((c): c is { id: number; title: string; updatedAt: number } => c.id != null)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
    renderChatSidebarList();
  }

  async function loadChatConversation(
    convId: number,
    messagesContainer: HTMLElement
  ): Promise<void> {
    const res = (await sendRuntimeMessage({
      type: "CORTEX_CHAT_LOAD",
      conversationId: convId,
    })) as
      | {
          ok?: boolean;
          messages?: StoredChatMessage[];
        }
      | undefined;

    if (!res?.ok || !res.messages) {
      renderChatThread(messagesContainer, []);
      return;
    }

    renderChatThread(messagesContainer, res.messages);
    scrollChatToBottom(messagesContainer);
  }

  let askMessagesEl: HTMLElement | null = null;
  let askTextareaEl: HTMLTextAreaElement | null = null;

  let activeDigestRange: DigestRange = "yesterday";
  let digestRangeButtons: HTMLButtonElement[] = [];

  function openSearchWithQuery(query: string): void {
    const q = query.trim();
    if (!q) return;
    currentMode = "search";
    panel.setAttribute("data-mode", "search");
    rebuildTabs();
    renderMode();
    window.setTimeout(() => {
      const input = getSearchInput();
      if (!input) return;
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    }, 0);
  }

  function switchMode(mode: OverlayMode): void {
    currentMode = mode;
    panel.setAttribute("data-mode", mode);
    rebuildTabs();
    renderMode();
    requestAnimationFrame(focusPrimaryField);
  }

  function chatNearBottom(el: HTMLElement, thresholdPx = 88): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
  }

  function scrollChatToBottom(el: HTMLElement): void {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  function scrollChatIfFollowing(el: HTMLElement): void {
    if (chatNearBottom(el)) scrollChatToBottom(el);
  }

  /**
   * Model answers are markdown: bullets, bold, code. renderMarkdown builds
   * the DOM with element APIs only (never innerHTML) and calls back for each
   * [N] so citations become links to the cited page, video moment or PDF page.
   */
  function renderAnswerWithCitations(
    text: string,
    chunks: ChunkWithDoc[]
  ): HTMLElement {
    const root = document.createElement("div");
    root.className = "cortex-msg-rich";
    root.appendChild(
      renderMarkdown(text, {
        citation: (n) => {
          const chunk = chunks[n - 1];
          return chunk ? citationLink(chunk, n) : null;
        },
      })
    );
    return root;
  }

  type StoredCited = StoredCitation;

  type StoredChatMessage = {
    role: "user" | "assistant";
    content: string;
    citedChunks?: StoredCited[];
  };

  function chunksFromCited(cited: StoredCited[] | undefined): ChunkWithDoc[] {
    if (!cited?.length) return [];
    return cited.map((c, ord) => ({
      id: c.chunkId,
      documentId: c.documentId,
      ord,
      text: "",
      ...(c.kind ? { kind: c.kind } : {}),
      ...(c.locator ? { locator: c.locator } : {}),
      document: {
        id: c.documentId,
        url: c.url,
        domain: pageHostname(c.url),
        title: c.title,
        summary: "",
        lastVisitedAt: Date.now(),
        visitCount: 1,
        importanceScore: 0,
      },
    })) as ChunkWithDoc[];
  }

  function renderSources(container: Element, chunks: ChunkWithDoc[]): void {
    container.innerHTML = "";
    if (!chunks.length) return;

    const details = document.createElement("details");
    details.className = "cortex-sources-details";

    const summary = document.createElement("summary");
    summary.className = "cortex-sources-toggle";
    summary.textContent = `Show sources (${chunks.length})`;

    const list = document.createElement("div");
    list.className = "cortex-sources-list";

    for (let i = 0; i < chunks.length; i++) {
      list.appendChild(buildSourceItem(chunks[i]!, i));
    }

    details.appendChild(summary);
    details.appendChild(list);
    container.appendChild(details);
  }

  function renderChatThread(
    messagesContainer: HTMLElement,
    messages: StoredChatMessage[]
  ): void {
    messagesContainer.innerHTML = "";
    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cortex-chat-empty";
      const title = document.createElement("p");
      title.className = "cortex-chat-empty-title";
      title.textContent = "What would you like to know?";
      const hint = document.createElement("p");
      hint.className = "cortex-chat-empty-hint cortex-muted";
      hint.textContent =
        "Ask about pages you have read. Answers stay grounded in your local library, with citations.";
      const chips = document.createElement("div");
      chips.className = "cortex-example-chips";
      chips.setAttribute("aria-label", "Example questions");
      empty.append(title, hint, chips);
      messagesContainer.appendChild(empty);
      void renderExampleChips(chips);
      return;
    }

    for (const m of messages) {
      if (m.role === "user") {
        const userEl = document.createElement("div");
        userEl.className = "cortex-msg cortex-msg--user";
        userEl.textContent = m.content;
        messagesContainer.appendChild(userEl);
        continue;
      }

      const cited = chunksFromCited(m.citedChunks);
      const assistantMsgEl = document.createElement("div");
      assistantMsgEl.className = "cortex-msg cortex-msg--assistant";
      const contentEl = document.createElement("div");
      contentEl.className = "cortex-msg-content cortex-msg-rich";
      contentEl.appendChild(renderAnswerWithCitations(m.content, cited));
      assistantMsgEl.appendChild(contentEl);
      const sourcesEl = document.createElement("div");
      sourcesEl.className = "cortex-msg-sources";
      renderSources(sourcesEl, cited);
      assistantMsgEl.appendChild(sourcesEl);
      messagesContainer.appendChild(assistantMsgEl);
    }
  }

  /** Empty state chips built from local data (Phase 2.8); generic on an empty library. */
  async function renderExampleChips(container: HTMLElement): Promise<void> {
    let recent: RecentVisitLite[] = [];
    try {
      const res = (await sendRuntimeMessage({ type: "CORTEX_RECENT_VISITS" })) as
        | { ok?: boolean; recent?: RecentVisitLite[] }
        | undefined;
      if (res?.ok && Array.isArray(res.recent)) recent = res.recent;
    } catch {
      /* generic fallback */
    }
    if (!container.isConnected) return;
    container.innerHTML = "";
    for (const prompt of buildExamplePrompts({ recent })) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cortex-example-chip";
      chip.textContent = prompt;
      chip.addEventListener("click", () => {
        const ta = askTextareaEl;
        const messages = askMessagesEl;
        if (!ta || !messages) return;
        ta.value = prompt;
        messages.querySelector(".cortex-chat-empty")?.remove();
        ta.value = "";
        handleAskSubmit(prompt, messages);
      });
      container.appendChild(chip);
    }
  }

  function renderErrorBlock(data: {
    message: string;
    userAction?: string;
    recoverable?: boolean;
  }): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cortex-chat-error";
    const p = document.createElement("p");
    appendTextWithUrls(p, data.message, "cortex-chat-error-link");
    wrap.appendChild(p);
    if (data.userAction) {
      const hint = document.createElement("p");
      hint.className = "cortex-muted cortex-chat-error-hint";
      appendTextWithUrls(hint, data.userAction, "cortex-chat-error-link", {
        linkCortexSettingsPhrase: true,
      });
      wrap.appendChild(hint);
    }
    return wrap;
  }

  /** DOM targets for the assistant message currently being streamed. */
  type ActiveStream = {
    messagesContainer: HTMLElement;
    contentEl: HTMLElement;
    sourcesEl: HTMLElement;
    cursor: HTMLElement;
    renderer: StreamRenderer;
    citedChunks: ChunkWithDoc[];
    /** Status line shown until the first token arrives. */
    waiting: HTMLElement;
  };
  let activeStream: ActiveStream | null = null;

  function startFailureFromResponse(resp: {
    ok?: boolean;
    error?: string;
    code?: string;
    message?: string;
    userAction?: string;
    maxLen?: number;
  }): ChatErrorData {
    let msg: string;
    if (
      resp.code === ERROR_CODES.RATE_LIMITED ||
      resp.error === ERROR_CODES.RATE_LIMITED
    ) {
      msg = resp.message ?? "Too many chat requests. Wait a moment and try again.";
    } else if (
      resp.code === ERROR_CODES.QUESTION_TOO_LONG ||
      resp.error === ERROR_CODES.QUESTION_TOO_LONG
    ) {
      msg =
        resp.message ??
        `Your question is too long (maximum ${resp.maxLen ?? CHAT_LIMITS.MAX_QUESTION_CHARS} characters). Trim the text and try again.`;
    } else if (resp.message) {
      msg = resp.message;
    } else {
      msg = String(resp.error ?? "Could not start chat.");
    }
    const hint =
      resp.userAction ??
      (resp.error === ERROR_CODES.QUESTION_TOO_LONG ||
      resp.code === ERROR_CODES.QUESTION_TOO_LONG
        ? undefined
        : "Try again or open Cortex settings.");
    return { message: msg, userAction: hint, recoverable: true };
  }

  function sendChatMessage(payload: unknown): void {
    const ctl = chatController;
    chrome.runtime.sendMessage(payload, (resp?: { ok?: boolean }) => {
      if (!ctl || (payload as { type?: string }).type !== "CORTEX_CHAT_START") return;
      if (chrome.runtime.lastError) {
        ctl.failStart({
          message: chrome.runtime.lastError.message ?? "Extension error.",
          userAction: "Reload the extension from chrome://extensions.",
          recoverable: true,
        });
        return;
      }
      if (resp && resp.ok === false) {
        ctl.failStart(startFailureFromResponse(resp));
      }
    });
  }

  function showStreamError(data: ChatErrorData): void {
    const st = activeStream;
    if (!st) return;
    st.waiting.remove();
    st.renderer.cancel();
    st.contentEl.textContent = "";
    st.contentEl.appendChild(renderErrorBlock(data));
    scrollChatIfFollowing(st.messagesContainer);
    activeStream = null;
  }

  function ensureChatController(): ChatStreamController {
    if (chatController) return chatController;
    chatController = new ChatStreamController({
      send: sendChatMessage,
      shell: overlayShellMode,
      callbacks: {
        onConversation: (id) => {
          currentConversationId = id;
          void refreshChatSidebar();
        },
        onSources: (chunks) => {
          if (!activeStream) return;
          activeStream.citedChunks = chunks as ChunkWithDoc[];
          activeStream.waiting.textContent = chunks.length
            ? "Reading what it found..."
            : "Searching your library...";
        },
        onToken: (text) => {
          if (!activeStream) return;
          activeStream.waiting.remove();
          activeStream.renderer.push(text);
        },
        onDone: () => {
          const st = activeStream;
          if (!st) return;
          st.waiting.remove();
          // Final rich render happens in the same frame as the last flush: no jump.
          st.renderer.finish((full) => renderAnswerWithCitations(full, st.citedChunks));
          renderSources(st.sourcesEl, st.citedChunks);
          announcePolite("Answer ready.");
          scrollChatIfFollowing(st.messagesContainer);
          void refreshChatSidebar();
          activeStream = null;
        },
        onError: (data) => showStreamError(data),
        onAborted: () => {
          const st = activeStream;
          if (!st) return;
          st.waiting.remove();
          st.renderer.finish((full) =>
            full ? renderAnswerWithCitations(full, st.citedChunks) : document.createTextNode("")
          );
          const note = document.createElement("p");
          note.className = "cortex-muted cortex-chat-stopped";
          note.textContent = "Stopped.";
          st.contentEl.appendChild(note);
          announcePolite("Answer stopped.");
          scrollChatIfFollowing(st.messagesContainer);
          activeStream = null;
        },
        onStateChange: (state) => updateSendButton(state),
      },
    });
    return chatController;
  }

  let askSendBtn: HTMLButtonElement | null = null;

  function updateSendButton(state: ChatStreamState): void {
    const btn = askSendBtn;
    if (!btn) return;
    const streaming = state === "streaming";
    btn.textContent = streaming ? "Stop" : "Send";
    btn.setAttribute("aria-label", streaming ? "Stop answering" : "Send question");
    btn.classList.toggle("cortex-ask-send--stop", streaming);
    btn.setAttribute("data-state", state);
  }

  function handleAskSubmit(question: string, messagesContainer: HTMLElement): void {
    const ctl = ensureChatController();
    if (ctl.isStreaming) return;

    const userEl = document.createElement("div");
    userEl.className = "cortex-msg cortex-msg--user";
    userEl.textContent = question;
    messagesContainer.appendChild(userEl);

    const assistantMsgEl = document.createElement("div");
    assistantMsgEl.className = "cortex-msg cortex-msg--assistant";
    const contentEl = document.createElement("div");
    contentEl.className = "cortex-msg-content";
    const sourcesEl = document.createElement("div");
    sourcesEl.className = "cortex-msg-sources";
    assistantMsgEl.appendChild(contentEl);
    assistantMsgEl.appendChild(sourcesEl);
    messagesContainer.appendChild(assistantMsgEl);
    scrollChatToBottom(messagesContainer);

    const cursor = document.createElement("span");
    cursor.className = "cortex-streaming-cursor";
    cursor.textContent = "▎";
    contentEl.appendChild(cursor);

    let stickToBottom = true;
    const renderer = createStreamRenderer(contentEl, cursor, {
      onFlush: () => {
        if (stickToBottom) scrollChatToBottom(messagesContainer);
        stickToBottom = chatNearBottom(messagesContainer);
      },
    });
    // Until the first token arrives the bubble would be empty next to a Stop
    // button, which reads as stuck. Show what Cortex is doing instead.
    const waiting = document.createElement("p");
    waiting.className = "cortex-chat-waiting cortex-muted";
    waiting.setAttribute("role", "status");
    waiting.textContent = "Searching your library...";
    contentEl.insertBefore(waiting, cursor);

    activeStream = {
      messagesContainer,
      contentEl,
      sourcesEl,
      cursor,
      renderer,
      citedChunks: [],
      waiting,
    };
    ctl.submit(question, currentConversationId, { collectionId: activeCollectionId });
  }

  function digestRangeLabel(range: DigestRange): string {
    if (range === "today") return "Today";
    if (range === "yesterday") return "Yesterday";
    return "Last 7 days";
  }

  /**
   * Digest narrative with its sources named and linked: each sentence is
   * followed by numbered chips that open the page it came from (Phase 6).
   */
  function renderDigestNarrative(el: HTMLElement, digest: DigestResult): void {
    el.textContent = "";
    const sources = new Map((digest.sources ?? []).map((s) => [s.n, s]));
    const parts = digest.narrativeParts?.length
      ? digest.narrativeParts
      : [{ text: digest.narrative, sourceIndexes: [] }];
    for (const part of parts) {
      if (!part.text.trim()) continue;
      el.appendChild(document.createTextNode(`${el.childNodes.length ? " " : ""}${part.text} `));
      for (const n of part.sourceIndexes) {
        const src = sources.get(n);
        if (!src) continue;
        const chip = document.createElement("a");
        chip.className = "cortex-citation cortex-digest-cite";
        chip.href = safeHttpUrl(src.url);
        chip.target = "_blank";
        chip.rel = "noopener noreferrer";
        chip.textContent = String(n);
        chip.title = `${src.title} (${src.domain})`;
        el.appendChild(chip);
      }
    }
  }

  /**
   * "What you saw, site by site": one bullet per site, each naming a few of
   * the pages as links. Built from the digest's per-site groups, so the
   * counts match the period, not just the pages the model cited.
   */
  function renderDigestSites(digest: DigestResult): HTMLElement | null {
    const groups = digest.domainGroups ?? [];
    if (!groups.length) return null;
    const sources = new Map((digest.sources ?? []).map((s) => [s.n, s]));
    const byDomain = new Map<string, typeof digest.sources>();
    for (const s of digest.sources ?? []) {
      byDomain.set(s.domain, [...(byDomain.get(s.domain) ?? []), s]);
    }

    const section = document.createElement("section");
    section.className = "cortex-digest-section";
    const heading = document.createElement("h3");
    heading.className = "cortex-digest-section-label";
    heading.textContent = "What you saw, site by site";
    const list = document.createElement("ul");
    list.className = "cortex-digest-sites";

    for (const group of groups.slice(0, 12)) {
      const li = document.createElement("li");
      li.className = "cortex-digest-site";

      const lead = document.createElement("span");
      lead.className = "cortex-digest-site-lead";
      const pages = `${group.count} ${group.count === 1 ? "page" : "pages"}`;
      lead.textContent = `On ${group.domain} you read ${pages}: `;
      li.appendChild(lead);

      const named = (byDomain.get(group.domain) ?? group.sourceIndexes.map((n) => sources.get(n)))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .slice(0, 3);
      named.forEach((src, i) => {
        if (i > 0) li.appendChild(document.createTextNode(", "));
        const a = document.createElement("a");
        a.className = "cortex-digest-site-link";
        a.href = safeHttpUrl(src.url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = src.title;
        a.title = src.title;
        li.appendChild(a);
      });
      const rest = group.count - named.length;
      if (rest > 0) {
        const more = document.createElement("span");
        more.className = "cortex-muted";
        more.textContent = ` and ${rest} more`;
        li.appendChild(more);
      }
      list.appendChild(li);
    }

    section.append(heading, list);
    return section;
  }

  function renderDigestUI(digest: DigestResult): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cortex-digest";

    if (digest.pageCount === 0) {
      const empty = document.createElement("div");
      empty.className = "cortex-digest-empty-card";
      empty.innerHTML = `<p class="cortex-digest-empty-title">Nothing indexed for ${esc(digestRangeLabel(digest.range as DigestRange))}</p><p class="cortex-digest-empty-hint">${esc(digest.narrative)}</p>`;
      wrapper.appendChild(empty);
      return wrapper;
    }

    const meta = document.createElement("div");
    meta.className = "cortex-digest-meta";
    const badgePages = document.createElement("span");
    badgePages.className = "cortex-digest-badge";
    badgePages.textContent = `${digest.pageCount} pages`;
    const badgeSites = document.createElement("span");
    badgeSites.className = "cortex-digest-badge";
    badgeSites.textContent = `${digest.domainsCount} sites`;
    const badgeWhen = document.createElement("span");
    badgeWhen.className = "cortex-digest-badge cortex-digest-badge--muted";
    badgeWhen.textContent = digestRangeLabel(digest.range as DigestRange);
    meta.append(badgePages, badgeSites, badgeWhen);
    wrapper.appendChild(meta);

    const hero = document.createElement("section");
    hero.className = "cortex-digest-hero";
    const heroLabel = document.createElement("p");
    heroLabel.className = "cortex-digest-section-label";
    heroLabel.textContent = "Your reading focus";
    const narrative = document.createElement("p");
    narrative.className = "cortex-digest-narrative";
    renderDigestNarrative(narrative, digest);
    hero.append(heroLabel, narrative);
    wrapper.appendChild(hero);

    const sites = renderDigestSites(digest);
    if (sites) wrapper.appendChild(sites);

    if (digest.topics.length > 0) {
      const topicsSection = document.createElement("section");
      topicsSection.className = "cortex-digest-section";
      const topicsHeading = document.createElement("h3");
      topicsHeading.className = "cortex-digest-section-label";
      topicsHeading.textContent = "Top topics";
      const topicsHint = document.createElement("p");
      topicsHint.className = "cortex-digest-section-hint cortex-muted";
      topicsHint.textContent = "Click a topic to search your library.";
      const topicsGrid = document.createElement("div");
      topicsGrid.className = "cortex-digest-topic-grid";
      topicsGrid.setAttribute("role", "list");

      for (const topic of digest.topics) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cortex-digest-topic-chip";
        chip.setAttribute("role", "listitem");
        chip.title = `Search your library for “${topic.topic}”`;

        const label = document.createElement("span");
        label.className = "cortex-digest-topic-label";
        label.textContent = topic.topic;

        const count = document.createElement("span");
        count.className = "cortex-digest-topic-count";
        count.textContent = `${topic.pageCount} ${topic.pageCount === 1 ? "page" : "pages"}`;

        chip.append(label, count);
        chip.addEventListener("click", () => openSearchWithQuery(topic.topic));
        topicsGrid.appendChild(chip);
      }

      topicsSection.append(topicsHeading, topicsHint, topicsGrid);
      wrapper.appendChild(topicsSection);
    }

    if (digest.insights.length > 0) {
      const insightsSection = document.createElement("section");
      insightsSection.className = "cortex-digest-section";
      const insightsHeading = document.createElement("h3");
      insightsHeading.className = "cortex-digest-section-label";
      insightsHeading.textContent = "Notable findings";

      const insightsList = document.createElement("ul");
      insightsList.className = "cortex-digest-insights";

      for (const insight of digest.insights) {
        const li = document.createElement("li");
        li.className = "cortex-digest-insight-card";

        const text = document.createElement("p");
        text.className = "cortex-digest-insight-text";
        text.textContent = insight.text;

        const link = document.createElement("a");
        link.href = safeHttpUrl(insight.sourceUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "cortex-digest-insight-source";
        link.textContent = `${insight.sourceTitle} · ${pageHostname(insight.sourceUrl)}`;

        li.append(text, link);
        insightsList.appendChild(li);
      }

      insightsSection.append(insightsHeading, insightsList);
      wrapper.appendChild(insightsSection);
    }

    if (digest.sources.length > 0) {
      const details = document.createElement("details");
      details.className = "cortex-digest-sources-details";

      const summary = document.createElement("summary");
      summary.className = "cortex-digest-sources-toggle";
      // The source list is capped, so do not call it "all pages" when the
      // period had more (the header already shows the real page count).
      summary.textContent =
        digest.sources.length < digest.pageCount
          ? `Show sources (${digest.sources.length} of ${digest.pageCount} pages)`
          : `Show all pages (${digest.sources.length})`;

      const list = document.createElement("ul");
      list.className = "cortex-digest-sources";

      for (const s of digest.sources) {
        const li = document.createElement("li");
        li.className = "cortex-digest-source-row";

        const fav = faviconUrlForHost(s.domain);
        if (fav) {
          const img = document.createElement("img");
          img.className = "cortex-digest-source-favicon";
          img.src = fav;
          img.alt = "";
          img.width = 16;
          img.height = 16;
          li.appendChild(img);
        }

        const main = document.createElement("div");
        main.className = "cortex-digest-source-main";
        const a = document.createElement("a");
        a.href = safeHttpUrl(s.url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "cortex-digest-source-title";
        a.textContent = s.title || s.domain;
        const metaLine = document.createElement("span");
        metaLine.className = "cortex-digest-source-meta";
        metaLine.textContent = `${s.domain} · ${new Date(s.visitedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
        main.append(a, metaLine);
        li.appendChild(main);
        list.appendChild(li);
      }

      details.append(summary, list);
      wrapper.appendChild(details);
    }

    return wrapper;
  }

  function updateDigestRangeButtons(active: DigestRange): void {
    activeDigestRange = active;
    for (const btn of digestRangeButtons) {
      const key = btn.getAttribute("data-digest-range") as DigestRange | null;
      btn.classList.toggle("cortex-digest-range-btn--active", key === active);
      btn.setAttribute("aria-pressed", String(key === active));
    }
  }

  function renderLoading(msg: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "cortex-digest-loading cortex-muted";
    el.textContent = msg;
    return el;
  }

  async function loadDigest(
    range: DigestRange,
    content: HTMLElement
  ): Promise<void> {
    updateDigestRangeButtons(range);
    content.innerHTML = "";
    content.appendChild(renderLoading("Generating your digest…"));

    const timeoutMs = 120_000;

    try {
      const digest = await Promise.race([
        new Promise<DigestResult>((resolve, reject) => {
          digestResultSink = (msg) => {
            digestResultSink = null;
            if (msg.ok && msg.result) resolve(msg.result);
            else reject(new Error(msg.error ?? "Digest failed"));
          };
          chrome.runtime.sendMessage(
            { type: "CORTEX_DIGEST_START", range, shell: overlayShellMode },
            (resp) => {
              if (chrome.runtime.lastError) {
                digestResultSink = null;
                reject(new Error(chrome.runtime.lastError.message ?? "Digest failed"));
                return;
              }
              if (resp && (resp as { ok?: boolean }).ok === false) {
                digestResultSink = null;
                const err = (resp as { error?: string }).error ?? "Digest failed";
                reject(new Error(err));
              }
            }
          );
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Digest timed out. Try again.")),
            timeoutMs
          );
        }),
      ]);

      content.innerHTML = "";
      content.appendChild(renderDigestUI(digest));
    } catch (e) {
      digestResultSink = null;
      content.innerHTML = "";
      const err = document.createElement("div");
      err.className = "cortex-muted";
      err.textContent = e instanceof Error ? e.message : String(e);
      content.appendChild(err);
    }
  }

  function renderMode(): void {
    window.clearTimeout(searchTimer);
    selectedHitIndex = -1;
    bodyEl.innerHTML = "";

    if (currentMode === "search") {
      bodyEl.innerHTML = `
        <input type="search" class="cortex-input cortex-search-input" placeholder="Search your memory: topics, sites, phrases" autocomplete="off" aria-label="Search your saved pages" />
        <div class="cortex-hint" aria-label="Shortcuts">
          <span class="cortex-hint-main">Local-only recall</span>
          <span class="cortex-hint-sep" aria-hidden="true">·</span>
          <kbd class="cortex-kbd">⌘/Ctrl</kbd><kbd class="cortex-kbd">Shift</kbd><kbd class="cortex-kbd">K</kbd>
          <span class="cortex-hint-sep" aria-hidden="true">·</span>
          <span class="cortex-hint-nav">↑↓ choose · Enter open · ⌘/Ctrl+Enter background tab</span>
        </div>
        <div class="cortex-results" role="region" aria-label="Search results"></div>`;

      const input = bodyEl.querySelector<HTMLInputElement>(".cortex-search-input")!;
      const results = bodyEl.querySelector<HTMLElement>(".cortex-results")!;
      const searchScope = makeScopeBar(() => {
        const q = input.value.trim();
        if (q) void runSearch(q);
      });
      bodyEl.insertBefore(searchScope.root, results);

      results.innerHTML = `<div class="cortex-results-idle cortex-muted" role="status">Type to search your saved pages. Titles and passages stay local.</div>`;

      results.addEventListener("click", (e) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest(".cortex-hit-details")) e.stopPropagation();
      });

      const runSearch = async (q: string): Promise<void> => {
        selectedHitIndex = -1;
        results.innerHTML = `
          <div class="cortex-loading" aria-busy="true">
            <div class="cortex-skel-row"></div>
            <div class="cortex-skel-row"></div>
            <div class="cortex-skel-row"></div>
          </div>
          <div class="cortex-muted cortex-loading-caption">Searching your memory…</div>`;
        try {
          const res = await new Promise<{
            ok?: boolean;
            error?: string;
            evidence?: string;
            hits?: {
              url: string;
              title: string;
              summary: string;
              visitedAt: number;
              snippet: string;
              score: number;
              grounding?: number;
              matchReason?: string;
              scoreBreakdown: string;
              kind?: ChunkKind;
              locator?: ChunkLocator;
            }[];
          }>((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: "CORTEX_SEARCH",
              query: q,
              ...(activeCollectionId != null ? { collectionId: activeCollectionId } : {}),
            }, (response) => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message));
                return;
              }
              resolve(response ?? {});
            });
          });

          if (res.ok === false) {
            results.innerHTML =
              '<div class="cortex-muted cortex-result-msg">' +
              esc(res.error || "Search failed.") +
              "</div>";
            announcePolite("Search failed.");
            return;
          }

          if (!res.hits?.length) {
            const evidenceNote = res.evidence
              ? `<p class="cortex-evidence-note">${esc(res.evidence)}</p>`
              : "";
            const tips = `
              <div class="cortex-empty-title">No matching memory</div>
              <ul class="cortex-empty-tips">
                <li>Try fewer words or a phrase you remember.</li>
                <li>Include a site or topic.</li>
                <li>Visit more pages. Your index grows as you read.</li>
              </ul>`;
            results.innerHTML = `<div class="cortex-empty cortex-muted">${evidenceNote}${tips}</div>`;
            announcePolite("No matching pages found.");
            return;
          }

          const evidenceBlock = res.evidence
            ? `<div class="cortex-evidence cortex-evidence-compact">${esc(res.evidence)}</div>`
            : "";

          const scores = res.hits.map((h) =>
            typeof h.score === "number" && Number.isFinite(h.score) ? h.score : 0
          );
          const maxScore = scores.reduce((a, b) => Math.max(a, b), 0);

          const rows = res.hits
            .map((h, i) => {
              const when = new Date(h.visitedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              });
              const hostName = pageHostname(h.url);
              const scoreNum = scores[i] ?? 0;
              const ground =
                typeof h.grounding === "number" && Number.isFinite(h.grounding)
                  ? h.grounding
                  : 1;
              const tier = confidenceTier(scoreNum, maxScore, ground);
              const titleAttr = `Blend score ${scoreNum.toFixed(3)} · batch-relative ${tier.relative.toFixed(2)} · term alignment ${(ground * 100).toFixed(0)}%`;

              const fav = faviconUrlForHost(hostName);
              const favHtml = fav
                ? `<img class="cortex-hit-favicon" src="${esc(fav)}" alt="" width="20" height="20" loading="lazy" />`
                : `<span class="cortex-hit-favicon cortex-hit-favicon-placeholder" aria-hidden="true"></span>`;

              const extra = h.matchReason
                ? `<div class="cortex-hit-extra">${esc(h.matchReason)}</div>`
                : "";

              // Per-kind target and detail (release 1.2.0): video moment, PDF page, table rows.
              const kindDetail = citationDetail(h);
              return `
<div class="cortex-hit-card" role="listitem">
  <a class="cortex-hit-link" href="${esc(citationHref(h, h.url) ?? "#")}" target="_blank" rel="noreferrer">
    <span class="cortex-hit-favicon-wrap">${favHtml}</span>
    <span class="cortex-hit-main-col">
      <span class="cortex-hit-title">${esc(h.title)}</span>
      <span class="cortex-hit-host">${esc(hostName)}${kindDetail ? ` <span class="cortex-hit-kind">${esc(kindDetail)}</span>` : ""}</span>
      <span class="cortex-hit-snippet">${esc(h.snippet)}</span>
    </span>
  </a>
  <div class="cortex-hit-footer">
    <time class="cortex-hit-time" datetime="${new Date(h.visitedAt).toISOString()}">${esc(when)}</time>
    <span class="cortex-confidence-badge ${tier.cssClass}" title="${esc(titleAttr)}">${esc(tier.label)}</span>
  </div>
  ${extra}
  <details class="cortex-hit-details">
    <summary class="cortex-hit-details-sum">Why this matched</summary>
    <p class="cortex-hit-details-body">${esc(h.scoreBreakdown)}</p>
  </details>
</div>`;
            })
            .join("");

          results.innerHTML = `${evidenceBlock}<div class="cortex-hit-list" role="list" aria-label="Matching pages">${rows}</div>`;

          announcePolite(
            `${res.hits.length} result${res.hits.length === 1 ? "" : "s"} found`
          );

          selectedHitIndex = res.hits.length > 0 ? 0 : -1;
          applyHitSelection();
          shell.querySelectorAll<HTMLElement>(".cortex-hit-card").forEach((el, i) => {
            el.addEventListener("mouseenter", () => {
              selectedHitIndex = i;
              applyHitSelection();
            });
          });
        } catch (e) {
          const raw =
            e instanceof Error
              ? e.message
              : "Could not reach the extension background.";
          const invalidated = /Extension context invalidated/i.test(raw);
          const msg = invalidated
            ? "Cortex was reloaded while this tab stayed open."
            : raw;
          const hint = invalidated
            ? "Refresh the page (F5 or reload), then open search again."
            : "If this persists, reload the extension from chrome://extensions.";
          results.innerHTML =
            '<div class="cortex-muted">' +
            esc(msg) +
            '<br/><span style="opacity:0.85">' +
            esc(hint) +
            "</span></div>";
          announcePolite("Search error.");
        }
      };

      input.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) {
          results.innerHTML = `<div class="cortex-results-idle cortex-muted" role="status">Type to search your saved pages. Titles and passages stay local.</div>`;
          selectedHitIndex = -1;
          return;
        }
        searchTimer = window.setTimeout(() => void runSearch(q), 180);
      });
      return;
    }

    if (currentMode === "ask") {
      const wrap = document.createElement("div");
      wrap.className = "cortex-ask-layout";

      const sidebar = document.createElement("aside");
      sidebar.className = "cortex-chat-sidebar";
      sidebar.setAttribute("aria-label", "Chat history");

      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.className = "cortex-chat-new";
      newBtn.textContent = "+ New chat";

      const filterWrap = document.createElement("div");
      filterWrap.className = "cortex-chat-filter-wrap";
      const filterInput = document.createElement("input");
      filterInput.type = "search";
      filterInput.className = "cortex-chat-filter";
      filterInput.placeholder = "Filter chats";
      filterInput.setAttribute("aria-label", "Filter chats by title");
      filterInput.autocomplete = "off";
      filterInput.value = sidebarFilter;
      filterInput.addEventListener("input", () => {
        sidebarFilter = filterInput.value;
        renderChatSidebarList();
      });
      filterWrap.appendChild(filterInput);
      askSidebarFilterEl = filterInput;

      const sidebarList = document.createElement("div");
      sidebarList.className = "cortex-chat-sidebar-list";
      sidebarList.setAttribute("role", "group");
      sidebarList.setAttribute("aria-label", "Past chats");
      sidebarList.addEventListener("keydown", onSidebarKey);
      askSidebarListEl = sidebarList;

      const messagesContainer = document.createElement("div");
      messagesContainer.className = "cortex-chat-messages";
      messagesContainer.setAttribute("role", "log");
      messagesContainer.setAttribute("aria-relevant", "additions");
      askMessagesEl = messagesContainer;

      newBtn.addEventListener("click", () => {
        currentConversationId = null;
        renderChatThread(messagesContainer, []);
        void refreshChatSidebar();
        askDrawerToggle?.close();
        if (askTextareaEl) focusAskInput(askTextareaEl);
      });
      sidebar.appendChild(newBtn);
      sidebar.appendChild(filterWrap);
      sidebar.appendChild(sidebarList);

      const main = document.createElement("div");
      main.className = "cortex-chat-main";

      const drawerToggle = createChatDrawerToggle(sidebar, { label: "Chats" });
      askDrawerToggle = drawerToggle;
      // Toggle bar is the first row of the layout so the drawer opens below it
      // (medium) or the list expands under it (narrow). Hidden in wide.
      wrap.appendChild(drawerToggle.button);
      // Click or tap on the thread while the drawer is open closes it.
      main.addEventListener("mousedown", () => {
        if (drawerToggle.isOpen()) drawerToggle.close();
      });

      const composer = document.createElement("div");
      composer.className = "cortex-ask-composer";

      const inputInner = document.createElement("div");
      inputInner.className = "cortex-ask-input-inner";
      const ta = document.createElement("textarea");
      ta.className = "cortex-ask-input";
      ta.placeholder = "Ask anything about what you've read…";
      ta.rows = 2;
      ta.maxLength = CHAT_LIMITS.MAX_QUESTION_CHARS;
      ta.setAttribute("aria-label", "Your question");
      askTextareaEl = ta;
      inputInner.addEventListener("mousedown", (e) => {
        if (e.target === ta) return;
        e.preventDefault();
        focusAskInput(ta);
      });
      inputInner.appendChild(ta);

      const sendRow = document.createElement("div");
      sendRow.className = "cortex-ask-send-row";
      const hint = document.createElement("span");
      hint.className = "cortex-ask-send-hint cortex-muted";
      hint.textContent = "Enter to send · Shift+Enter new line";
      const sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "cortex-ask-send";
      sendBtn.textContent = "Send";
      sendBtn.setAttribute("aria-label", "Send question");
      askSendBtn = sendBtn;
      updateSendButton(chatController?.state ?? "idle");
      sendRow.appendChild(hint);
      sendRow.appendChild(sendBtn);

      composer.appendChild(inputInner);
      composer.appendChild(sendRow);
      main.appendChild(makeScopeBar().root);
      main.appendChild(messagesContainer);
      main.appendChild(composer);
      wrap.appendChild(sidebar);
      wrap.appendChild(main);

      const submitAsk = (): void => {
        if (chatController?.isStreaming) return;
        const question = ta.value.trim();
        if (!question) return;
        messagesContainer.querySelector(".cortex-chat-empty")?.remove();
        ta.value = "";
        handleAskSubmit(question, messagesContainer);
      };

      sendBtn.addEventListener("click", () => {
        if (chatController?.isStreaming) {
          chatController.abort();
          return;
        }
        submitAsk();
      });

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitAsk();
        }
      });

      bodyEl.appendChild(wrap);
      renderChatThread(messagesContainer, []);
      void refreshChatSidebar();
      if (currentConversationId != null) {
        void loadChatConversation(currentConversationId, messagesContainer);
      }
      requestAnimationFrame(() => focusAskInput(ta));
      return;
    }

    if (currentMode === "people") {
      const host = document.createElement("div");
      host.className = "cortex-people-host";
      bodyEl.appendChild(host);
      void renderPeopleView(host, {
        list: async (q) => {
          const res = (await sendRuntimeMessage({ type: "CORTEX_PEOPLE_LIST", q })) as
            | { ok?: boolean; people?: PersonRow[] }
            | undefined;
          return res?.ok ? res.people ?? [] : [];
        },
        remove: async (id) => {
          const res = (await sendRuntimeMessage({ type: "CORTEX_PEOPLE_DELETE", id })) as
            | { ok?: boolean }
            | undefined;
          return res?.ok === true;
        },
        announce: announcePolite,
      }).then(() => {
        host.querySelector<HTMLInputElement>(".cortex-people-filter")?.focus({ preventScroll: true });
      });
      return;
    }

    if (currentMode === "digest") {
      const rangeBar = document.createElement("div");
      rangeBar.className = "cortex-digest-range";
      // Toggle buttons (aria-pressed), not tabs: there is one shared content area.
      rangeBar.setAttribute("role", "group");
      rangeBar.setAttribute("aria-label", "Digest time range");
      const ranges: Array<[DigestRange, string]> = [
        ["today", "Today"],
        ["yesterday", "Yesterday"],
        ["last_7_days", "Last 7 days"],
      ];

      const content = document.createElement("div");
      content.className = "cortex-digest-content";

      digestRangeButtons = [];
      for (const [key, label] of ranges) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cortex-digest-range-btn";
        btn.textContent = label;
        btn.setAttribute("data-digest-range", key);
        btn.addEventListener("click", () => void loadDigest(key, content));
        rangeBar.appendChild(btn);
        digestRangeButtons.push(btn);
      }

      bodyEl.appendChild(rangeBar);
      bodyEl.appendChild(content);
      updateDigestRangeButtons(activeDigestRange);
      void loadDigest(activeDigestRange, content);
    }
  }

  function closeOverlay(): void {
    flushPendingDeletes();
    hideUndoToast();
    stopTheme();
    if (chatController?.isStreaming) chatController.abort();
    chatController?.dispose();
    chatController = null;
    activeStream = null;
    askSendBtn = null;
    digestResultSink = null;
    stopLayoutObserver();
    cancelInitialFocus?.();
    cancelInitialFocus = null;
    document.removeEventListener("keydown", onOverlayNavKey, true);
    document.removeEventListener("keydown", onKeyCaptureRedirect, true);
    removeKeyShield();
    panel.classList.remove("is-visible");
    host.remove();
    overlayHost = null;
    overlayShadowRoot = null;
    // Restores focus to the element that had it before the overlay opened.
    focusTrap.deactivate();
  }

  rebuildTabs();
  renderMode();

  cancelInitialFocus = focusOnceAfterTransition(panel, focusPrimaryField);

  requestAnimationFrame(() => {
    panel.classList.add("is-visible");
  });
}
