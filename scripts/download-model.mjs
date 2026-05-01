#!/usr/bin/env node
/**
 * Downloads Xenova/all-MiniLM-L6-v2 ONNX snapshot into vendor/models/ for fully offline embeddings.
 * Run: npm run prepare-model  (before npm run build for store builds)
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "vendor", "models", "Xenova", "all-MiniLM-L6-v2");

const HF_BASE =
  "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";

/** Paths relative to model root on Hugging Face */
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

async function downloadFile(relPath) {
  const url = `${HF_BASE}/${relPath}`;
  const dest = path.join(OUT_DIR, relPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  const kb = Math.round(buf.length / 1024);
  console.info(`[Cortex] OK ${relPath} (${kb} KiB)`);
}

async function main() {
  console.info("[Cortex] Downloading embedding model to vendor/models/ …");
  for (const f of FILES) {
    await downloadFile(f);
  }
  console.info("[Cortex] Done. Run npm run build to copy into dist/models/");
}

main().catch((e) => {
  console.error("[Cortex]", e);
  process.exit(1);
});
