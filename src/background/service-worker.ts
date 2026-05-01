/// <reference types="chrome"/>
import {
  db,
  upsertDocument,
  replaceChunksForDocument,
  setChunkEmbedding,
  markChunkEmbedFailed,
  appendVisit,
  getRecentVisits,
  hostnameFromUrl,
  documentCount,
  chunkCount,
  clearAllIndexedData,
} from "../db/schema";
import { chunkArticle } from "../lib/chunking";
import {
  isBlockedDomain,
  looksSensitiveHostname,
} from "../lib/privacy";
import { shouldAlwaysSkipUrl } from "../lib/sensitive-domains";
import {
  getChatSettings,
  getUserSettings,
} from "../shared/extension-settings";
import {
  CORTEX_EXTENSION_BUS_CHANNEL,
  type CortexBusInbound,
  type CortexBusOutbound,
} from "../lib/extension-bus";
import type { SearchHitDTO } from "../lib/search-engine";
import { CORTEX_EMBED_MODEL_ID } from "../shared/embed-model";
import { agentDebugLog } from "../lib/agent-debug-log";
import { devLog } from "../lib/extension-logger";
import { extractPageTextFromHtml } from "../content/extract";
import { redactPII } from "../lib/pii-filter";
import { summarizeBestEffort } from "../lib/summarize";
import {
  dedupeHistoryItems,
  fetchHtmlForHistory,
  historySearch,
  HISTORY_IMPORT_IDLE,
  HISTORY_IMPORT_FETCH_CONCURRENCY,
  readHistoryImportProgress,
  writeHistoryImportProgress,
} from "../lib/history-import";
import { CHAT_LIMITS } from "../lib/limits";
import { safeHttpHttpsHref } from "../lib/url-security";
import { RateLimiter } from "../lib/rate-limiter";
import {
  ERROR_CODES,
  payloadFromCode,
  CortexError,
} from "../lib/errors";
import {
  FIRST_INSTALL_BACKFILL_DONE_KEY,
  ONBOARDING_DONE_KEY,
} from "../shared/onboarding-constants";
import { ensureIndexingHeadroom } from "../lib/storage-eviction";

const MIN_INDEX_CHARS_DEFAULT = 80;

const SW_RATE_LIMITER = new RateLimiter(60_000);

function rateLimitHit(
  bucketKey: string,
  maxPerMinute: number,
  sendResponse: (r: unknown) => void
): boolean {
  if (SW_RATE_LIMITER.check(bucketKey, maxPerMinute)) return true;
  sendResponse({
    ok: false,
    error: ERROR_CODES.RATE_LIMITED,
    ...payloadFromCode(ERROR_CODES.RATE_LIMITED),
  });
  return false;
}

export interface IndexPayload {
  url: string;
  title: string;
  text: string;
  summary: string;
  visitedAt: number;
}

function minCharsForUrl(url: string): number {
  try {
    const h = new URL(url).hostname;
    if (h.includes("linkedin.com")) return 32;
    if (h.includes("twitter.com") || h === "x.com") return 40;
  } catch {
    /* ignore */
  }
  return MIN_INDEX_CHARS_DEFAULT;
}

let offscreenCreating: Promise<void> | null = null;

const cortexBus = new BroadcastChannel(CORTEX_EXTENSION_BUS_CHANNEL);

cortexBus.onmessage = (ev: MessageEvent<CortexBusOutbound>) => {
  const d = ev.data;
  if (!d?.kind) return;
  if (d.kind === "chat-event") {
    chrome.tabs.sendMessage(d.tabId, {
      type: "CORTEX_CHAT_PUSH",
      event: d.event,
    }).catch(() => {
      /* tab may not have content script */
    });
    return;
  }
  if (d.kind === "digest-done") {
    chrome.tabs.sendMessage(d.tabId, {
      type: "CORTEX_DIGEST_PUSH",
      ok: true,
      result: d.result,
    }).catch(() => {
      /* ignore */
    });
    return;
  }
  if (d.kind === "digest-error") {
    chrome.tabs.sendMessage(d.tabId, {
      type: "CORTEX_DIGEST_PUSH",
      ok: false,
      error: d.message,
    }).catch(() => {
      /* ignore */
    });
  }
};

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    try {
      const has = await chrome.offscreen.hasDocument?.();
      if (has) {
        // #region agent log
        agentDebugLog({
          hypothesisId: "H1",
          location: "service-worker.ts:ensureOffscreen",
          message: "offscreen_already_present",
          data: {},
        });
        // #endregion
        return;
      }

      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL("offscreen.html"),
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          "Compute local MiniLM embeddings (Transformers.js) for Cortex.",
      });
      // #region agent log
      agentDebugLog({
        hypothesisId: "H1",
        location: "service-worker.ts:ensureOffscreen",
        message: "offscreen_created_ok",
        data: {},
      });
      // #endregion
    } catch (e: unknown) {
      // #region agent log
      agentDebugLog({
        hypothesisId: "H1",
        location: "service-worker.ts:ensureOffscreen",
        message: "offscreen_create_failed",
        data: {
          err: e instanceof Error ? e.message : String(e),
        },
      });
      // #endregion
      throw e;
    }
  })();

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

function embedViaOffscreen(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "CORTEX_EMBED_TEXT", text },
      (res: { ok?: boolean; vec?: number[]; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          // #region agent log
          agentDebugLog({
            hypothesisId: "H4",
            location: "service-worker.ts:embedViaOffscreen",
            message: "embed_last_error",
            data: { msg: chrome.runtime.lastError.message },
          });
          // #endregion
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (res?.ok && Array.isArray(res.vec)) {
          resolve(res.vec);
          return;
        }
        // #region agent log
        agentDebugLog({
          hypothesisId: "H4",
          location: "service-worker.ts:embedViaOffscreen",
          message: "embed_bad_response",
          data: { error: res?.error ?? null },
        });
        // #endregion
        reject(new Error(res?.error ?? "embedding failed"));
      }
    );
  });
}

let embedChain = Promise.resolve();

function queueEmbeddingsForChunkIds(
  pairs: { chunkId: number; text: string }[]
): void {
  for (const { chunkId, text } of pairs) {
    embedChain = embedChain
      .then(async () => {
        await ensureOffscreen();
        const vec = await embedViaOffscreen(text.slice(0, 8000));
        await setChunkEmbedding(chunkId, vec, {
          modelId: CORTEX_EMBED_MODEL_ID,
        });
      })
      .catch(async (e) => {
        devLog.warn("[Cortex] chunk embed skipped:", e);
        try {
          await markChunkEmbedFailed(chunkId);
        } catch {
          /* ignore */
        }
      });
  }
}

/** Persist document + chunks + embedding queue + visit log (shared by live indexing and history import). */
async function commitIndexPayload(p: IndexPayload): Promise<{
  id: number;
  chunks: number;
}> {
  const headroom = await ensureIndexingHeadroom();
  if (!headroom.ok) {
    throw new CortexError(ERROR_CODES.STORAGE_FULL);
  }

  const domain = hostnameFromUrl(p.url);
  const docId = await upsertDocument({
    url: p.url,
    domain,
    title: p.title,
    summary: p.summary,
    lastVisitedAt: p.visitedAt,
  });

  const parts = chunkArticle(p.text).map((c) => ({
    ord: c.ord,
    text: c.text,
  }));
  const chunkIds = await replaceChunksForDocument(docId, parts);

  const embedPairs = chunkIds.map((id, i) => ({
    chunkId: id,
    text: parts[i]?.text ?? "",
  }));
  queueEmbeddingsForChunkIds(embedPairs);

  await appendVisit({
    url: p.url,
    title: p.title,
    hostname: domain,
    visitedAt: p.visitedAt,
    textLength: p.text.length,
  });

  return { id: docId, chunks: chunkIds.length };
}

let historyImportAbortRequested = false;

const HISTORY_IMPORT_SENDER = {} as chrome.runtime.MessageSender;

async function runHistoryImportJob(
  daysBack: number,
  maxAttempts: number
): Promise<void> {
  const startedAt = Date.now();
  historyImportAbortRequested = false;

  await writeHistoryImportProgress({
    ...HISTORY_IMPORT_IDLE,
    running: true,
    startedAt,
    finishedAt: undefined,
    total: maxAttempts,
    processed: 0,
    indexed: 0,
    skipped: 0,
    fetchFailed: 0,
    lastUrl: undefined,
    error: undefined,
  });

  try {
    const startTime = Date.now() - daysBack * 86400000;
    const raw = await historySearch({
      text: "",
      startTime,
      maxResults: Math.min(Math.max(maxAttempts * 20, 50), 2500),
    });
    const deduped = dedupeHistoryItems(raw);

    const slice = deduped.slice(0, maxAttempts);

    let processed = 0;
    let indexed = 0;
    let skipped = 0;
    let fetchFailed = 0;

    let nextIndex = 0;
    const concurrency = Math.min(
      HISTORY_IMPORT_FETCH_CONCURRENCY,
      Math.max(1, slice.length)
    );

    async function processHistoryItem(
      item: (typeof deduped)[number]
    ): Promise<void> {
      try {
        const gate = await shouldSkipIndexing(item.url, HISTORY_IMPORT_SENDER, {
          bypassIndexingPause: true,
        });
        if (gate.skip) {
          skipped++;
          return;
        }

        const html = await fetchHtmlForHistory(item.url);
        if (!html) {
          fetchFailed++;
          return;
        }

        const rawExtract = extractPageTextFromHtml(html, item.url);
        const titleRed = redactPII(rawExtract.title);
        const textRed = redactPII(rawExtract.text);
        const title = titleRed.redacted || item.title || item.url;
        const text = textRed.redacted;

        const minLen = minCharsForUrl(item.url);
        if (text.length < minLen) {
          skipped++;
          return;
        }

        const summary = await summarizeBestEffort(text);
        const payload: IndexPayload = {
          url: item.url,
          title,
          text,
          summary,
          visitedAt: item.visitedAt,
        };

        await commitIndexPayload(payload);
        indexed++;
      } catch (e) {
        devLog.warn("[Cortex] history import row:", item.url, e);
        skipped++;
      }
    }

    async function historyWorker(): Promise<void> {
      while (!historyImportAbortRequested) {
        const i = nextIndex++;
        if (i >= slice.length) break;
        const item = slice[i]!;
        processed++;
        await processHistoryItem(item);
        await writeHistoryImportProgress({
          processed,
          indexed,
          skipped,
          fetchFailed,
          lastUrl: item.url,
        });
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, () => historyWorker())
    );

    await writeHistoryImportProgress({
      running: false,
      finishedAt: Date.now(),
      processed,
      indexed,
      skipped,
      fetchFailed,
      lastUrl: undefined,
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    devLog.warn("[Cortex] history import job:", errMsg);
    await writeHistoryImportProgress({
      running: false,
      finishedAt: Date.now(),
      error: errMsg,
    });
  }
}

/** Runs BM25 + hybrid retrieval inside the offscreen document (stable lifetime). */
function searchViaOffscreen(query: string): Promise<
  | { ok: true; hits: SearchHitDTO[]; evidence?: string }
  | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    void ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage(
          { type: "CORTEX_SEARCH_RUN", query },
          (
            res:
              | {
                  ok?: boolean;
                  hits?: SearchHitDTO[];
                  evidence?: string;
                  error?: string;
                }
              | undefined
          ) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error:
                  chrome.runtime.lastError.message ??
                  "Could not reach search runtime.",
              });
              return;
            }
            if (res?.ok === false) {
              resolve({
                ok: false,
                error: res.error ?? "Search failed.",
              });
              return;
            }
            resolve({
              ok: true,
              hits: res?.hits ?? [],
              evidence: res?.evidence,
            });
          }
        );
      })
      .catch((e) => {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  });
}

async function shouldSkipIndexing(
  urlStr: string,
  sender: chrome.runtime.MessageSender,
  opts?: { bypassIndexingPause?: boolean }
): Promise<{ skip: true; reason: string } | { skip: false }> {
  const settings = await getUserSettings();
  if (settings.indexingPaused && !opts?.bypassIndexingPause) {
    return { skip: true, reason: "paused" };
  }

  if (sender.tab?.incognito) {
    return { skip: true, reason: "incognito" };
  }

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { skip: true, reason: "bad_url" };
  }

  if (shouldAlwaysSkipUrl(urlStr)) {
    return { skip: true, reason: "always_skip_registry" };
  }

  const host = url.hostname.toLowerCase();

  if (settings.allowlistOnly) {
    const ok = settings.allowlist.some((h) => {
      const x = h.trim().toLowerCase();
      return x && (host === x || host.endsWith(`.${x}`));
    });
    if (!ok) return { skip: true, reason: "allowlist" };
  }

  if (isBlockedDomain(host, settings.blocklist)) {
    return { skip: true, reason: "blocklist" };
  }

  if (looksSensitiveHostname(host, url.pathname)) {
    return { skip: true, reason: "sensitive_heuristic" };
  }

  return { skip: false };
}

async function openSearchOnTab(tabId: number): Promise<void> {
  const msg = { type: "CORTEX_OPEN_SEARCH" as const };

  const delivered = await new Promise<boolean>((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, () => {
      resolve(!chrome.runtime.lastError);
    });
  });

  if (delivered) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  } catch (e) {
    devLog.warn("[Cortex] overlay inject:", e);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          window.dispatchEvent(new CustomEvent("cortex-open-search"));
        },
      });
    } catch {
      /* e.g. chrome:// or PDF viewer — shortcut cannot inject */
    }
  }
}

/** Stagger tab kicks to stay under per-domain index rate limits (~30/min). */
const FIRST_INSTALL_OPEN_TAB_STAGGER_MS = 2200;
const FIRST_INSTALL_MAX_OPEN_TABS = 28;

function tabSendMessage(tabId: number, message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message as object, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

async function primeOpenTabsAfterInstall(): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  const eligible = tabs.filter((t) => {
    if (t.id == null || t.discarded) return false;
    if (t.incognito) return false;
    const u = t.url ?? "";
    return u.startsWith("http://") || u.startsWith("https://");
  });

  let kicked = 0;
  for (const tab of eligible) {
    if (kicked >= FIRST_INSTALL_MAX_OPEN_TABS) break;
    const tabId = tab.id!;
    kicked++;

    try {
      await tabSendMessage(tabId, { type: "CORTEX_FORCE_INDEX_NOW" });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        await tabSendMessage(tabId, { type: "CORTEX_FORCE_INDEX_NOW" });
      } catch {
        /* chrome://, PDF viewer, blocked pages, etc. */
      }
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, FIRST_INSTALL_OPEN_TAB_STAGGER_MS)
    );
  }
}

async function maybeRunFirstInstallBackfill(): Promise<void> {
  try {
    const r = await chrome.storage.local.get(FIRST_INSTALL_BACKFILL_DONE_KEY);
    if (r[FIRST_INSTALL_BACKFILL_DONE_KEY]) return;

    await chrome.storage.local.set({
      [FIRST_INSTALL_BACKFILL_DONE_KEY]: Date.now(),
    });

    void runHistoryImportJob(7, 300).catch((err: unknown) => {
      devLog.warn("[Cortex] first-install history import:", err);
    });

    void primeOpenTabsAfterInstall().catch((err: unknown) => {
      devLog.warn("[Cortex] first-install open-tab indexing:", err);
    });
  } catch {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  devLog.info("[Cortex] installed — local-only indexing (chunk-level)");
  scheduleStorageMaintenanceAlarm();

  if (details.reason === "install") {
    void maybeRunFirstInstallBackfill();

    void chrome.storage.local.get([ONBOARDING_DONE_KEY], (r) => {
      if (chrome.runtime.lastError) return;
      if (r[ONBOARDING_DONE_KEY]) return;
      void chrome.tabs.create({
        url: chrome.runtime.getURL("onboarding.html"),
        active: true,
      });
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  scheduleStorageMaintenanceAlarm();
});

function scheduleStorageMaintenanceAlarm(): void {
  chrome.alarms.create("cortex-evict-storage", { periodInMinutes: 360 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "cortex-evict-storage") return;
  void ensureIndexingHeadroom().catch(() => {
    /* ignore */
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (
    command !== "open-cortex-search" &&
    command !== "open-cortex-search-alt"
  ) {
    return;
  }
  void chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (id == null) return;
    void openSearchOnTab(id);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse): boolean => {
  if (!msg || typeof msg !== "object") return false;

  if (sender.id !== undefined && sender.id !== chrome.runtime.id) {
    return false;
  }

  if ((msg as { type?: string }).type === "CORTEX_EMBED_TEXT") return false;
  if ((msg as { type?: string }).type === "CORTEX_SEARCH_RUN") return false;

  const type = (msg as { type: string }).type;

  if (type === "CORTEX_INDEX") {
    const p = (msg as { payload: IndexPayload }).payload;
    const domainKey = `index:${hostnameFromUrl(p.url)}`;
    if (!rateLimitHit(domainKey, 30, sendResponse)) return true;

    void (async () => {
      try {
        const gate = await shouldSkipIndexing(
          (msg as { payload: IndexPayload }).payload.url,
          sender
        );
        if (gate.skip) {
          sendResponse({ ok: false, reason: gate.reason });
          return;
        }

        const p = (msg as { payload: IndexPayload }).payload;
        const minLen = minCharsForUrl(p.url);
        if (!p?.text || p.text.length < minLen) {
          sendResponse({ ok: false, reason: "too_short", minLen });
          return;
        }

        const { id: docId, chunks } = await commitIndexPayload(p);
        sendResponse({ ok: true, id: docId, chunks });
      } catch (e) {
        // #region agent log
        agentDebugLog({
          hypothesisId: "H5",
          location: "service-worker.ts:CORTEX_INDEX",
          message: "index_caught",
          data: {
            err: e instanceof Error ? e.message : String(e),
          },
        });
        // #endregion
        devLog.warn("[Cortex] index error:", e);
        if (e instanceof CortexError) {
          sendResponse({
            ok: false,
            error: e.code,
            ...e.toPayload(),
          });
          return;
        }
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_CHAT_START") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: "no_tab" });
      return true;
    }
    const question = String((msg as { question?: string }).question ?? "");
    if (question.length > CHAT_LIMITS.MAX_QUESTION_CHARS) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.QUESTION_TOO_LONG,
        maxLen: CHAT_LIMITS.MAX_QUESTION_CHARS,
        ...payloadFromCode(ERROR_CODES.QUESTION_TOO_LONG),
      });
      return true;
    }
    if (!rateLimitHit(`chat:${tabId}`, 10, sendResponse)) return true;
    void (async () => {
      try {
        await ensureOffscreen();
        const settings = await getChatSettings();
        const conversationIdRaw = (msg as { conversationId?: unknown })
          .conversationId;
        const conversationId =
          typeof conversationIdRaw === "number" &&
          Number.isFinite(conversationIdRaw)
            ? conversationIdRaw
            : null;
        const inbound: CortexBusInbound = {
          kind: "chat-run",
          tabId,
          conversationId,
          question,
          settings,
        };
        cortexBus.postMessage(inbound);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_DIGEST_START") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: "no_tab" });
      return true;
    }
    const rangeRaw = (msg as { range?: string }).range;
    const range =
      rangeRaw === "today" ||
      rangeRaw === "yesterday" ||
      rangeRaw === "last_7_days"
        ? rangeRaw
        : "yesterday";
    if (!rateLimitHit(`digest:${tabId}`, 5, sendResponse)) return true;
    void (async () => {
      try {
        await ensureOffscreen();
        const settings = await getChatSettings();
        const inbound: CortexBusInbound = {
          kind: "digest-run",
          tabId,
          range,
          forceRegenerate: Boolean(
            (msg as { forceRegenerate?: boolean }).forceRegenerate
          ),
          settings,
        };
        cortexBus.postMessage(inbound);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_SEARCH") {
    const tabPart = sender.tab?.id ?? 0;
    if (!rateLimitHit(`search:${tabPart}`, 60, sendResponse)) return true;
    void (async () => {
      try {
        const q = String((msg as { query?: string }).query || "");
        const result = await searchViaOffscreen(q);
        if (result.ok) {
          sendResponse({
            ok: true,
            hits: result.hits,
            evidence: result.evidence,
          });
        } else {
          sendResponse({ ok: false, error: result.error });
        }
      } catch (e) {
        devLog.error("[Cortex] CORTEX_SEARCH:", e);
        sendResponse({
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Search failed",
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_STATS") {
    void (async () => {
      // #region agent log
      agentDebugLog({
        hypothesisId: "H3",
        location: "service-worker.ts:CORTEX_STATS",
        message: "stats_enter",
        data: {},
      });
      // #endregion
      try {
        const tabUrl =
          typeof (msg as { tabUrl?: string }).tabUrl === "string"
            ? (msg as { tabUrl?: string }).tabUrl
            : undefined;
        const tabIncognito = Boolean(
          (msg as { tabIncognito?: boolean }).tabIncognito
        );

        const storageEstimate = async (): Promise<
          StorageEstimate | undefined
        > => {
          try {
            return await navigator.storage?.estimate?.();
          } catch {
            return undefined;
          }
        };

        const [pages, chunksN, visitCount, recent, settings, est] =
          await Promise.all([
            documentCount(),
            chunkCount(),
            db.visitLog.count(),
            getRecentVisits(12),
            getUserSettings(),
            storageEstimate(),
          ]);

        let storageBytes: number | undefined;
        let storageQuotaBytes: number | undefined;
        if (est && typeof est.usage === "number") storageBytes = est.usage;
        if (est && typeof est.quota === "number") storageQuotaBytes = est.quota;
        let currentTab:
          | {
              line: string;
              badge:
                | "active"
                | "paused"
                | "blocked"
                | "skipped"
                | "indexed"
                | "neutral";
            }
          | undefined;

        if (tabUrl !== undefined) {
          currentTab = await describeTabForPopup(tabUrl, tabIncognito, settings);
        }

        sendResponse({
          ok: true,
          pageCount: pages,
          chunkCount: chunksN,
          visitCount,
          storageBytes,
          storageQuotaBytes,
          indexingPaused: settings.indexingPaused,
          currentTab,
          recent: recent.map((v) => ({
            url: v.url,
            title: v.title,
            visitedAt: v.visitedAt,
            hostname: v.hostname,
          })),
        });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        devLog.warn("[Cortex] CORTEX_STATS failed:", errMsg);
        // #region agent log
        agentDebugLog({
          hypothesisId: "H3",
          location: "service-worker.ts:CORTEX_STATS",
          message: "stats_handler_error",
          data: { err: errMsg },
          runId: "post-fix",
        });
        // #endregion
        try {
          sendResponse({
            ok: false,
            error: errMsg,
          });
        } catch (sendErr: unknown) {
          devLog.warn("[Cortex] CORTEX_STATS sendResponse failed:", sendErr);
        }
      }
    })();
    return true;
  }

  if (type === "CORTEX_CLEAR_ALL_DATA") {
    void (async () => {
      try {
        await clearAllIndexedData();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_START") {
    if (!rateLimitHit("history_import_start", 1, sendResponse)) return true;
    void (async () => {
      const daysRaw = Number((msg as { daysBack?: number }).daysBack);
      const maxRaw = Number((msg as { maxUrls?: number }).maxUrls);
      const daysBack = Number.isFinite(daysRaw)
        ? Math.min(365, Math.max(1, Math.floor(daysRaw)))
        : 30;
      const maxAttempts = Number.isFinite(maxRaw)
        ? Math.min(500, Math.max(5, Math.floor(maxRaw)))
        : 300;

      const cur = await readHistoryImportProgress();
      if (cur.running) {
        sendResponse({ ok: false as const, error: "already_running" });
        return;
      }

      sendResponse({ ok: true as const });
      await runHistoryImportJob(daysBack, maxAttempts);
    })();
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_STATUS") {
    void readHistoryImportProgress().then((progress) => {
      sendResponse({ ok: true as const, progress });
    });
    return true;
  }

  if (type === "CORTEX_HISTORY_IMPORT_CANCEL") {
    historyImportAbortRequested = true;
    sendResponse({ ok: true as const });
    return true;
  }

  if (type === "CORTEX_OPEN_TAB") {
    const raw = String((msg as { url?: string }).url || "");
    const href = safeHttpHttpsHref(raw);
    const active = (msg as { active?: boolean }).active !== false;
    if (!href) {
      sendResponse({
        ok: false,
        error: ERROR_CODES.INVALID_URL,
        ...payloadFromCode(ERROR_CODES.INVALID_URL),
      });
      return true;
    }
    void chrome.tabs.create({ url: href, active }).catch(() => {
      /* ignore */
    });
    sendResponse({ ok: true });
    return true;
  }

  if (type === "CORTEX_POPUP_OPEN_SEARCH") {
    void chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id;
      if (id != null) void openSearchOnTab(id);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (type === "CORTEX_OPEN_OPTIONS") {
    void (async () => {
      try {
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true as const });
      } catch (e: unknown) {
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }

  return false;
});

async function describeTabForPopup(
  tabUrl: string,
  tabIncognito: boolean,
  settings: Awaited<ReturnType<typeof getUserSettings>>
): Promise<{
  line: string;
  badge: "active" | "paused" | "blocked" | "skipped" | "indexed" | "neutral";
}> {
  if (settings.indexingPaused) {
    return { line: "", badge: "paused" };
  }

  if (tabIncognito) {
    return {
      line: "Private window — not indexed.",
      badge: "skipped",
    };
  }

  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return { line: "Can’t index this URL.", badge: "skipped" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      line: "Can’t index this page.",
      badge: "skipped",
    };
  }

  if (shouldAlwaysSkipUrl(tabUrl)) {
    return {
      line: "Skipped — sensitive or inbox/storage URL.",
      badge: "skipped",
    };
  }

  const host = url.hostname.toLowerCase();

  if (settings.allowlistOnly) {
    const ok = settings.allowlist.some((h) => {
      const x = h.trim().toLowerCase();
      return x && (host === x || host.endsWith(`.${x}`));
    });
    if (!ok) {
      return {
        line: "Host not on your allowlist.",
        badge: "blocked",
      };
    }
  }

  if (isBlockedDomain(host, settings.blocklist)) {
    return {
      line: "Domain on your blocklist.",
      badge: "blocked",
    };
  }

  if (looksSensitiveHostname(host, url.pathname)) {
    return {
      line: "Skipped (sensitive URL).",
      badge: "skipped",
    };
  }

  const doc = await db.documents.where("url").equals(tabUrl).first();
  if (doc?.lastVisitedAt) {
    const when = new Date(doc.lastVisitedAt);
    const rel = formatRelativeTime(when.getTime());
    return {
      line: `This page is indexed · ${rel}`,
      badge: "indexed",
    };
  }

  return {
    line: "Not saved yet — keep this tab open briefly so Cortex can capture it.",
    badge: "neutral",
  };
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}
