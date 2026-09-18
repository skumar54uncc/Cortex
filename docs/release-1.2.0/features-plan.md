# Cortex 1.2.0 Phase 5: New Features Implementation Plan

> **For agentic workers:** executed inline in this session (see "Execution" at the end). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ten on-device capture and recall features (people memory, omnibox, highlights, collections, resurfacing, YouTube transcripts, tables, images, PDFs, export/backup) on top of one Dexie schema bump, without breaking the privacy gates, the managed policy, the bundle budgets, or the Phase 3 retrieval quality.

**Architecture:** One shared foundation first (schema v6 with chunk kinds and locators, kind-aware chunk replacement, an on-demand extraction script, settings toggles, kind boosts in search), then each feature as a thin module that plugs into that foundation. Every capture path goes through the service worker's single indexing gate (`shouldSkipIndexing`), which already applies pause, incognito, blocklist, allowlist, sensitive domains and managed policy.

**Tech Stack:** TypeScript, Chrome MV3 (service worker, offscreen document, `chrome.scripting`, `chrome.omnibox`, `chrome.contextMenus`), Dexie 4 on IndexedDB, Transformers.js (MiniLM), Chrome Prompt API, `pdfjs-dist`, Vitest (+ jsdom, fake-indexeddb), Playwright.

---

## Constraints carried in from Phases 1 to 4

| Constraint | Consequence for Phase 5 |
|------------|-------------------------|
| `content.js` budget 45 KB, currently 44.6 KB | No new code can go into `content.js`. Extraction moves out (Task 0.2). |
| `offscreen.js` budget 700 KB, currently 629 KB | `pdfjs-dist` must be a lazily loaded chunk with its own budget line. |
| Core value 1: no third party calls | PDFs are fetched from their own URL (the tab the user opened); captions from youtube.com (same origin as the page); nothing else. |
| Core value 2: Gemini gets snippets only | Image descriptions never leave the device; PDFs and images are never sent to Gemini (context builder sends text only; existing E2E asserts no `inlineData` / `fileData`). |
| Core value 3: gates apply to every capture path | Each new path calls the SW gate before storing, and extraction is not even injected when the gate says skip. |
| Core value 4: permissions | Adds `contextMenus` (no install warning) and the `omnibox` manifest key (no permission). Recorded in `PERMISSIONS.md`. |
| Core value 5: DOM sinks | New UI (people tab, citation cards, chip, collection picker) uses DOM APIs only; `INNERHTML_AUDIT.md` updated. |
| Core value 6: one migration | Schema v6 is the only bump in 1.2.0, tested with a v5 fixture database. |
| `HANDLED_TABLES` guard (Phase 4) | New stores must be added to retention and forget, or `tests/data-controls.test.ts` fails. |
| Eval gate | No slice may drop more than 2 nDCG points from the Phase 3 baseline (`eval/results/baseline.json`). |

## Decisions

1. **Extraction becomes an on-demand script (`extract.js`).** `content.js` keeps page lifecycle (SPA hooks, visibility, retries) and messaging only. When it wants to index, it sends `CORTEX_INDEX_REQUEST { url }`. The service worker runs the gate and, only if allowed, injects `extract.js` once per document and then messages it. Blocked, paused, sensitive and incognito pages never run Readability. `content.js` drops from 44.6 KB to roughly 8 KB, which is the headroom Phase 5 needs.
2. **Chunk kinds are read-time defaults, not a data rewrite.** Schema v6 adds stores and a `kind` index on chunks. Old chunks keep no `kind` field; `chunkKind(c)` returns `c.kind ?? "text"`. The upgrade function does not rewrite every chunk (a mass rewrite of embeddings is the riskiest thing a migration can do on a large library). The migration test proves old rows open, counts are unchanged, and they read as `text`.
3. **Kind-aware chunk replacement.** `replaceChunksForDocument(docId, chunks, { kinds })` deletes only the kinds being rewritten. Re-indexing a page rewrites `text`, `table` and `image` chunks and keeps `transcript` and `highlight` chunks.
4. **Kind boosts only on intent words.** `detectKindIntent(query)` maps words (video, watched, table, chart, image, photo, pdf, highlight, person) to kinds; matching chunks get a multiplicative boost. Queries without intent words rank exactly as in Phase 3, which protects the eval.
5. **People memory is a separate store, not chunks.** LinkedIn profile and company pages produce a `people` row. The Ask question parser detects "who did I view / who from X" and answers from `people` with time filters before falling back to RAG.
6. **Features stay inline and sequential.** They all touch the schema, the service worker, the overlay and the search engine, so they are not independent enough for parallel agents.

## File map

| File | Responsibility | New / modified |
|------|----------------|----------------|
| `src/db/schema.ts` | v6 stores, `ChunkKind`, `locator`, `chunkKind()`, kind-aware `replaceChunksForDocument` | modified |
| `src/lib/data-controls.ts` | retention and forget for `people`, `collections`, `collectionItems`, `highlights` | modified |
| `src/shared/extension-settings.ts` | feature toggles | modified |
| `src/shared/managed-policy.ts` | `imageDescriptionsAllowed` already mapped; nothing else new | unchanged |
| `src/content/main.ts` | lifecycle + `CORTEX_INDEX_REQUEST` only | modified |
| `src/content/extract-entry.ts` | injected extraction: text, tables, images, LinkedIn people, YouTube DOM fallback | new (`extract.js`) |
| `src/lib/capture/tables.ts` | `extractTables(doc)`, layout table filter, 12-row chunks with repeated headers, caps | new |
| `src/lib/capture/images.ts` | main-content images 100px+, alt / figcaption / title / aria-label / heading | new |
| `src/lib/capture/linkedin.ts` | profile and company parsing | new |
| `src/lib/capture/youtube.ts` | player response parsing, track choice, json3 to windows, DOM fallback, metadata text | new |
| `src/content/youtube-bridge.ts` | MAIN world reader, posts player response on `yt-navigate-finish` | new (`youtube-bridge.js`) |
| `src/lib/capture/pdf.ts` | PDF detection, size cap, page text to chunks with page locators | new |
| `src/lib/people.ts` | upsert, list, delete, "who" query answering | new |
| `src/lib/omnibox.ts` | suggestion formatting and XML escaping | new |
| `src/lib/highlights.ts` | save highlight + highlight chunk | new |
| `src/lib/collections.ts` | CRUD and scoped document ids | new |
| `src/lib/resurface.ts` | threshold, daily cap per page, skip rules | new |
| `src/lib/export/zip.ts` | minimal store-only ZIP writer (CRC32) | new |
| `src/lib/export/backup.ts` | Markdown vault export, JSON backup, validated restore | new |
| `src/lib/search-engine.ts` | kind boosts, collection scope, locators on hits | modified |
| `src/lib/chat/context-builder.ts` | snippet labels with kind and locator | modified |
| `src/content/citation-cards.ts` | per-kind citation card and link (video `&t=NNs`, PDF `#page=N`) | new |
| `src/content/overlay.ts` | People tab, collection picker, citation cards | modified |
| `src/content/resurface-chip.ts` | small dismissible chip (`resurface-chip.js`) | new |
| `src/background/service-worker.ts` | routes, omnibox, context menus, PDF tabs, YouTube injection | modified |
| `src/offscreen/offscreen.ts` | PDF text extraction (lazy chunk), image descriptions | modified |
| `src/options/*` | toggles, collections list, export / restore | modified |
| `manifest.json` | `contextMenus`, `omnibox` | modified |
| `scripts/check-bundle-budget.mjs` | `extract.js`, `youtube-bridge.js`, `resurface-chip.js`, pdf chunk | modified |

## Tasks

Each task: failing test, watch it fail, implement, pass, then `npm run typecheck && npx vitest run`, `npm run build && npm run check:budget`, relevant E2E, and `npm run eval` when retrieval code changed. One commit per task.

### Task 0.1: Schema v6 and chunk kinds

**Files:** `src/db/schema.ts`, `src/shared/cortex-constants.ts`, `src/lib/data-controls.ts`, `tests/schema-v6-migration.test.ts`, `tests/data-controls.test.ts`

- [ ] Test: open a v5 database built with raw IndexedDB (documents, chunks without `kind`, visits, conversations, messages, digest cache, legacy pages), then open it with `CortexDB`: counts unchanged, `chunkKind(chunk) === "text"` for every old chunk, new stores exist and are empty, `db.verno === 6`.
- [ ] Test: `replaceChunksForDocument(id, textChunks, { kinds: ["text","table","image"] })` keeps existing `transcript` and `highlight` chunks.
- [ ] Test: `HANDLED_TABLES` still equals `db.tables` (fails until retention and forget cover the four new stores).
- [ ] Implement v6: `chunks: "++id, documentId, ord, kind"`, `people: "++id, &profileUrl, lastSeen, company"`, `collections: "++id, &name, createdAt"`, `collectionItems: "++id, collectionId, documentId, [collectionId+documentId], addedAt"`, `highlights: "++id, documentId, url, createdAt"`. No upgrade rewrite.
- [ ] Retention: people by `lastSeen`, highlights by `createdAt`, collection items whose document is gone. Forget site: people whose `profileUrl` host matches, highlights by URL host. Forget window: people `lastSeen` and highlights `createdAt` in window. Forget all: everything.

### Task 0.2: Extraction on demand (`extract.js`)

**Files:** `src/content/main.ts`, `src/content/extract-entry.ts`, `src/lib/extract-injector.ts`, `src/background/service-worker.ts`, `webpack.config.js`, `scripts/check-bundle-budget.mjs`, `tests/extract-injector.test.ts`, `e2e/extraction.spec.ts`

- [ ] Test (unit): injector asks the gate first; skip means no `executeScript`; allowed means inject `extract.js` once, then message `CORTEX_EXTRACT_NOW`.
- [ ] Test (E2E): an allowed page is indexed; a blocklisted page never has `window.__cortexExtractLoaded` set (probe through CDP isolated world is not available, so assert through `chrome.scripting.executeScript` from the SW reading the flag in the content world).
- [ ] Implement; `content.js` budget lowered to 15 KB, `extract.js` budget 60 KB.

### Task 0.3: Settings toggles and kind boosts

**Files:** `src/shared/extension-settings.ts`, `src/lib/kind-intent.ts`, `src/lib/search-engine.ts`, `tests/kind-intent.test.ts`, `src/lib/search-engine.test.ts`

- [ ] Toggles (defaults): `peopleMemoryEnabled` true, `omniboxEnabled` true, `highlightsEnabled` true, `resurfacingEnabled` **false**, `youtubeTranscriptsEnabled` true, `tablesEnabled` true, `imagesEnabled` true, `imageDescriptionsEnabled` false (exists), `pdfEnabled` true.
- [ ] Test: `detectKindIntent("that video about tides")` returns `["transcript"]`; plain queries return `[]`; boosts leave scores unchanged without intent.
- [ ] Hits carry `kind` and `locator` of the best chunk.

### Task 1: People and company memory

- [ ] Fixture HTML for a profile and a company page under `tests/fixtures/linkedin/` (self-authored, fictional).
- [ ] `parseLinkedInProfile(doc, url)` / `parseLinkedInCompany(doc, url)` return `{ name, headline, company, profileUrl }` or null; profile URL canonicalized (`/in/<slug>/`).
- [ ] `upsertPerson`: first view sets `firstSeen`, repeat views bump `visitCount` and `lastSeen`.
- [ ] `parsePeopleQuery("who did I view from Atrium last week")` returns `{ company: "atrium", range }`; "who did I search" too; non-people questions return null.
- [ ] Ask answers from `people` (time-filtered list with profile links) before RAG; falls through to RAG when nothing matches.
- [ ] People tab in the overlay (list, search, delete per person, DOM APIs); toggle off hides the tab and stops capture.

### Task 2: Omnibox

- [ ] Manifest `"omnibox": { "keyword": "cx" }` (manifest test).
- [ ] `formatSuggestion(hit)` escapes `& < > " '` and wraps matches with `<match>`, URL in `<url>`, max 5 suggestions; test with hostile titles.
- [ ] SW: `onInputChanged` debounced search via offscreen; `onInputEntered` opens the chosen URL (http/https only via `safeHttpHttpsHref`) or the best hit for free text. Disabled toggle returns a single "Cortex omnibox is turned off" suggestion.

### Task 3: Highlights and notes

- [ ] `contextMenus` permission, "Save to Cortex" on `selection`; menu removed when toggle off.
- [ ] Gate check on the tab URL; incognito refused.
- [ ] Optional note via a small prompt injected into the tab.
- [ ] Stored in `highlights` and as a `highlight` chunk (embedded) with locator `{ quote, note }`; ranking boost 1.15 for highlight chunks; test that a highlight outranks the same text in a plain chunk.

### Task 4: Collections

- [ ] CRUD in `collections.ts` (unique names, trimmed, 60 chars max); add current page from the overlay; context menu "Add page to collection" with one child per collection.
- [ ] `runAdvancedSearch(q, embed, { collectionId })` only returns documents in that collection; Ask passes it through. Tests with three docs in two collections.
- [ ] Overlay picker (All pages / each collection) in Search and Ask; options page lists and deletes collections.

### Task 5: "Seen this before"

- [ ] `shouldResurface({ similarity, url, host, lastShown, now, enabled, sensitive })`: off by default, threshold 0.82 cosine, never the same URL, never on sensitive or blocked hosts, max once per page per day. Tests for each rule.
- [ ] After a page is indexed and embedded, the SW asks offscreen for the most similar other document; if allowed, injects `resurface-chip.js` with the title and URL (DOM APIs, dismiss button, auto-hide 12s, closed shadow root).

### Task 6: YouTube transcripts

- [ ] Fixture player responses (manual + auto tracks, no tracks) and a json3 caption fixture under `tests/fixtures/youtube/`.
- [ ] `pickCaptionTrack` prefers manual over ASR, then the page language, then English; `json3ToWindows(events, 60)` builds ~60 s windows with `{ startSec, endSec }`; `videoIdFromUrl`.
- [ ] MAIN world bridge (injected by the SW only on youtube.com watch pages that pass the gate) posts `{ videoId, playerResponse }` on load and `yt-navigate-finish`; the isolated world verifies `videoId` matches the URL before trusting it.
- [ ] Index only after 30 s of actual playback (`timeupdate` accumulation, reset on navigation); fetch `&fmt=json3`; fallback to transcript panel DOM; else index title, channel, description and chapters.
- [ ] Chunks `kind: "transcript"`, locator `{ videoId, startSec, endSec }`; citation link `watch?v=ID&t=NNs`.

### Task 7: Tables

- [ ] Fixtures: a data table with `<th>` and caption, a layout table (single column / nested / role=presentation), a 40-row table.
- [ ] `isLayoutTable`, `extractTables(doc)`: caps 10 tables and 500 rows per page, chunks of 12 rows, each row as `Header: value; Header: value`, locator `{ tableIndex, rowStart, rowEnd, caption }`; tables removed from the Readability clone so text chunks do not repeat them.

### Task 8: Images

- [ ] `extractImages(doc)`: main content only (inside `article`/`main`, not nav/header/footer), rendered size 100px+ (uses `naturalWidth/Height` or width/height attributes in tests), text from alt, figcaption, title, aria-label and nearest preceding heading; skip empty and decorative (`alt=""`). One image chunk per page grouping up to 20 images.
- [ ] Optional descriptions: only when `imageDescriptionsEnabled` and policy allows and the Prompt API reports image input available; max 5 per page; runs in the offscreen document; result stored only locally. Test: description function never called when off (spy), never called when policy forbids, never passed to the Gemini path.

### Task 9: PDFs

- [ ] `isPdfUrl`, `pdfSizeAllowed(contentLength)` with 30 MB cap; `pagesToChunks(pages)` with locator `{ page }`; citation link `#page=N`.
- [ ] SW watches `tabs.onUpdated` complete for PDF URLs (content scripts cannot run in the viewer), runs the gate, asks offscreen to fetch and extract (`pdfjs-dist` legacy build, worker copied to `dist/pdf.worker.min.mjs`, `isEvalSupported: false`, lazy chunk).
- [ ] Fixture PDF (generated at test time with a tiny hand-written PDF writer, three pages of text) extracted in Node through `pdfjs-dist`.

### Task 10: Export and backup

- [ ] `zip.ts` store-only writer; test by reading the archive back with a minimal reader (local headers, central directory, CRC32 check).
- [ ] Markdown vault: one note per document (`title.md` with front matter: url, visited, kind counts; body with text chunks, highlights as quotes, transcript windows with timestamps), `index.md`, collections as folders of links.
- [ ] JSON backup: `{ format: "cortex-backup", version: 1, schemaVersion: 6, exportedAt, stores: {...} }` without embeddings (re-embedded after restore) and without the Gemini key.
- [ ] Restore: validates format, version and every row shape; reports counts; merges by URL; replaces only after explicit confirmation (options page confirm step). Round trip test: export, wipe, restore, same documents, chunks, chats, people, collections, highlights.

### Search, answers and citations (spans Tasks 0.3, 6, 7, 9)

- [ ] Context builder labels each snippet `[N] (video 12:40 to 13:40)`, `(table: caption, rows 13 to 24)`, `(PDF page 4)`, `(image)`, `(highlight)`.
- [ ] Citation cards per kind in the overlay, built with DOM APIs.
- [ ] Eval after each retrieval-affecting task; no slice drops more than 2 points from the Phase 3 baseline.

## Verification per task

```
npm run typecheck
npx vitest run
npm run build && npm run check:budget
npx playwright test
npm run eval            # when search, chunking or capture changed
```

## Execution

Inline, sequential, in this session. The plan reviewer subagent from the writing-plans skill is not used: the session runs without spawning agents unless the owner asks, and the brief only allows parallel agents for independent features, which these are not (shared schema, service worker, overlay, search engine). Full code is not duplicated in this plan; each task names its interfaces and tests, and the code lands in the task's commit.
