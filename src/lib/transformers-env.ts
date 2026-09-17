import { env } from "@huggingface/transformers";

export type ConfigureTransformersEnvOptions = {
  localModelPath?: string;
  allowRemoteModels?: boolean;
  /** Absolute URL of the bundled ORT WASM binary (browser only). */
  wasmBinaryUrl?: string;
};

type OnnxWasmEnv = {
  numThreads?: number;
  proxy?: boolean;
  wasmPaths?: string | { wasm?: string; mjs?: string };
};

/**
 * Shared offscreen + eval embedding setup.
 *
 * Every remote path is closed: no Hugging Face Hub, no browser cache, no CDN
 * for the ONNX Runtime binary. The 1.0.x build left `wasmPaths` unset, which
 * made Transformers.js fetch `ort-wasm*.wasm` from cdn.jsdelivr.net on first
 * embed. 1.2.0 ships the binary in the extension package instead.
 */
export function configureTransformersEnv(
  opts: ConfigureTransformersEnvOptions = {}
): void {
  env.allowLocalModels = true;
  env.allowRemoteModels = opts.allowRemoteModels ?? false;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useWasmCache = false;
  if (opts.localModelPath != null) {
    env.localModelPath = opts.localModelPath;
  }

  const onnx = env.backends.onnx as { wasm?: OnnxWasmEnv } | undefined;
  if (onnx?.wasm) {
    // Extension pages are not cross-origin isolated: no SharedArrayBuffer, so one thread.
    onnx.wasm.numThreads = 1;
    onnx.wasm.proxy = false;
    if (opts.wasmBinaryUrl) {
      onnx.wasm.wasmPaths = { wasm: opts.wasmBinaryUrl };
    }
  }
}

export function setTransformersLocalModelPath(base: string): void {
  env.localModelPath = base;
}

/** Exposed for tests. */
export function readTransformersEnvForTest(): {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache: boolean;
  useWasmCache: boolean;
  localModelPath: string;
  wasm: OnnxWasmEnv | undefined;
} {
  const onnx = env.backends.onnx as { wasm?: OnnxWasmEnv } | undefined;
  return {
    allowRemoteModels: env.allowRemoteModels,
    allowLocalModels: env.allowLocalModels,
    useBrowserCache: env.useBrowserCache,
    useWasmCache: env.useWasmCache,
    localModelPath: env.localModelPath,
    wasm: onnx?.wasm,
  };
}
