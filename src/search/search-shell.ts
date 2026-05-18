/**
 * Full Cortex Search / Ask / Digest UI for pages that cannot run content scripts
 * (chrome://, edge://, etc.). Opened via the side panel (or tab fallback).
 */
import { mountOverlay, openCortexOverlay } from "../content/overlay";

function bootSearchShell(): void {
  try {
    document.documentElement.classList.add("cortex-search-shell");
    mountOverlay({ shell: true });
    openCortexOverlay();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    document.body.innerHTML = `<pre style="margin:16px;font:13px/1.5 system-ui,sans-serif;color:#1c1917">Cortex could not load.\n${msg}</pre>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSearchShell, { once: true });
} else {
  bootSearchShell();
}
