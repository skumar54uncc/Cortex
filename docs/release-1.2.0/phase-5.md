# Phase 5: new features

Branch `release/1.2.0`. Plan: `docs/release-1.2.0/features-plan.md`. Every feature went test first (unit test red, implementation, green), then a gate: typecheck, all unit tests, build, bundle budget, the feature's E2E, and the retrieval eval where retrieval changed.

## Commits

| Step | Commit | What |
|------|--------|------|
| 0.1 | `b6e7d24` | The one Dexie bump for this release (v6): chunk `kind` and `locator`, stores `people`, `collections`, `collectionItems`, `highlights`. Kind-aware chunk replacement. Migration test from a 1.0.1 database. |
| 0.2 | `9ab178f` | Extraction on demand: `content.js` is lifecycle only (2.7 KB); `extract.js` is injected only after the service worker's privacy gate passes. |
| 0.3 | `505735f` | Feature toggles; kind intent boosts (1.25 only on intent words such as video, table, pdf, photo; highlights 1.15); hits carry kind and locator. |
| 5.1 | `16ae36f` | People and company memory from LinkedIn pages, People tab, "who did I view from X" answered from the people store. |
| 5.2 | `bf382ac` | Omnibox keyword `cx`, suggestions from the local library, escaped. |
| 5.3 | `9b8e147` | Highlights and notes through the context menu (gated, embedded, ranking boost). |
| 5.4 | `5440e6c` | Collections (options, overlay scope bar, context menu) with scoped Search and Ask. |
| 5.5 | `f74e37a` | "Seen this before" chip: off by default, threshold 0.82, once per page per day, closed shadow root. |
| 5.6 | `55c447a` | YouTube transcripts: page-world bridge, 30 s playback gate, caption tracks, 60 s windows with video locators. |
| 5.7 | `369aff5` | Tables as row chunks (header repeated, 12 rows each, layout tables skipped, caps). |
| 5.8 | `ef45439` | Images (text only by default) and optional on-device descriptions. |
| 5.9 | `2319dd6` | PDFs. |
| 5.10 | `59a4a1a` | Export and backup. |
| 5.11 | `11576c0`, `929c7ba` | Snippet labels by kind, per-kind citation cards and search hit links; E2E toolbar flake fixed. |

## 5.8 Images

- `src/lib/capture/images.ts`: main-content images (inside `article`, `main` or `[role=main]`, not in header, nav, footer or aside) of at least 100 px are indexed through their alt text, aria-label, title, figure caption and nearest heading, as one `image` chunk with `{ images: [{ src, alt }] }`. Decorative `alt=""`, `data:` sources and images with no text are skipped. Size is the smaller of rendered and natural size: the E2E found that a 40 px icon backed by a large file passed when only `naturalWidth` was used.
- Optional descriptions (`imageDescriptionsEnabled`, off by default; policy `imageDescriptionsAllowed: false` forces them off): `extract.js` reads pixels only from images the page already loaded, downscaled to 512 px; cross-origin images without CORS taint the canvas and are skipped (nothing is fetched). The service worker validates them (`sanitizeImageInputs`: JPEG or PNG data URL, listed in the page's own image chunk, size cap, at most 5) and the offscreen document asks the Prompt API with image input. Descriptions are appended to the local chunk and embedded again.
- Re-index passes: `content.js` asks to index a page up to five times per load (retries for late-painting pages). The first E2E run showed 4 model calls for one image. `reuseDescribedText` keeps stored descriptions when the image text is unchanged, one run per document at a time, and the update targets the document's current image chunk. The E2E now asserts exactly one model call.
- Core value 2: `streamAnswer` strips description lines at the Gemini boundary (`tests/cloud-strip-descriptions.test.ts`), and the E2E checks that the intercepted Gemini request body has no description, no image data and no base64.

## 5.9 PDFs

- `tabs.onUpdated` (status complete, http(s) URL ending in `.pdf`) runs `indexPdfTab`: toggle, then the full gate (managed policy, pause, incognito from the tab, always-skip, allowlist, blocklist, sensitive hosts), then "already indexed", one run per URL. Only then does the offscreen document fetch the same URL: `credentials: "omit"`, `redirect: "error"`, 30 MB cap (Content-Length and while streaming), `%PDF-` check.
- `pdfjs-dist` 6.3.289 (Apache-2.0), legacy build, loaded with a dynamic import as its own chunk `pdf.js` (494 KB) plus the bundled worker `pdf.worker.min.mjs` (1.2 MB). `offscreen.js` grew by 3 KB. pdfjs 6 contains no `eval` or `new Function`; a unit test checks the shipped files so an upgrade cannot add one silently. No font loading, verbosity errors only.
- Up to 300 pages and 200 chunks; each chunk has `{ page }`. Title from the PDF metadata, else the file name.
- Limitation: PDFs behind a login are not indexed, because no cookies are replayed.

## 5.10 Export and backup

- Settings > Data > Export and backup. "Export notes (Markdown)": store-only zip (`src/lib/export/zip.ts`, CRC-32, UTF-8 names, path checks) with `index.md`, one note per page (front matter, text, highlights as quotes, transcript lines linking to the moment, PDF pages, tables, images), one file per collection, `people.md`. Page HTML is neutralized (`<` escaped).
- "Download backup (JSON)": `{ format: "cortex-backup", version: 1, schemaVersion: 6, exportedAt, stores }` with every library store, no embeddings, no settings (the Gemini key cannot leak).
- Restore: file picker, validation in the service worker (every row rebuilt field by field, references must resolve inside the file, URLs http(s) only, sizes capped), a confirm step with counts, Merge (default) or Replace (destructive, styled and worded as such). Every restored URL passes the live privacy gate; blocked pages are counted. Refused while the policy disables indexing. Retention applies right after.
- Restored chunks come back `pending`. A storage flag plus a batch drain on service worker start re-embeds them even if the worker restarts. This also covers a gap: before, chunks left pending when the worker died mid-queue stayed pending.
- Only the options page may export or restore (`isOptionsPageSender`); the E2E checks that the popup is refused. No `downloads` permission: files are saved through a `blob:` link.
- UI follows `/ui-ux-pro-max`: progressive disclosure (confirm step appears only for a valid file), existing radio cards and tokens, focus moves to the summary and back to the picker on cancel, buttons disabled while working, status lines with `role="status"`. axe passes on options.html.

## 5.11 Answers and citations

- The answer prompt labels snippets: `[2] (video 12:40 to 13:40)`, `(table: Prices, rows 13 to 24)`, `(PDF page 4)`, `(image)`, `(highlight)`; the source URL is the moment or page link. Plain page text is unchanged.
- Citation cards and inline `[N]` links open the video at its moment and the PDF at its page and show a detail line ("Video at 12:40", "PDF page 4", "Table rows 13 to 24"). Search hit rows link the same way. Kind and locator are stored with cited chunks so reopened chats keep the links. DOM APIs and `textContent` only (`src/content/citation-cards.ts`).

## Also fixed in this phase

- `src/search/search-shell.ts` rendered a load error with `innerHTML` and the raw error message (present since 1.0.x). Now `textContent`, with a test.
- E2E flake "overlay did not open after 3 toolbar dispatches" (about 1 in 5 runs in isolation). Root cause, found by instrumenting the helper: the dispatch went to the "active" tab, which on a fresh profile can still be the onboarding tab (an extension page, whose URL reads as empty), so the click never reached the test page. The helper now dispatches to the test page's own tab. Before: 1 failure in 5 runs; after: 60 of 60 runs of the two affected specs passed.
- Tool note: some shell heredocs turned `\\` escapes into control characters in generated files. A scan of all source, test, style and doc files now finds no control characters.

## Gates (final Phase 5 state)

Typecheck: `npx tsc --noEmit -p .` printed nothing (no errors).

Unit tests: `Test Files 74 passed (74)`, `Tests 404 passed (404)` (Phase 4 ended at 341 tests in 61 files).

E2E, `npx playwright test`, production build (axe spec uses `dist-e2e`): `41 passed (4.3m)`.

```
a11y: overlay light, overlay dark, narrow overlay, options.html, popup.html, onboarding.html, search-shell.html
backup: export notes and backup, wipe, restore from the file: the page is back and searchable
backup: restore refuses a file that is not a Cortex backup and changes nothing
collections: create a collection, add a page from the context menu, scope search to it
embedding: indexes a page and stores 384-d embeddings without any external fetch
extraction: blocklisted page: no extractor injected, nothing stored; allowed page: extracted and stored
flows: closed shadow root; search; ask on device; ask cloud (snippets only); side panel on newtab; managed policy; forget this site
focus: Escape closes the overlay and focus returns
highlights: save with a note, embedded and found; cancel saves nothing; sensitive sites refused
images: text indexed as one image chunk, image intent ranks it first; descriptions on device only, stripped before Gemini; images off
omnibox: suggests indexed pages and opens the best hit
overlay: content.js carries no overlay UI; toolbar click injects overlay.js
panel: one size across tabs; small viewport
pdf: fetched once without cookies, read page by page, found with its page; off or paused never fetches; citation opens the cited page
people: LinkedIn profile recorded, People tab, Ask answers; people memory off
rechunk: legacy document upgraded
resurface: off by default; on shows one chip once per day
tables: row chunks, article text leaves them out, table intent ranks first; tables off
youtube: transcript windows after 30 s of playback; transcripts off never injects the bridge
```

Bundle budget (`node scripts/check-bundle-budget.mjs`):

```
ok      content.js               2705 /    15360 bytes
ok      extract.js              51103 /    61440 bytes
ok      resurface-chip.js        2501 /     8192 bytes
ok      youtube-bridge.js        1031 /     4096 bytes
ok      overlay.js              94261 /   143360 bytes
ok      service-worker.js      218818 /   225280 bytes
ok      offscreen.js           639625 /   716800 bytes
ok      pdf.js                 494185 /   573440 bytes
ok      pdf.worker.min.mjs    1245523 /  1433600 bytes
ok      search-shell.js         94586 /   143360 bytes
ok      options.js              23492 /    40960 bytes
ok      popup.js                 6950 /    20480 bytes
ok      onboarding.js            1503 /    10240 bytes
Bundle budget check passed
```

`service-worker.js` has 6.3 KB of headroom left (backup validation, vault and zip added about 17 KB). Moving export to the offscreen document is the next step if the worker grows again.

Retrieval eval (full output in `eval-phase5-final.txt`). No slice regressed, so the 2 point rule holds:

```
nDCG@10 (overall)            0.9161 -> 0.9161 (+0.0000, +0.0%) [ok]
Recall@10 (overall)          0.9741 -> 0.9741 (+0.0000, +0.0%) [ok]
MRR@10 (overall)             0.9074 -> 0.9074 (+0.0000, +0.0%) [ok]
p95 latency ms               94.6878 -> 105.1184 (+10.4306, +11.0%) [ok]
nDCG@10 (factual)            0.9963 -> 0.9963 [ok]
nDCG@10 (navigational)       0.9362 -> 0.9362 [ok]
nDCG@10 (exploratory)        0.6475 -> 0.6475 [ok]
nDCG@10 (negative)           0.8438 -> 0.8438 [ok]
```

`npm audit --omit=dev --audit-level=high` (the CI gate): `found 0 vulnerabilities`. The full audit lists advisories in dev dependencies (undici, vite); they were not introduced by this phase and are handled in Phase 6.

## Not done or not verified in Phase 5

- The real Chrome Prompt API image input was not exercised: E2E stubs `LanguageModel` in the offscreen document. The option names follow the current Prompt API (`expectedInputs` with `image`, content parts with a `Blob`); if Chrome's shape differs, `available()` fails closed and no descriptions are made.
- The real Chrome PDF viewer was used in the E2E (headless Chromium, `chrome.tabs.create` on a routed PDF), but not on a real remote PDF.
- There is no managed policy to disable export. Raised as an open question.
