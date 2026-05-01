# Cortex — local second brain (Chrome extension)

Cortex extracts **readable page text** (Mozilla **Readability**), **chunks** it for retrieval (not one blob per page), stores rows in **IndexedDB** (Dexie), and embeds chunks locally with **Transformers.js** (`Xenova/all-MiniLM-L6-v2`). Search blends **semantic similarity**, **keyword/title** signals, **recency**, and a simple **importance** score from visits — without sending data to a backend (there is none).

Indexing aims at **meaningful text the user encounters**, with pause/blocklist controls — not “record everything forever.”

## Build

```bash
cd cortex
npm install
npm run build
npm run test
```

### CI

Workflow **`.github/workflows/ci.yml`** runs `npm ci`, typecheck, tests (including eval), and production build with **`working-directory: cortex`**. If your Git repo root **is** the extension directory only, remove that `working-directory` block and fix `cache-dependency-path`.

Load **`cortex/dist`** via **chrome://extensions → Developer mode → Load unpacked**.

### Toolbar icons

1. Put your square brand PNG at **`cortex/icons/cortex-brand.png`** (the halftone mark).
2. Run **`npm run icons`** — this uses Sharp to write **`icons/icon-16.png`**, **`icon-48.png`**, **`icon-128.png`**.
3. **`manifest.json`** already points **`action.default_icon`** and **`icons`** at those paths (copied to **`dist/icons`** on build).

First semantic indexing downloads ONNX/model weights (~22 MB + wasm/caches) from Hugging Face / jsDelivr — **`manifest.json` includes those hosts** unless you bundle weights under **`vendor/models/`** (see **`vendor/models/README.md`**).

## Usage

- **Browse normally** — after idle time per navigation, readable text is chunked and queued for embeddings (service worker + offscreen document).
- **Cmd + Shift + K** (Mac) / **Ctrl + Shift + K** (Windows/Linux), or **Alt + Shift + C** as an alternate — toggles the in-page overlay. If nothing fires, fix bindings under **`chrome://extensions/shortcuts`**. The extension also **injects `content.js`** the first time you use the shortcut on a tab that never ran Cortex (e.g. opened before install); internal Chrome URLs (`chrome://`, PDF viewer, etc.) cannot be scripted.
- **Ask in plain language** — e.g. `who works at Afterquery`, `works in Afterquery yesterday`, or `"Afterquery"` with **yesterday / today / last week**. Parsing boosts company-like phrases, optionally prefers LinkedIn profiles, and can **filter by visit-log time**. Results are **snippets from your index with sources** (extractive recall), not cloud ChatGPT.
Popup shows **documents**, **chunks**, **visit log size**, **recent visits**, and **privacy** toggles (pause indexing, domain blocklist).

## Privacy / limits

- No screenshots, no keylogging — **extracted text only** (same class of data as Readability).
- **Incognito tabs are not indexed** by default (guard in the service worker).
- Heuristic **sensitive-site skip** (banking/health/gov patterns, etc.) reduces accidental capture; refine with the blocklist.
- Heavy ML runs in an **offscreen document** (`offscreen.js` ~750 KB minified); the service worker stays smaller.

### SPA sites (LinkedIn, etc.)

Cortex intercepts **`pushState` / `replaceState` / `popstate`**, debounces **`MutationObserver`** updates, and schedules **retries** so dynamic pages can be captured after content loads.

### Pipeline (MVP)

Content script → extract → **chunk** → background queues embeddings → **IndexedDB** (`documents` + `chunks`) → hybrid search → overlay.

## Deleted GhostWriter

The previous **`ghostwriter`** folder could not be removed automatically because Windows reported it “in use”. Close anything locking it (Chrome holding unpacked extension, terminals, editors), then delete **`ghostwriter`** manually if it still exists — **`cortex`** is the replacement project under **`project/cortex`**.
