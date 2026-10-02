/// <reference types="chrome"/>
import { pipeline } from "@huggingface/transformers";
import {
  configureTransformersEnv,
  setTransformersLocalModelPath,
} from "../lib/transformers-env";
import { embedWithSessionCache } from "../lib/query-embed-cache";
import { runAdvancedSearch } from "../lib/search-engine";
import {
  CORTEX_EMBED_MODEL_ID,
  embedPipelineOptions,
  CORTEX_ORT_WASM_FILE,
} from "../shared/embed-model";
import { agentDebugLog } from "../lib/agent-debug-log";
import { runChat } from "../lib/chat/chat-engine";
import { ChatRunRegistry } from "../lib/chat/chat-run-registry";
import { findMostSimilarDocument } from "../lib/resurface";
import { runImageDescriptions } from "../lib/capture/images";
import { promptApiImageDescriber } from "./image-describer";
import { fetchAndExtractPdf } from "./pdf-fetch";
import { generateDigest } from "../lib/chat/digest-engine";
import {
  CORTEX_EXTENSION_BUS_CHANNEL,
  type CortexBusInbound,
  type CortexBusOutbound,
} from "../lib/extension-bus";
import { isPrivilegedExtensionSender } from "../lib/message-security";
import { SEARCH_LIMITS } from "../lib/limits";
import {
  backupGateUrls,
  collectBackup,
  restoreBackup,
  validateBackup,
} from "../lib/export/backup";
import { buildVault } from "../lib/export/markdown-vault";
import { createZip } from "../lib/export/zip";
import {
  BACKUP_FAILED,
  BACKUP_GATE_MESSAGE,
  BACKUP_MAX_CHARS,
  BACKUP_TOO_LARGE,
  BACKUP_WORK_MESSAGE,
  type BackupWorkMessage,
} from "../lib/export/backup-router";
import type { ChatSettings } from "../lib/chat/types";

/** Bundled weights under dist/models/ and ORT binary under dist/wasm/: zero CDN or Hub fetch. */
configureTransformersEnv({
  wasmBinaryUrl: chrome.runtime.getURL(CORTEX_ORT_WASM_FILE),
});

let embeddingEnvReady = false;

async function ensureEmbeddingEnv(): Promise<void> {
  if (embeddingEnvReady) return;

  const base = chrome.runtime.getURL("models/");
  setTransformersLocalModelPath(base);

  const probe = `${base}Xenova/all-MiniLM-L6-v2/tokenizer.json`;
  const r = await fetch(probe);
  if (!r.ok) {
    // #region agent log
    agentDebugLog({
      hypothesisId: "H2",
      location: "offscreen.ts:ensureEmbeddingEnv",
      message: "model_probe_failed",
      data: { status: r.status, probe },
    });
    // #endregion
    throw new Error(
      `[Cortex] Bundled model missing (${probe}). Run "npm run prepare-model" then rebuild the extension.`
    );
  }

  embeddingEnvReady = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeFn: any = null;

async function getPipe(): Promise<any> {
  if (pipeFn) return pipeFn;

  await ensureEmbeddingEnv();

  pipeFn = await pipeline(
    "feature-extraction",
    CORTEX_EMBED_MODEL_ID,
    embedPipelineOptions("browser")
  );
  return pipeFn;
}

const MAX_EMBED_CHARS = 8000;

/** Same model as CORTEX_EMBED_TEXT — avoids extra extension messages during search */
async function embedQueryForSearch(text: string): Promise<number[] | null> {
  try {
    return await embedWithSessionCache(
      text,
      async (raw) => {
        const pipe = await getPipe();
        const output = await pipe(raw, {
          pooling: "mean",
          normalize: true,
        });
        const tensorData = output?.data as Float32Array | undefined;
        if (!tensorData?.length) return null;
        return Array.from(tensorData);
      },
      MAX_EMBED_CHARS
    );
  } catch {
    return null;
  }
}


// ------------------------------------------------- export and backup (6.7)

const SERVICE_WORKER_URL = chrome.runtime.getURL("service-worker.js");

/**
 * Stricter than `isPrivilegedExtensionSender` for the backup work message:
 * only the service worker may ask for it. A content script is already out
 * (it has a tab), and so is every extension page, because a page carries a
 * `documentId` and its own URL while the service worker carries neither.
 * The options-page check and the rate limit have already run there.
 */
function isServiceWorkerSender(sender: chrome.runtime.MessageSender): boolean {
  if (!isPrivilegedExtensionSender(sender)) return false;
  if (sender.documentId != null) return false;
  return sender.url === undefined || sender.url === SERVICE_WORKER_URL;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The privacy gate lives in the service worker: it needs the effective
 * settings and the managed policy, and it must refuse outright when policy
 * `indexingDisabled` is set. One call decides every URL in the file.
 */
function askPrivacyGate(
  token: string,
  urls: string[]
): Promise<{ ok: true; allowed: boolean[] } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: BACKUP_GATE_MESSAGE, token, urls },
      (r: { ok?: boolean; allowed?: unknown; error?: unknown } | undefined) => {
        if (chrome.runtime.lastError || !r) {
          resolve({ ok: false, error: BACKUP_FAILED });
          return;
        }
        if (r.ok !== true || !Array.isArray(r.allowed)) {
          resolve({ ok: false, error: typeof r.error === "string" ? r.error : BACKUP_FAILED });
          return;
        }
        resolve({ ok: true, allowed: r.allowed as boolean[] });
      }
    );
  });
}

/**
 * Same order of checks as the Phase 5.10 service worker handler: size, JSON,
 * shape, then (restore only) the confirmation, the policy and the gate.
 */
async function runBackupWork(m: BackupWorkMessage): Promise<unknown> {
  if (m.op === "CORTEX_EXPORT") {
    const backup = await collectBackup();
    const stamp = new Date(backup.exportedAt).toISOString().slice(0, 10);
    if (m.format === "markdown") {
      const zip = createZip(buildVault(backup));
      return { ok: true, filename: `cortex-notes-${stamp}.zip`, mime: "application/zip", base64: bytesToBase64(zip) };
    }
    return { ok: true, filename: `cortex-backup-${stamp}.json`, mime: "application/json", text: JSON.stringify(backup) };
  }

  const text = typeof m.text === "string" ? m.text : "";
  if (text.length > BACKUP_MAX_CHARS) return { ok: false, error: BACKUP_TOO_LARGE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a Cortex backup (it is not valid JSON)." };
  }
  const v = validateBackup(parsed);
  if (!v.ok) return { ok: false, error: v.error };
  if (m.op === "CORTEX_BACKUP_VALIDATE") {
    return { ok: true, counts: v.counts, exportedAt: v.backup.exportedAt };
  }
  if (m.confirmed !== true) return { ok: false, error: "Confirm the restore first." };

  const urls = backupGateUrls(v.backup);
  const gate = await askPrivacyGate(m.token, urls);
  if (!gate.ok) return { ok: false, error: gate.error };
  // Anything the gate did not explicitly allow stays out and is counted in
  // `blocked`, exactly as before: the default here is "not allowed".
  const allowed = new Map(urls.map((u, i) => [u, gate.allowed[i] === true]));
  const res = await restoreBackup(v.backup, {
    mode: m.mode === "replace" ? "replace" : "merge",
    allowUrl: async (u) => allowed.get(u) === true,
  });
  return { ok: true, added: res.added, blocked: res.blocked };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse): boolean => {
  if (!isPrivilegedExtensionSender(sender)) {
    return false;
  }

  if (msg?.type === BACKUP_WORK_MESSAGE) {
    if (!isServiceWorkerSender(sender)) {
      sendResponse({ ok: false, error: "foreign_sender" });
      return true;
    }
    void runBackupWork(msg as BackupWorkMessage)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: BACKUP_FAILED }));
    return true;
  }

  if (msg?.type === "CORTEX_EMBED_TEXT") {
    void (async () => {
      try {
        const pipe = await getPipe();
        const raw = String(msg.text || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_EMBED_CHARS);
        if (!raw) {
          sendResponse({ ok: false as const, error: "empty text" });
          return;
        }

        const output = await pipe(raw, {
          pooling: "mean",
          normalize: true,
        });

        const tensorData = output?.data as Float32Array | undefined;
        if (!tensorData?.length) {
          sendResponse({ ok: false as const, error: "no tensor" });
          return;
        }

        const vec = Array.from(tensorData);
        sendResponse({ ok: true as const, vec });
      } catch (e: unknown) {
        // #region agent log
        agentDebugLog({
          hypothesisId: "H2",
          location: "offscreen.ts:CORTEX_EMBED_TEXT",
          message: "embed_caught",
          data: {
            err: e instanceof Error ? e.message : String(e),
          },
        });
        // #endregion
        sendResponse({
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return true;
  }

  if (msg?.type === "CORTEX_ASSISTANT_SYNC_WORK") {
    if (!isServiceWorkerSender(sender)) {
      sendResponse({ ok: false, error: "foreign_sender" });
      return true;
    }
    const action =
      msg.action === "enable" || msg.action === "now" || msg.action === "alarm" || msg.action === "disable"
        ? msg.action
        : "alarm";
    const token = typeof msg.token === "string" ? msg.token : "";
    const folderId = typeof msg.folderId === "string" ? msg.folderId : null;
    const fileId = typeof msg.fileId === "string" ? msg.fileId : null;
    const backupFileId = typeof msg.backupFileId === "string" ? msg.backupFileId : null;
    const retentionDays = typeof msg.retentionDays === "number" ? msg.retentionDays : undefined;
    const archivesEnabled = typeof msg.archivesEnabled === "boolean" ? msg.archivesEnabled : undefined;
    void import(/* webpackChunkName: "assistant-sync" */ "../assistant-sync/runtime")
      .then((mod) =>
        mod.runAssistantSyncFromChrome(action, token, {
          ids: { folderId, fileId },
          retentionDays,
          archivesEnabled,
          backupFileId,
        })
      )
      .then((result) => sendResponse(result))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error && error.message ? error.message : "Sync did not start.",
        })
      );
    return true;
  }

  if (msg?.type === "CORTEX_ASSISTANT_SYNC_CAPTURE") {
    if (!isServiceWorkerSender(sender)) {
      sendResponse({ ok: false, error: "foreign_sender" });
      return true;
    }
    const visit = msg.visit as {
      id?: string;
      url?: string;
      title?: string;
      visitedAt?: number;
      linkedInFields?: {
        kind?: string;
        name?: string;
        headline?: string;
        company?: string;
        profileUrl?: string;
      } | null;
    } | undefined;
    const fields = visit?.linkedInFields;
    const linkedInFields =
      fields &&
      (fields.kind === "person" || fields.kind === "company") &&
      typeof fields.name === "string" &&
      typeof fields.profileUrl === "string"
        ? {
            kind: fields.kind as "person" | "company",
            name: fields.name,
            headline: typeof fields.headline === "string" ? fields.headline : undefined,
            company: typeof fields.company === "string" ? fields.company : undefined,
            profileUrl: fields.profileUrl,
          }
        : null;
    void import(/* webpackChunkName: "assistant-sync" */ "../assistant-sync/runtime")
      .then((mod) =>
        mod.captureVisitFromChrome({
          id: String(visit?.id ?? ""),
          url: String(visit?.url ?? ""),
          title: String(visit?.title ?? ""),
          visitedAt: Number(visit?.visitedAt ?? 0),
          linkedInFields,
        })
      )
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "capture_failed" }));
    return true;
  }

  if (msg?.type === "CORTEX_ASSISTANT_SYNC_TRASH") {
    if (!isServiceWorkerSender(sender)) {
      sendResponse({ ok: false, error: "foreign_sender" });
      return true;
    }
    const token = typeof msg.token === "string" ? msg.token : "";
    const folderId = typeof msg.folderId === "string" ? msg.folderId : null;
    const fileId = typeof msg.fileId === "string" ? msg.fileId : null;
    void import(/* webpackChunkName: "assistant-sync" */ "../assistant-sync/runtime")
      .then((mod) => mod.trashStoredMemoryFromChrome(token, { folderId, fileId }))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false as const, error: "drive_trash_failed" }));
    return true;
  }

  if (msg?.type === "CORTEX_PDF_EXTRACT") {
    // Phase 5.9: the service worker already ran the privacy gate for this URL.
    void fetchAndExtractPdf(String(msg.url ?? ""))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false as const, reason: "parse_failed" }));
    return true;
  }

  if (msg?.type === "CORTEX_DESCRIBE_IMAGES") {
    // Phase 5.8: the service worker already applied the user setting, the
    // policy and the 5-image cap; runImageDescriptions caps again.
    const images = Array.isArray(msg.images) ? msg.images : [];
    void runImageDescriptions(images, promptApiImageDescriber())
      .then((descriptions) => sendResponse({ ok: true as const, descriptions }))
      .catch(() => sendResponse({ ok: false as const, descriptions: [] }));
    return true;
  }

  if (msg?.type === "CORTEX_RESURFACE_RUN") {
    const id = Number(msg.documentId);
    void findMostSimilarDocument(id)
      .then((best) => sendResponse({ ok: true as const, best }))
      .catch((e) => sendResponse({ ok: false as const, error: String(e) }));
    return true;
  }

  if (msg?.type === "CORTEX_SEARCH_RUN") {
    const q = String(msg.query ?? "");
    if (q.length > SEARCH_LIMITS.MAX_QUERY_CHARS) {
      sendResponse({
        ok: false as const,
        error: "query_too_long",
      });
      return true;
    }
    void (async () => {
      try {
        const cid = (msg as { collectionId?: unknown }).collectionId;
        const { hits, evidence } = await runAdvancedSearch(
          q,
          embedQueryForSearch,
          typeof cid === "number" && Number.isFinite(cid) ? { collectionId: cid } : undefined
        );
        sendResponse({ ok: true as const, hits, evidence });
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

const cortexExtBus = new BroadcastChannel(CORTEX_EXTENSION_BUS_CHANNEL);
const chatRuns = new ChatRunRegistry();

cortexExtBus.onmessage = (ev: MessageEvent<CortexBusInbound>) => {
  const incoming = ev.data;
  if (!incoming?.kind) return;

  if (incoming.kind === "chat-abort") {
    chatRuns.abort(incoming.tabId, incoming.requestId);
    return;
  }

  if (incoming.kind === "chat-run") {
    const { tabId, requestId } = incoming;
    const signal = chatRuns.start(tabId, requestId);
    void (async () => {
      try {
        const settings = incoming.settings;
        for await (const event of runChat(
          incoming.conversationId,
          incoming.question,
          settings,
          embedQueryForSearch,
          { signal, ...(incoming.collectionId != null ? { collectionId: incoming.collectionId } : {}) }
        )) {
          const out: CortexBusOutbound = {
            kind: "chat-event",
            tabId,
            requestId,
            event,
          };
          cortexExtBus.postMessage(out);
        }
      } catch (e: unknown) {
        const errOut: CortexBusOutbound = {
          kind: "chat-event",
          tabId,
          requestId,
          event: {
            type: "error",
            data: {
              message: e instanceof Error ? e.message : String(e),
              recoverable: false,
            },
          },
        };
        cortexExtBus.postMessage(errOut);
      } finally {
        chatRuns.finish(tabId, requestId);
      }
    })();
    return;
  }

  if (incoming.kind === "digest-run") {
    void (async () => {
      try {
        const settings = incoming.settings;
        const result = await generateDigest(
          {
            range: incoming.range,
            forceRegenerate: incoming.forceRegenerate,
          },
          settings
        );
        cortexExtBus.postMessage({
          kind: "digest-done",
          tabId: incoming.tabId,
          result,
        });
      } catch (e: unknown) {
        cortexExtBus.postMessage({
          kind: "digest-error",
          tabId: incoming.tabId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }
};
