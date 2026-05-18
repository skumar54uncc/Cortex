import { env } from "@xenova/transformers";

/** Runtime env bag — @xenova/transformers types mark these as readonly. */
type TransformersEnvMutable = {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  useBrowserCache: boolean;
  useFSCache: boolean;
  localModelPath: string;
  backends: typeof env.backends;
};

function mutableEnv(): TransformersEnvMutable {
  return env as unknown as TransformersEnvMutable;
}

export type ConfigureTransformersEnvOptions = {
  localModelPath?: string;
  allowRemoteModels?: boolean;
};

/** Shared offscreen + eval embedding setup. */
export function configureTransformersEnv(
  opts: ConfigureTransformersEnvOptions = {}
): void {
  const e = mutableEnv();
  e.allowLocalModels = true;
  e.allowRemoteModels = opts.allowRemoteModels ?? false;
  e.useBrowserCache = false;
  e.useFSCache = false;
  if (opts.localModelPath != null) {
    e.localModelPath = opts.localModelPath;
  }
  if (e.backends.onnx?.wasm) {
    e.backends.onnx.wasm.numThreads = 1;
  }
}

export function setTransformersLocalModelPath(base: string): void {
  mutableEnv().localModelPath = base;
}
