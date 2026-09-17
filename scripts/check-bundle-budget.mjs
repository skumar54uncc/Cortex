#!/usr/bin/env node
/** Fails when a shipped bundle exceeds its byte budget. Run after `npm run build`. */
import { statSync } from "node:fs";
import { join } from "node:path";

const KB = 1024;
/** Budgets in bytes. content.js is injected into every http(s) page. */
export const BUNDLE_BUDGETS = {
  "content.js": 45 * KB,
  "overlay.js": 140 * KB,
  "service-worker.js": 220 * KB,
  "offscreen.js": 700 * KB,
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
if (failed) {
  console.error("Bundle budget check FAILED");
  process.exit(1);
}
console.log("Bundle budget check passed");
