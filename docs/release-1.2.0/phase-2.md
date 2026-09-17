# Phase 2: UI and chat fixes

One commit per item on `release/1.2.0`. Every behaviour change was written test first (vitest, jsdom where DOM is involved; Playwright for what needs a real browser).

| Item | Commit | Tests added |
|------|--------|-------------|
| 2.1 Responsive layout | `c5cd712` | `tests/layout-mode.test.ts` (5), `tests/layout-observer.test.ts` (5), `tests/chat-drawer.test.ts` (4) |
| 2.2 Stable panel | `7d342da` | `e2e/panel.spec.ts` (2, CDP pierces the closed shadow root) |
| 2.3 Chat stream controller | `8c4001c` | `tests/chat-stream-controller.test.ts` (9), `tests/chat-run-registry.test.ts` (4), `tests/chat-engine-abort.test.ts` (1), gemini abort (1), router abort (1) |
| 2.4 Streaming render | `97f5108` | `tests/stream-renderer.test.ts` (5) |
| 2.5 Focus | `6107ca4` | `tests/focus-trap.test.ts` (12), `e2e/focus.spec.ts` (1) |
| 2.6 Dark mode | `c19da9f` | `tests/theme.test.ts` (22, includes 16 contrast pairs) |
| 2.7 Chat history | `be6907f` | `tests/chat-history.test.ts` (10) |
| 2.8 Empty state | `1a7dece` | `tests/example-prompts.test.ts` (3) |
| 2.9 Polish | `c566ad5` | `tests/manifest.test.ts` (+3), `tests/copy-guard.test.ts` (1) |

## What changed

- **Layout**: `src/content/layout-mode.ts` decides wide (880+), medium (560 to 879), narrow (under 560) from the panel width through a ResizeObserver and writes `data-layout`. Wide keeps a 240px sidebar; medium shows a "Chats" bar with `aria-expanded` that opens a drawer under it (click on the thread closes it); narrow stacks one column with the collapsible "Chats" header first and stacked source rows.
- **Panel**: `width: min(960px, calc(100vw - 32px))`, `height: min(760px, calc(100dvh - 48px))`, `box-sizing: border-box`, centered with `translate(-50%, -50%)`. The per-tab widths (720/920/760) are gone.
- **Chat stream**: `src/content/chat-stream-controller.ts` owns `idle | streaming | done | error | aborted`. A second submit while streaming returns false. The inactivity timer is 45s and re-arms on each token. `abort()` sends `CORTEX_CHAT_ABORT { requestId }`; the service worker forwards it on the bus; the offscreen document keeps an `AbortController` per `tabId:requestId` (`src/lib/chat/chat-run-registry.ts`), `runChat` stops and yields `aborted` without storing a partial answer, `streamAnswer` destroys the Nano session, and `geminiStream` passes the signal to `fetch` and cancels the reader. Every event now carries `requestId`; late or foreign events are dropped. Send turns into Stop while streaming.
- **Streaming render**: `src/content/stream-renderer.ts` buffers tokens and flushes once per animation frame into one text node before the cursor (first flush inserts a filled node, later flushes `appendData`: one mutation each). `finish()` swaps in the citation-rich node synchronously, so there is no empty frame at `done`.
- **Focus**: `src/content/focus-trap.ts`. One focus after the open transition (`transitionend` or a 260ms fallback, exactly once). Tab and Shift+Tab wrap inside the panel using the ShadowRoot's own `activeElement` (closed shadow roots hide it from `document`). Escape closes. Focus that escapes is pulled back. On close, focus returns to the element that had it. The four stacked `setTimeout` focus retries and the document-level focusin stealer are gone.
- **Dark mode**: `src/shared/theme.ts` holds both palettes and emits `:host` / `:host([data-theme="dark"])` custom properties; 63 hardcoded colours in the overlay CSS were replaced by tokens. Setting `theme` (light, dark, system) lives in user settings and in Options, Appearance. Contrast table in `docs/UI_DECISIONS.md`.
- **Chat history**: grouped Today / Yesterday / Last 7 days / Last 30 days / Older, filter input, full title in `title`, delete button visible on hover or focus-within, delete hides the row and commits after 5s with an Undo toast (`role="status"`), arrow keys, Home, End, Delete move and act inside the list (roving tabindex).
- **Empty state**: three chips from `CORTEX_RECENT_VISITS` (most recent title, most visited host, time based), generic fallback on an empty library. Clicking a chip submits it.
- **Polish**: author credit removed from overlay, popup and onboarding; Options has an About section with the version read from the manifest. Manifest name `Cortex: Private Memory for Everything You Read` (46 chars) and description (104 chars). `tests/copy-guard.test.ts` fails on any em dash in UI source. README rewritten.

## Gate

```
$ npx vitest run
 Test Files  38 passed (38)
      Tests  174 passed (174)

$ npx playwright test
  ok 1 e2e\embedding.spec.ts  indexes a page and stores 384-d embeddings without any external fetch
  ok 2 e2e\focus.spec.ts      Escape closes the overlay and focus returns to the previous element
  ok 3 e2e\overlay.spec.ts    content.js carries no overlay UI; toolbar click injects overlay.js and opens the panel
  ok 4 e2e\panel.spec.ts      panel keeps one size across Search, Ask and Digest and is vertically centered
  ok 5 e2e\panel.spec.ts      small viewport: panel fills width minus 32px and height minus 48px
  5 passed (12.1s)

$ npm run check:budget
Bundle budget check passed
```

### Screenshots (`docs/release-1.2.0/qa/`)

Captured by `CORTEX_QA=1 npx playwright test e2e/qa` (Playwright Chromium, unpacked `dist/`, page routed locally and indexed by the content script first):

| File pattern | What it shows |
|--------------|---------------|
| `{light,dark}-{360,600,1280}-search.png` | Search tab, empty query |
| `{light,dark}-{360,600,1280}-search-results.png` | Query "local memory" with one hit and a confidence badge |
| `{light,dark}-{360,600,1280}-ask.png` | Ask tab empty state with three chips |
| `{light,dark}-{360,600}-ask-drawer.png` | Medium drawer open under the Chats bar; narrow expanded Chats header |
| `{light,dark}-{360,600,1280}-digest.png` | Digest tab |
| `{light,dark}-zoom200-{search,ask}.png` | 200% zoom equivalent (640x450 CSS px viewport) |
| `{light,dark}-keyboard-focus-ring.png` | Keyboard only: Shift+Tab twice from the search input, focus ring on the Ask tab |
| `{light,dark}-keyboard-tabbed.png` | Keyboard only after six Tabs; Escape then closes and returns focus (asserted) |

Issues found by looking at the captures and fixed before the gate: the narrow list rendered above its toggle (toggle moved to the top of the layout); the medium drawer covered its own toggle (drawer now opens at `top: 45px` under a full-width bar; the wrapped-row attempt stretched the bar to 137px because `align-content: stretch` shares free height between flex lines, so medium is a column layout like narrow); the 200% zoom capture initially ran at the default viewport because Playwright reapplies its device metrics on navigation (the CDP override now runs after `goto`).

Flake note: the synthetic toolbar dispatch (`chrome.action.onClicked.dispatch`) occasionally raced tab activation on a cold profile (2 of about 10 full runs). `openOverlayViaToolbar` now retries the dispatch up to three times with a 5s wait each, and `playwright.config.ts` allows one retry in CI only.
