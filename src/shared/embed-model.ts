/** Must stay in sync with Transformers.js pipeline id in offscreen.ts */
export const CORTEX_EMBED_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * `q8` maps to `onnx/model_quantized.onnx`, the same file the 1.0.x build
 * loaded through `quantized: true`. Shared by offscreen, eval and parity test.
 */
export const CORTEX_EMBED_DTYPE = "q8" as const;

/**
 * Pipeline options per runtime. Browser is fixed to the WASM execution
 * provider: the bundled weights are int8 and Transformers.js pairs WebGPU
 * with fp32/fp16 weights, which are not shipped (see docs/release-1.2.0/phase-1.md).
 * Node (eval harness, parity test) uses the onnxruntime-node CPU provider.
 */
export function embedPipelineOptions(runtime: "browser" | "node"): {
  dtype: typeof CORTEX_EMBED_DTYPE;
  device: "wasm" | "cpu";
} {
  return { dtype: CORTEX_EMBED_DTYPE, device: runtime === "browser" ? "wasm" : "cpu" };
}

/** Bundled ONNX Runtime WASM binary, copied by webpack to dist/wasm/. */
export const CORTEX_ORT_WASM_FILE = "wasm/ort-wasm-simd-threaded.wasm";
