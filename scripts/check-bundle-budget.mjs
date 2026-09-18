#!/usr/bin/env node
/** Fails when a shipped bundle exceeds its byte budget. Run after `npm run build`. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
/** Budgets in bytes. content.js is injected into every http(s) page. */
export const BUNDLE_BUDGETS = {
  // content.js: lifecycle + messaging only since Phase 5 task 0.2 (was 45 KB).
  "content.js": 15 * KB,
  "extract.js": 60 * KB,
  "resurface-chip.js": 8 * KB,
  "youtube-bridge.js": 4 * KB,
  "overlay.js": 140 * KB,
  "service-worker.js": 220 * KB,
  "offscreen.js": 700 * KB,
  // pdfjs-dist (Phase 5.9): lazy chunk and worker, loaded only when a PDF is read.
  "pdf.js": 560 * KB,
  "pdf.worker.min.mjs": 1400 * KB,
  "search-shell.js": 140 * KB,
  "options.js": 40 * KB,
  "popup.js": 20 * KB,
  "onboarding.js": 10 * KB,
};

const dist = join(process.cwd(), "dist");
let failed = false;
for (const [file, budget] of Object.entries(BUNDLE_BUDGETS)) {
  let size = -1;
  try {
    size = statSync(join(dist, file)).size;
  } catch {
    /* missing */
  }
  const ok = size >= 0 && size <= budget;
  if (!ok) failed = true;
  const status = size < 0 ? "MISSING" : ok ? "ok" : "OVER";
  console.log(
    `${status.padEnd(7)} ${file.padEnd(20)} ${String(size).padStart(8)} / ${String(budget).padStart(8)} bytes`
  );
}
// The ONNX Runtime binary must ship exactly once, under wasm/ (Phase 6).
const strayWasm = readdirSync(dist).filter((f) => f.endsWith(".wasm"));
if (strayWasm.length) {
  failed = true;
  console.error(`FAIL    duplicate .wasm at the package root: ${strayWasm.join(", ")}`);
}
if (failed) {
  console.error("Bundle budget check FAILED");
  process.exit(1);
}
console.log("Bundle budget check passed");
