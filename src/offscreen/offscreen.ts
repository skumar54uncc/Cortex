/// <reference types="chrome"/>
import { pipeline, env } from "@xenova/transformers";
import { runAdvancedSearch } from "../lib/search-engine";
import { CORTEX_EMBED_MODEL_ID } from "../shared/embed-model";
import { agentDebugLog } from "../lib/agent-debug-log";
import { runChat } from "../lib/chat/chat-engine";
import { generateDigest } from "../lib/chat/digest-engine";
import {
  CORTEX_EXTENSION_BUS_CHANNEL,
  type CortexBusInbound,
  type CortexBusOutbound,
} from "../lib/extension-bus";

/** Bundled weights under dist/models/ — zero CDN/HF fetch after install (see npm run prepare-model). */
env.allowLocalModels = true;
env.allowRemoteModels = false;

/**
 * ONNX Runtime Web pthread workers often use blob: URLs, which managed / current Chrome builds
 * reject in MV3 extension_pages CSP. Keep single-thread WASM so workers load from extension
 * origins only (worker-src 'self' in manifest).
 */
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

let embeddingEnvReady = false;

async function ensureEmbeddingEnv(): Promise<void> {
  if (embeddingEnvReady) return;

  const base = chrome.runtime.getURL("models/");
  env.localModelPath = base;

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

  pipeFn = await pipeline("feature-extraction", CORTEX_EMBED_MODEL_ID, {
    quantized: true,
  });
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse): boolean => {
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

  if (msg?.type === "CORTEX_SEARCH_RUN") {
    void (async () => {
      try {
        const { hits, evidence } = await runAdvancedSearch(
          String(msg.query ?? ""),
          embedQueryForSearch
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

cortexExtBus.onmessage = (ev: MessageEvent<CortexBusInbound>) => {
  const incoming = ev.data;
  if (!incoming?.kind) return;

  if (incoming.kind === "chat-run") {
    void (async () => {
      try {
        for await (const event of runChat(
          incoming.conversationId,
          incoming.question,
          incoming.settings,
          embedQueryForSearch
        )) {
          const out: CortexBusOutbound = {
            kind: "chat-event",
            tabId: incoming.tabId,
            event,
          };
          cortexExtBus.postMessage(out);
        }
      } catch (e: unknown) {
        cortexExtBus.postMessage({
          kind: "chat-event",
          tabId: incoming.tabId,
          event: {
            type: "error",
            data: {
              message: e instanceof Error ? e.message : String(e),
              recoverable: false,
            },
          },
        });
      }
    })();
    return;
  }

  if (incoming.kind === "digest-run") {
    void (async () => {
      try {
        const result = await generateDigest(
          {
            range: incoming.range,
            forceRegenerate: incoming.forceRegenerate,
          },
          incoming.settings
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
