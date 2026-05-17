import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline, env } from "@xenova/transformers";
import { CORTEX_EMBED_MODEL_ID } from "../../src/shared/embed-model.js";

const CACHE_VERSION = "v1";
const MAX_EMBED_CHARS = 8000;

let pipeReady: Promise<FeaturePipeline> | null = null;

type FeaturePipeline = (
  text: string,
  opts: { pooling: string; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

function projectRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
}

function cacheDir(): string {
  return join(projectRoot(), "eval", ".cache", "embeddings", CACHE_VERSION);
}

function normalizeForEmbed(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EMBED_CHARS);
}

function cacheKey(text: string): string {
  const norm = normalizeForEmbed(text);
  const hash = createHash("sha256")
    .update(`${CORTEX_EMBED_MODEL_ID}\n${norm}`)
    .digest("hex");
  return hash;
}

function cachePath(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

export function isEmbeddingCacheWarm(): boolean {
  const dir = cacheDir();
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

async function ensurePipeline(): Promise<FeaturePipeline> {
  if (!pipeReady) {
    pipeReady = (async () => {
      const modelRoot = join(projectRoot(), "vendor", "models");
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = modelRoot.endsWith("/") ? modelRoot : `${modelRoot}/`;
      if (env.backends.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
      }
      const pipe = await pipeline("feature-extraction", CORTEX_EMBED_MODEL_ID, {
        quantized: true,
      });
      return pipe as FeaturePipeline;
    })();
  }
  return pipeReady;
}

interface CachedEmbedding {
  modelId: string;
  dim: number;
  vector: number[];
}

function readCache(key: string): number[] | null {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as CachedEmbedding;
    if (raw.modelId !== CORTEX_EMBED_MODEL_ID || !Array.isArray(raw.vector)) {
      return null;
    }
    return raw.vector;
  } catch {
    return null;
  }
}

function writeCache(key: string, vector: number[]): void {
  mkdirSync(cacheDir(), { recursive: true });
  const payload: CachedEmbedding = {
    modelId: CORTEX_EMBED_MODEL_ID,
    dim: vector.length,
    vector,
  };
  writeFileSync(cachePath(key), JSON.stringify(payload), "utf8");
}

export async function embedText(text: string): Promise<number[]> {
  const key = cacheKey(text);
  const cached = readCache(key);
  if (cached) return cached;

  const pipe = await ensurePipeline();
  const raw = normalizeForEmbed(text);
  if (!raw) return [];

  const output = await pipe(raw, { pooling: "mean", normalize: true });
  const tensorData = output?.data;
  const vec =
    tensorData instanceof Float32Array
      ? Array.from(tensorData)
      : Array.isArray(tensorData)
        ? tensorData
        : [];

  if (vec.length > 0) writeCache(key, vec);
  return vec;
}
