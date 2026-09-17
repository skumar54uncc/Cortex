# Cortex: Private Memory for Everything You Read

Cortex is a Chrome extension (Manifest V3) that remembers what you read and lets you search it and ask questions about it. Everything runs on your device: page text is extracted with Mozilla Readability, chunked, embedded with a bundled MiniLM model through Transformers.js and stored in IndexedDB. There is no backend, no analytics and no telemetry.

- **Search**: hybrid retrieval (semantic, keyword, title, recency, engagement) with confidence badges.
- **Ask**: answers grounded in your library with citations, on device through Chrome built-in AI, or optionally through Gemini with your own API key (only the retrieved snippets are sent).
- **Digest**: a narrative of what you read today, yesterday or over the last 7 days.

## Install from source

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select the `dist` folder.

The embedding model (`vendor/models/Xenova/all-MiniLM-L6-v2`, about 22 MB) and the ONNX Runtime WASM binary are part of the package. Nothing is downloaded at runtime. If the model folder is missing, run `npm run prepare-model` once before building.

## Using Cortex

- Browse normally. Readable pages are indexed after a short idle delay. Incognito tabs, blocklisted domains and sensitive sites (banking, health, government patterns) are skipped.
- Open Cortex with the toolbar icon, `Ctrl+Shift+K` (`Cmd+Shift+K` on macOS) or `Alt+Shift+C`. On pages where extensions cannot inject scripts (`chrome://` and similar) Cortex opens in the side panel.
- Ask questions in plain language, for example "what did I read about Kubernetes yesterday". Time phrases filter by visit date.
- Settings (gear icon or `chrome://extensions`): pause indexing, blocklist, chat mode, Gemini key, theme (light, dark, system), history import, delete all data.

## Development

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest unit tests + eval tests
npm run build          # production bundle into dist/
npm run check:budget   # bundle size budgets (content.js under 45 KB)
npm run eval           # retrieval quality against eval/corpus
npm run e2e            # Playwright with the unpacked extension (build first)
npm run sbom           # CycloneDX SBOM of shipped dependencies
```

CI (`.github/workflows/ci.yml`) runs the audit gate (`npm audit --omit=dev --audit-level=high`), typecheck, unit and eval tests, build, bundle budget, SBOM, Playwright e2e and the retrieval eval on every pull request.

### Toolbar icons

Put a square brand PNG at `icons/cortex-brand.png` and run `npm run icons` to regenerate `icons/icon-16.png`, `icon-48.png` and `icon-128.png`.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for runtimes (content script, service worker, offscreen document, side panel), the data model and the retrieval pipeline. Security and privacy notes live in [SECURITY.md](SECURITY.md), [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) and [docs/INNERHTML_AUDIT.md](docs/INNERHTML_AUDIT.md). Release 1.2.0 work is documented under `docs/release-1.2.0/`.

## Privacy

- Extracted text only. No screenshots, no keylogging.
- Incognito tabs are never indexed.
- Cloud chat is off by default. When enabled, only the retrieved snippets for a question are sent to Gemini with your key.
- All data can be deleted from Settings.
