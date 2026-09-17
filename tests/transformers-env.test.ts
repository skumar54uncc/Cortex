import { describe, it, expect } from "vitest";
import {
  configureTransformersEnv,
  readTransformersEnvForTest,
} from "../src/lib/transformers-env";

describe("configureTransformersEnv", () => {
  it("closes every remote path and points ORT at the bundled WASM binary", () => {
    configureTransformersEnv({
      localModelPath: "chrome-extension://abc/models/",
      wasmBinaryUrl: "chrome-extension://abc/wasm/ort-wasm-simd-threaded.wasm",
    });
    const e = readTransformersEnvForTest();
    expect(e.allowRemoteModels).toBe(false);
    expect(e.allowLocalModels).toBe(true);
    expect(e.useBrowserCache).toBe(false);
    expect(e.useWasmCache).toBe(false);
    expect(e.localModelPath).toBe("chrome-extension://abc/models/");
    expect(e.wasm?.numThreads).toBe(1);
    expect(e.wasm?.proxy).toBe(false);
    expect(e.wasm?.wasmPaths).toEqual({
      wasm: "chrome-extension://abc/wasm/ort-wasm-simd-threaded.wasm",
    });
    const paths = JSON.stringify(e.wasm?.wasmPaths);
    expect(paths).not.toContain("jsdelivr");
    expect(paths).not.toContain("http");
  });
});
