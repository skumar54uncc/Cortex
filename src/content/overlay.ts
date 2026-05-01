/** XSS / sinks: see docs/INNERHTML_AUDIT.md — escape user- or page-derived text via esc() before HTML interpolation. */
import shadowCss from "./overlay.shadow.css";
import { getBrandFontFaceCss } from "../styles/brand-fonts";

import { confidenceTier } from "./confidence";
import {
  isExtensionRuntimeAlive,
  sendRuntimeMessage,
} from "../shared/extension-runtime";
import type { ChatStreamEvent } from "../lib/chat/chat-engine";
import type { DigestResult } from "../lib/chat/digest-types";
import type { ChunkWithDoc } from "../lib/search-engine";
import { CHAT_LIMITS } from "../lib/limits";
import { safeHttpHttpsHref } from "../lib/url-security";
import { ERROR_CODES } from "../lib/errors";

let overlayHost: HTMLDivElement | null = null;

/** Prevent duplicate chrome.runtime / window listeners if mountOverlay ever runs twice */
let overlayListenersInstalled = false;

let chatEventSink: ((ev: ChatStreamEvent) => void) | null = null;
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

export function mountOverlay(): void {
  if (overlayListenersInstalled) return;
  overlayListenersInstalled = true;

  window.addEventListener("cortex-open-search", () => openSearchOverlay());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CORTEX_OPEN_SEARCH") {
      openSearchOverlay();
      return undefined;
    }
    if (msg?.type === "CORTEX_CHAT_PUSH") {
      chatEventSink?.(msg.event as ChatStreamEvent);
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

type OverlayMode = "search" | "ask" | "digest";

/** Opens the panel if closed. Idempotent — avoids double Ctrl+Shift+K (command + key handler). */
function openSearchOverlay(): void {
  if (!isExtensionRuntimeAlive()) return;

  const existingRoot = document.getElementById("cortex-overlay-root");
  if (existingRoot?.isConnected) return;

  existingRoot?.remove();
  overlayHost = null;

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement("div");
  host.id = "cortex-overlay-root";

  const shadow = host.attachShadow({ mode: "open" });

  const iconUrl = chrome.runtime.getURL("icons/icon-48.png");

  const style = document.createElement("style");
  style.textContent = `${getBrandFontFaceCss()}\n${shadowCss}`;
  shadow.appendChild(style);

  const shell = document.createElement("div");
  shell.className = "cortex-shell";
  shell.innerHTML = `
    <div class="cortex-backdrop" data-act="close"></div>
    <div class="cortex-panel" role="dialog" aria-modal="true" aria-labelledby="cortex-overlay-title" aria-describedby="cortex-overlay-tagline">
      <div id="cortex-announcer" class="cortex-sr-only" aria-live="polite" aria-atomic="true"></div>
      <div class="cortex-head">
        <div class="cx-brand">
          <a class="cx-brand-link" href="#" role="link" title="Open Cortex settings" data-cortex-open-options>
            <img class="cx-brand-mark" src="${iconUrl}" alt="" width="26" height="26" />
          </a>
          <div class="cx-brand-text">
            <span id="cortex-overlay-title" class="cx-brand-wordmark">Cortex</span>
            <span id="cortex-overlay-tagline" class="cx-brand-tagline">Private memory from pages you read</span>
          </div>
        </div>
        <button type="button" class="cortex-x" data-act="close" aria-label="Close">×</button>
      </div>
      <div class="cortex-tabs" role="tablist"></div>
      <div class="cortex-body"></div>
    </div>
  `;
  shadow.appendChild(shell);

  try {
    document.documentElement.appendChild(host);
    overlayHost = host;
  } catch {
    overlayHost = null;
    return;
  }

  const panel = shell.querySelector<HTMLElement>(".cortex-panel")!;
  const tabBar = shell.querySelector<HTMLElement>(".cortex-tabs")!;
  const bodyEl = shell.querySelector<HTMLElement>(".cortex-body")!;

  const announcePolite = (text: string): void => {
    const el = shell.querySelector<HTMLElement>("#cortex-announcer");
    if (!el) return;
    el.textContent = "";
    window.requestAnimationFrame(() => {
      el.textContent = text;
    });
  };

  let currentMode: OverlayMode = "search";
  let currentConversationId: number | null = null;

  let selectedHitIndex = -1;
  let searchTimer: number | undefined;

  const applyHitSelection = (): void => {
    shell.querySelectorAll<HTMLElement>(".cortex-hit-card").forEach((el, i) => {
      const on = i === selectedHitIndex;
      el.classList.toggle("cortex-hit-card-selected", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      if (on) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  const getSearchInput = (): HTMLInputElement | null =>
    shell.querySelector<HTMLInputElement>(".cortex-search-input");

  const focusPrimaryField = (): void => {
    if (currentMode === "search") {
      getSearchInput()?.focus({ preventScroll: true });
    } else if (currentMode === "ask") {
      shell.querySelector<HTMLTextAreaElement>(".cortex-ask-input")?.focus({
        preventScroll: true,
      });
    }
  };

  const focusIsInsideOverlay = (): boolean => {
    const sr = host.shadowRoot;
    if (!sr) return false;
    const ae = document.activeElement as Node | null;
    if (ae && sr.contains(ae)) return true;
    if (ae === host && sr.activeElement) return true;
    return false;
  };

  const scheduleFocusRetries = (): void => {
    focusPrimaryField();
    requestAnimationFrame(() => {
      focusPrimaryField();
      window.setTimeout(focusPrimaryField, 0);
      window.setTimeout(focusPrimaryField, 16);
      window.setTimeout(focusPrimaryField, 50);
      window.setTimeout(focusPrimaryField, 120);
    });
  };

  const onOverlayNavKey = (ev: KeyboardEvent): void => {
    if (!overlayHost || currentMode !== "search") return;
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
      hits[selectedHitIndex]?.focus({ preventScroll: true });
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
      hits[selectedHitIndex]?.focus({ preventScroll: true });
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

  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeOverlay();
    }
  };

  const onFocusInCapturePage = (ev: FocusEvent): void => {
    const t = ev.target as Node | null;
    if (!t || !document.documentElement.contains(t)) return;
    const sr = host.shadowRoot;
    if (!sr || sr.contains(t)) return;

    queueMicrotask(() => {
      if (!overlayHost) return;
      if (focusIsInsideOverlay()) return;
      focusPrimaryField();
    });
  };

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

  document.addEventListener("keydown", onDocKey, true);
  document.addEventListener("keydown", onOverlayNavKey, true);
  document.addEventListener("keydown", onKeyCaptureRedirect, true);
  document.addEventListener("focusin", onFocusInCapturePage, true);

  function rebuildTabs(): void {
    tabBar.innerHTML = "";
    const tabs: Array<{ id: OverlayMode; label: string }> = [
      { id: "search", label: "Search" },
      { id: "ask", label: "Ask" },
      { id: "digest", label: "Digest" },
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

  function switchMode(mode: OverlayMode): void {
    currentMode = mode;
    rebuildTabs();
    renderMode();
    scheduleFocusRetries();
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

  function renderAnswerWithCitations(
    text: string,
    chunks: ChunkWithDoc[]
  ): HTMLElement {
    const root = document.createElement("div");
    root.className = "cortex-msg-rich";

    const citationBlockRe = /(\[\d+(?:,\s*\d+)*\])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = citationBlockRe.exec(text)) !== null) {
      if (m.index > last) {
        appendTextWithUrls(root, text.slice(last, m.index), "cortex-inline-link");
      }
      const nums = [...m[1]!.matchAll(/\d+/g)].map((x) => parseInt(x[0]!, 10));
      root.appendChild(document.createTextNode("["));
      let firstNum = true;
      for (const n of nums) {
        if (!firstNum) root.appendChild(document.createTextNode(", "));
        firstNum = false;
        const chunk = chunks[n - 1];
        if (chunk) {
          const link = document.createElement("a");
          link.className = "cortex-citation";
          link.href = safeHttpUrl(chunk.document.url);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = String(n);
          link.title = chunk.document.title;
          root.appendChild(link);
        } else {
          root.appendChild(document.createTextNode(String(n)));
        }
      }
      root.appendChild(document.createTextNode("]"));
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      appendTextWithUrls(root, text.slice(last), "cortex-inline-link");
    }
    return root;
  }

  function renderSources(container: Element, chunks: ChunkWithDoc[]): void {
    container.innerHTML = "";
    const heading = document.createElement("div");
    heading.className = "cortex-sources-heading";
    heading.textContent = `Sources (${chunks.length})`;
    container.appendChild(heading);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const item = document.createElement("a");
      item.className = "cortex-source-item";
      item.href = safeHttpUrl(chunk.document.url);
      item.target = "_blank";
      item.rel = "noopener noreferrer";

      const num = document.createElement("span");
      num.className = "cortex-source-num";
      num.textContent = `[${i + 1}]`;

      const titleEl = document.createElement("span");
      titleEl.className = "cortex-source-title";
      titleEl.textContent = chunk.document.title;

      const domain = document.createElement("span");
      domain.className = "cortex-source-domain";
      domain.textContent = chunk.document.domain;

      item.appendChild(num);
      item.appendChild(titleEl);
      item.appendChild(domain);
      container.appendChild(item);
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

  async function handleAskSubmit(question: string, messagesContainer: HTMLElement): Promise<void> {
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

    let fullText = "";
    let citedChunks: ChunkWithDoc[] = [];

    await new Promise<void>((resolve) => {
      let settled = false;
      let timeoutId = window.setTimeout(() => {
        if (!settled && chatEventSink) {
          cursor.remove();
          contentEl.textContent = "";
          contentEl.appendChild(
            renderErrorBlock({
              message: "No response from Cortex.",
              userAction: "Try again or reload the extension.",
              recoverable: true,
            })
          );
          scrollChatIfFollowing(messagesContainer);
          finish();
        }
      }, 120_000);

      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        chatEventSink = null;
        resolve();
      };

      chatEventSink = (ev: ChatStreamEvent): void => {
        if (ev.type === "conversation") {
          currentConversationId = ev.data.id as number;
          return;
        }
        if (ev.type === "sources") {
          citedChunks = ev.data.chunks as ChunkWithDoc[];
          renderSources(sourcesEl, citedChunks);
          scrollChatIfFollowing(messagesContainer);
          return;
        }
        if (ev.type === "token") {
          const stick = chatNearBottom(messagesContainer);
          fullText += ev.data as string;
          contentEl.textContent = fullText;
          contentEl.appendChild(cursor);
          if (stick) scrollChatToBottom(messagesContainer);
          return;
        }
        if (ev.type === "done") {
          cursor.remove();
          contentEl.textContent = "";
          contentEl.appendChild(renderAnswerWithCitations(fullText, citedChunks));
          announcePolite("Answer ready.");
          scrollChatIfFollowing(messagesContainer);
          finish();
          return;
        }
        if (ev.type === "error") {
          cursor.remove();
          contentEl.textContent = "";
          contentEl.appendChild(renderErrorBlock(ev.data));
          scrollChatIfFollowing(messagesContainer);
          finish();
          return;
        }
      };

      chrome.runtime.sendMessage(
        {
          type: "CORTEX_CHAT_START",
          question,
          conversationId: currentConversationId,
        },
        (
          resp:
            | {
                ok?: boolean;
                error?: string;
                code?: string;
                message?: string;
                userAction?: string;
                maxLen?: number;
              }
            | undefined
        ) => {
          if (chrome.runtime.lastError) {
            cursor.remove();
            contentEl.textContent = "";
            contentEl.appendChild(
              renderErrorBlock({
                message: chrome.runtime.lastError.message ?? "Extension error.",
                userAction: "Reload the extension from chrome://extensions.",
                recoverable: true,
              })
            );
            scrollChatIfFollowing(messagesContainer);
            finish();
            return;
          }
          if (resp && resp.ok === false) {
            cursor.remove();
            contentEl.textContent = "";
            let msg: string;
            if (
              resp.code === ERROR_CODES.RATE_LIMITED ||
              resp.error === ERROR_CODES.RATE_LIMITED
            ) {
              msg =
                resp.message ??
                "Too many chat requests. Wait a moment and try again.";
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
            contentEl.appendChild(
              renderErrorBlock({
                message: msg,
                userAction: hint,
                recoverable: true,
              })
            );
            scrollChatIfFollowing(messagesContainer);
            finish();
          }
        }
      );
    });
  }

  function renderDigestUI(digest: DigestResult): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cortex-digest";

    if (digest.pageCount === 0) {
      const empty = document.createElement("div");
      empty.className = "cortex-digest-empty";
      empty.textContent = digest.narrative;
      wrapper.appendChild(empty);
      return wrapper;
    }

    const stats = document.createElement("div");
    stats.className = "cortex-digest-stats";
    stats.textContent = `${digest.pageCount} pages across ${digest.domainsCount} sites`;
    wrapper.appendChild(stats);

    const narrative = document.createElement("p");
    narrative.className = "cortex-digest-narrative";
    narrative.textContent = digest.narrative;
    wrapper.appendChild(narrative);

    if (digest.topics.length > 0) {
      const topicsHeading = document.createElement("h3");
      topicsHeading.textContent = "Top topics";
      wrapper.appendChild(topicsHeading);

      const topicsList = document.createElement("ul");
      topicsList.className = "cortex-digest-topics";
      for (const topic of digest.topics) {
        const li = document.createElement("li");
        li.textContent = `${topic.topic} (${topic.pageCount} ${topic.pageCount === 1 ? "page" : "pages"})`;
        topicsList.appendChild(li);
      }
      wrapper.appendChild(topicsList);
    }

    if (digest.insights.length > 0) {
      const insightsHeading = document.createElement("h3");
      insightsHeading.textContent = "Notable findings";
      wrapper.appendChild(insightsHeading);

      const insightsList = document.createElement("ul");
      insightsList.className = "cortex-digest-insights";
      for (const insight of digest.insights) {
        const li = document.createElement("li");
        li.append(document.createTextNode(`${insight.text} `));
        const link = document.createElement("a");
        link.href = safeHttpUrl(insight.sourceUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "cortex-citation";
        link.textContent = "↗";
        link.title = insight.sourceTitle;
        li.appendChild(link);
        insightsList.appendChild(li);
      }
      wrapper.appendChild(insightsList);
    }

    if (digest.sources.length > 0) {
      const srcH = document.createElement("h3");
      srcH.textContent = "Sources";
      wrapper.appendChild(srcH);
      const ul = document.createElement("ul");
      ul.className = "cortex-digest-sources";
      for (const s of digest.sources) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = safeHttpUrl(s.url);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = s.title || s.domain;
        li.appendChild(a);
        const meta = document.createElement("span");
        meta.className = "cortex-digest-source-meta";
        meta.textContent = ` · ${s.domain}`;
        li.appendChild(meta);
        ul.appendChild(li);
      }
      wrapper.appendChild(ul);
    }

    return wrapper;
  }

  function renderLoading(msg: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "cortex-digest-loading cortex-muted";
    el.textContent = msg;
    return el;
  }

  async function loadDigest(
    range: "today" | "yesterday" | "last_7_days",
    content: HTMLElement
  ): Promise<void> {
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
          chrome.runtime.sendMessage({ type: "CORTEX_DIGEST_START", range }, () => {
            void chrome.runtime.lastError;
          });
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Digest timed out — try again.")),
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
        <input type="search" class="cortex-input cortex-search-input" placeholder="Search your memory — topics, sites, phrases…" autocomplete="off" aria-label="Search your saved pages" />
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

      results.innerHTML = `<div class="cortex-results-idle cortex-muted" role="status">Type to search your saved pages — titles and passages stay local.</div>`;

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
              matchReason?: string;
              scoreBreakdown: string;
            }[];
          }>((resolve, reject) => {
            chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: q }, (response) => {
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
                <li>Visit more pages—your index grows as you read.</li>
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
              const tier = confidenceTier(scoreNum, maxScore);
              const titleAttr = `Blend score ${scoreNum.toFixed(3)} · batch-relative ${tier.relative.toFixed(2)}`;

              const fav = faviconUrlForHost(hostName);
              const favHtml = fav
                ? `<img class="cortex-hit-favicon" src="${esc(fav)}" alt="" width="20" height="20" loading="lazy" />`
                : `<span class="cortex-hit-favicon cortex-hit-favicon-placeholder" aria-hidden="true"></span>`;

              const extra = h.matchReason
                ? `<div class="cortex-hit-extra">${esc(h.matchReason)}</div>`
                : "";

              return `
<div class="cortex-hit-card" role="option" tabindex="-1" aria-selected="false">
  <a class="cortex-hit-link" href="${safeHttpUrl(h.url)}" target="_blank" rel="noreferrer">
    <span class="cortex-hit-favicon-wrap">${favHtml}</span>
    <span class="cortex-hit-main-col">
      <span class="cortex-hit-title">${esc(h.title)}</span>
      <span class="cortex-hit-host">${esc(hostName)}</span>
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

          results.innerHTML = `${evidenceBlock}<div class="cortex-hit-list" role="listbox" aria-label="Matching pages">${rows}</div>`;

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
          results.innerHTML = `<div class="cortex-results-idle cortex-muted" role="status">Type to search your saved pages — titles and passages stay local.</div>`;
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

      const toolbar = document.createElement("div");
      toolbar.className = "cortex-ask-toolbar";
      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.className = "cortex-ask-new";
      newBtn.textContent = "New chat";
      const messagesContainer = document.createElement("div");
      messagesContainer.className = "cortex-chat-messages";
      messagesContainer.setAttribute("role", "log");
      messagesContainer.setAttribute("aria-relevant", "additions");
      newBtn.addEventListener("click", () => {
        currentConversationId = null;
        messagesContainer.innerHTML = "";
      });
      toolbar.appendChild(newBtn);
      wrap.appendChild(toolbar);

      wrap.appendChild(messagesContainer);

      const composer = document.createElement("div");
      composer.className = "cortex-ask-composer";

      const inputInner = document.createElement("div");
      inputInner.className = "cortex-ask-input-inner";
      const ta = document.createElement("textarea");
      ta.className = "cortex-ask-input cortex-input";
      ta.placeholder = "Ask anything about what you've read…";
      ta.rows = 3;
      ta.maxLength = CHAT_LIMITS.MAX_QUESTION_CHARS;
      ta.setAttribute("aria-label", "Your question");
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
      sendRow.appendChild(hint);
      sendRow.appendChild(sendBtn);

      composer.appendChild(inputInner);
      composer.appendChild(sendRow);
      wrap.appendChild(composer);

      const submitAsk = (): void => {
        const question = ta.value.trim();
        if (!question) return;
        ta.value = "";
        void handleAskSubmit(question, messagesContainer);
      };

      sendBtn.addEventListener("click", () => submitAsk());

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitAsk();
        }
      });

      bodyEl.appendChild(wrap);
      return;
    }

    if (currentMode === "digest") {
      const rangeBar = document.createElement("div");
      rangeBar.className = "cortex-digest-range";
      const ranges = [
        ["today", "Today"],
        ["yesterday", "Yesterday"],
        ["last_7_days", "Last 7 days"],
      ] as const;

      const content = document.createElement("div");
      content.className = "cortex-digest-content";

      for (const [key, label] of ranges) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cortex-digest-range-btn";
        btn.textContent = label;
        btn.addEventListener("click", () => void loadDigest(key, content));
        rangeBar.appendChild(btn);
      }

      bodyEl.appendChild(rangeBar);
      bodyEl.appendChild(content);
      void loadDigest("yesterday", content);
    }
  }

  function closeOverlay(): void {
    chatEventSink = null;
    digestResultSink = null;
    document.removeEventListener("keydown", onDocKey, true);
    document.removeEventListener("keydown", onOverlayNavKey, true);
    document.removeEventListener("keydown", onKeyCaptureRedirect, true);
    document.removeEventListener("focusin", onFocusInCapturePage, true);
    panel.classList.remove("is-visible");
    host.remove();
    overlayHost = null;
    try {
      previousFocus?.focus({ preventScroll: true });
    } catch {
      /* stale */
    }
  }

  rebuildTabs();
  renderMode();

  scheduleFocusRetries();

  requestAnimationFrame(() => {
    panel.classList.add("is-visible");
  });
}
