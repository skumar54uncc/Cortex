/// <reference types="chrome"/>
import { pipeline } from "@huggingface/transformers";
import {
  configureTransformersEnv,
  setTransformersLocalModelPath,
} from "../lib/transformers-env";
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
import { generateDigest } from "../lib/chat/digest-engine";
import {
  CORTEX_EXTENSION_BUS_CHANNEL,
  type CortexBusInbound,
  type CortexBusOutbound,
} from "../lib/extension-bus";
import { isPrivilegedExtensionSender } from "../lib/message-security";
import { SEARCH_LIMITS } from "../lib/limits";
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
    const pipe = await getPipe();
    const raw = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_EMBED_CHARS);
    if (!raw) return null;

    const output = await pipe(raw, {
      pooling: "mean",
      normalize: true,
    });

    const tensorData = output?.data as Float32Array | undefined;
    if (!tensorData?.length) return null;
    return Array.from(tensorData);
  } catch {
    return null;
  }
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse): boolean => {
  if (!isPrivilegedExtensionSender(sender)) {
    return false;
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
