import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { configureTransformersEnv } from "../../src/lib/transformers-env";
import { CORTEX_EMBED_MODEL_ID, embedPipelineOptions } from "../../src/shared/embed-model";

/** Node-side embedding using the same model id and dtype the offscreen document uses. */
export async function embedTextsForParity(texts: string[]): Promise<number[][]> {
  configureTransformersEnv({
    localModelPath: join(process.cwd(), "vendor", "models") + "/",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe: any = await pipeline(
    "feature-extraction",
    CORTEX_EMBED_MODEL_ID,
    embedPipelineOptions("node")
  );
  const out: number[][] = [];
  for (const t of texts) {
    const o = await pipe(t, { pooling: "mean", normalize: true });
    out.push(Array.from(o.data as Float32Array));
  }
  return out;
}
