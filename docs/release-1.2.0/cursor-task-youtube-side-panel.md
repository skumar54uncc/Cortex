# Task for Cursor: double Shift on YouTube must open a side panel, not the centred window

Paste this whole file as the task. Everything needed to start is here.

## 1. The product

Cortex is a Chrome MV3 extension (TypeScript, webpack, Dexie/IndexedDB, Transformers.js
with bundled ONNX WASM). It indexes pages the user reads and answers questions about them
entirely on the device. Repo root `D:\Cortex`, branch `release/1.2.0`, Windows, Git Bash
and PowerShell both available.

Non negotiable values. Breaking any of these fails the task:

1. Indexing, embeddings, search and every new feature run on the device. No backend, no
   analytics, no telemetry, no third party calls. (A favicon fetch from Google was removed
   for exactly this reason; do not reintroduce anything like it.)
2. Gemini stays opt in and receives only retrieved text snippets, never images, PDFs or
   whole pages.
3. Incognito, pause, blocklist and sensitive domain skips apply to every capture path.
4. A new manifest permission needs a written justification in
   `docs/release-1.2.0/PERMISSIONS.md`. Prefer permissions with no install warning. This
   task should need no new permission.
5. Page derived text reaches the DOM only through `textContent` or the `esc()` helper. Any
   new HTML sink goes in `docs/INNERHTML_AUDIT.md`.
6. User data survives upgrade. One Dexie migration for this release, already written.
7. No em dashes in user facing copy. `tests/copy-guard.test.ts` scans `src/` and fails the
   build on U+2014, including inside regex literals, so use `\u2014` if you ever need one.

House rules: write the failing test first, then the code. Never say something works without
pasted command output. Comments explain why, not what.

## 2. What the owner asked for

> On YouTube, when I press double Shift, open the side panel instead of the centre window.

Today double Shift opens the in page overlay: a dialog centred over the page, inside a
closed shadow root. On YouTube the player owns the keyboard (k, j, l, f, t, c, "/" and
space are all controls) and pulls focus back after ads and chapter changes, so the centred
overlay is the wrong surface there.

## 3. What is already done (uncommitted in the working tree)

Two files are already changed for this task, and their unit tests pass:

- `src/lib/panel-mode.ts`: `"youtube.com"` added to `KEYBOARD_CAPTURING_HOSTS`, with a
  comment saying why, and the module docblock no longer claims YouTube keeps the overlay.
  This makes `choosePanelMode()` return `{ mode: "side-panel", reason:
  "keyboard-capturing-host" }` for `https://www.youtube.com/...` and any subdomain such as
  `music.youtube.com`, while `always-overlay` in the user preference still wins.
- `tests/panel-mode.test.ts`: the old "youtube keeps the overlay" row is replaced by four
  rows (watch page, music subdomain, the `youtube.com.example` near miss, and the user
  preference override). `npx vitest run tests/panel-mode.test.ts` gives 82 passed.

A new end to end spec exists and is the acceptance test to make green:

- `e2e/youtube-panel.spec.ts`
  - test 1, "double Shift on YouTube opens the side panel, not the window on the page":
    **currently failing**, see below.
  - test 2, "an ordinary page still opens the panel on the page": passing. Do not regress it.

The working tree also holds a larger, finished and verified round of work (People list
scrolling, skip link stripping, Prompt API `expectedOutputs`, the Summarizer global, local
site badges instead of Google favicons, a digest that still lists pages when no model is
available, a console and network sweep spec). All of it is green. Commit it first so this
task starts from a clean tree, and keep this change in its own commit.

## 4. The blocker, already proven

`chrome.sidePanel.open()` only works inside a user gesture, and a keydown handled by a
content script does not carry a gesture into the service worker. Proof, from a real browser
through the Playwright harness:

```
PROBE {
  "tabUrl": "http://cortex-e2e.test/probe",
  "open": "Error: `sidePanel.open()` may only be called in response to a user gesture.",
  "options": "{\"enabled\":true,\"path\":\"search-shell.html\"}"
}
```

The path today is: `src/content/double-shift.ts` recognises the gesture ->
`toggleCortexPanel()` in `src/content/main.ts` sends `CORTEX_POPUP_OPEN_SEARCH` ->
`src/background/service-worker.ts` (around line 2295) calls `openCortexSearchForTab()` in
`src/lib/open-cortex-search.ts` -> `choosePanelMode()` says `side-panel` ->
`openSearchSidePanelReliable()` in `src/lib/side-panel-launcher.ts` tries
`chrome.sidePanel.open()`, fails on the gesture rule, and falls back to
`chrome.windows.create({ type: "popup" })`.

So with only the panel-mode change in place, double Shift on YouTube opens a **popup
window**, which is still a window floating over the screen and is not what the owner asked
for. That is why `e2e/youtube-panel.spec.ts` test 1 fails on
`expect(await popupWindows(serviceWorker)).toBe(0)`.

Gestures that do work and already open the real Chrome side panel on YouTube now that
`panel-mode.ts` lists it: clicking the toolbar icon, and the `chrome.commands` shortcut
(Ctrl/Cmd+Shift+K). Only the double Shift gesture is affected.

## 5. What to build

Recommended design, in order of preference. Pick 1 unless you can prove 2 works.

**1. Dock the in page panel to the side on side panel hosts.**

When `choosePanelMode()` says `side-panel` but the surface cannot be opened without a
gesture, open the existing in page overlay in a new docked layout instead of the popup
window: full height, pinned to the right edge, roughly 420px wide, no backdrop dimming the
page, the page still scrollable and clickable next to it. Visually this is "a side panel",
it needs no Chrome API and no gesture, and typing inside it already works on YouTube
because `src/content/key-shield.ts` repairs cancelled keystrokes (YouTube only cancels
keys, it does not steal the caret, which is why it was never on the host list before).

Implementation notes:

- The CSS already has a docked variant for the real side panel document:
  `:host(.cortex-overlay-host--shell)` in `src/content/overlay.shadow.css`. Add a sibling
  variant, for example `:host(.cortex-overlay-host--docked)`, rather than editing the shell
  one, and keep the panel's internal layout untouched: the tabs, `.cortex-body` and the
  per tab scroll containers must keep working exactly as they do now. Note that
  `.cortex-body` children must keep `flex: 1; min-height: 0`, or lists stop scrolling.
- `src/lib/panel-mode.ts` stays the single source of truth. Add to the decision, do not
  fork the rules: for instance return the same `side-panel` mode plus a new field such as
  `fallback: "docked-overlay"`, or add a pure helper `panelSurfaceForGesture(decision,
  hasUserGesture)`. Keep the module pure: no `chrome.*`, no DOM, so it stays unit testable.
- Plumb it through `openCortexSearchForTab()` in `src/lib/open-cortex-search.ts`. That
  function already takes the tab and the user preference; give it the caller's gesture
  situation, for example `options.userGesture: boolean`, set to `false` for the
  `CORTEX_POPUP_OPEN_SEARCH` message when `sender.tab` exists (the double Shift path) and
  `true` for the toolbar and command paths in the same service worker file.
- The message that opens the overlay on a tab is `openSearchOnTab(tabId)`; it needs to
  carry the docked flag to the content script, which passes it to `openCortexOverlay()` in
  `src/content/overlay.ts`, which sets the host class.
- Second double Shift must close the docked panel, exactly as it closes the centred one
  today. `src/content/double-shift.ts` decides "already open" by looking for
  `#cortex-overlay-root`, so this keeps working if you reuse the same host element.
- Escape must close it, focus must be trapped inside it while open (`focus-trap.ts`), and
  the axe gate must stay clean.

**2. Only if you can prove it: open the real Chrome side panel from double Shift.**

If you find that Chrome does propagate user activation for this path in the current
version, use it, keep `openSearchSidePanelReliable()` as is, and delete the fallback
branch. Prove it with a pasted test run showing `popupWindows === 0` and a
`search-shell.html` target present. Do not guess: the error string above was produced on
this machine today. A debug build (`CORTEX_DEBUG=1 npm run build`) keeps `devLog.warn`
output, which the service worker console then shows.

Do not add a new manifest permission, do not add `tabs.create`, and do not ask the user to
click anything extra.

## 6. Acceptance criteria

- On `https://www.youtube.com/watch?v=...`, double Shift opens a side docked Cortex panel,
  and no popup window is created.
- A second double Shift closes it. Escape closes it. The page underneath stays usable.
- Typing in the panel's search and Ask boxes works on YouTube, spaces included.
- On an ordinary page, double Shift still opens the centred overlay exactly as before.
- The toolbar icon and Ctrl/Cmd+Shift+K keep working on both.
- `always-overlay` in settings still forces the centred overlay on YouTube.

## 7. Tests to write (failing first, then the code)

Unit, with vitest:

- `tests/panel-mode.test.ts`: the four YouTube rows already added, plus whatever new pure
  helper you introduce (gesture true and false, every reason, the user preference override).
- If you add a docked flag to the overlay opener, cover it where the other content script
  units are covered (`tests/` has jsdom specs such as `people-view.test.ts` for patterns).

End to end, with Playwright against a real Chromium and the real extension:

- Make `e2e/youtube-panel.spec.ts` test 1 pass unchanged if you can. If your design changes
  what "opened" means (a docked overlay rather than a `search-shell.html` target), rewrite
  its assertions honestly: assert the host class or the measured geometry (the panel's
  bounding box hugs the right edge and spans the viewport height), and keep
  `popupWindows(serviceWorker) === 0`.
- Add a case for the second double Shift closing it, and one for Escape.
- Add a typing case on the YouTube fixture, in the style of `e2e/keys.spec.ts`, asserting
  the text including spaces lands in the panel's input.

Harness notes that save time:

- `e2e/fixtures.ts` builds a persistent context with the unpacked extension. The default
  build is `dist` (closed shadow root, what ships). `test.use({ extensionPath:
  EXTENSION_PATH_E2E_AUDIT })` switches to `dist-e2e`, an identical build with an open
  shadow root, which is the only way to read panel internals from `page.evaluate`.
- `e2e/shadow.ts` reaches the closed shadow root through CDP (`clickInShadow`,
  `queryInShadow`, `findInShadow`).
- `e2e/cdp.ts` reaches targets Playwright does not expose (the offscreen document, the side
  panel) and can record the extension's console and network.
- Real sites are never contacted: `context.route` serves fixtures for
  `https://www.youtube.com/**` and `http://cortex-e2e.test/**`.
- Never run a build while the E2E suite is running. Webpack swaps `dist/` underneath the
  browser and produces spurious failures.

## 8. Gates. Run all of these and paste the output before claiming anything

```bash
npm run typecheck
npx vitest run
npm run build
npm run build:e2e
npm run check:budget
npx playwright test
```

Expected as of the current tree: typecheck clean, 798 unit tests in 95 files, bundle budget
passes, 53 E2E passed and 3 skipped. Your change must leave those green, plus your new
cases. `content.js` has a 15KB budget and is injected into every page, so keep the double
Shift path small; `overlay.js` has 143KB and is where the panel lives.

Finally, note anything you could not verify, and do not upload anything to the Chrome Web
Store. Packaging and upload are the owner's step.
