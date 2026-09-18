# Phase 4: Enterprise admin and data controls

Branch `release/1.2.0`, commits `afe05ad` (4.1 to 4.4) and the Phase 4.5 commit that adds this file.

## 4.1 Managed policy

- `managed_schema.json` at the package root, referenced by `manifest.json` `storage.managed_schema`. Keys: `geminiAllowed`, `blockedDomains`, `allowedDomainsOnly`, `retentionDays`, `indexingDisabled`, `imageDescriptionsAllowed`.
- `src/shared/managed-policy.ts`: `normalizeManagedPolicy` (drops wrong types), `applyManagedPolicy` (effective settings plus the list of locked fields), `getEffectiveSettings`, `getEffectiveChatSettings`.
- Every enforcement point now reads effective settings: the service worker indexing gate (policy `indexingDisabled` also blocks history import, which could previously bypass the user pause), chat and digest routing, the re-chunk job, the retention sweep, the content script's early exit, and the popup stats.
- Options page: banner, disabled controls with "Managed by your organization" notes, managed blocklist chips without remove buttons (`src/options/managed-ui.ts`). Saves pass through `stripLockedFields`, so managed values are never written into the user's own settings and the user's Gemini key survives a `geminiAllowed: false` policy.
- Admin documentation with a Google Admin JSON sample: `docs/ENTERPRISE.md`.

Tests: `tests/managed-policy.test.ts` (15, with a mocked `chrome.storage.managed`), `tests/options-managed-ui.test.ts` (7, real `options.html` in jsdom).

## 4.2 Retention

`applyRetention(days, now)` in `src/lib/data-controls.ts` deletes documents (with chunks), visits, conversations and legacy `pages` rows older than N days and clears the digest cache. A `cortex-retention` alarm runs it daily and shortly after browser start. User setting "Keep indexed pages for" (default Forever); locked when `retentionDays` is managed. Fake-time tests include the exact boundary.

## 4.3 Forget controls

- `forgetSite`, `forgetSince`, `forgetAll` cover every IndexedDB store. `HANDLED_TABLES` is compared against the live schema in a test, so a new store that is not handled fails the build (Phase 5 stores must be added).
- Found and fixed on the way: 1.0.x "Delete all indexed data" left the legacy `pages` table (pre-v3 full page text) in place. `forgetAll` and `clearAllIndexedData` now clear it.
- Forgetting a site deletes assistant answers that cite it (the question stays); forgetting a time window deletes chat messages written in it. The stats snapshot in `chrome.storage.local` (recent visit titles) is refreshed after every forget.
- Options: forget a typed site, last hour, last day, and the existing forget-all flow. Overlay: a menu in the header (menu button pattern, arrow keys, Escape) with forget this site, last hour, last day, forget all (second click confirms). The side panel shows no "this site".
- `src/lib/forget-request.ts`: from a page, "this site" is always the sender tab's host; a hostname in the payload is ignored.

Tests: `tests/data-controls.test.ts` (9), `tests/forget-request.test.ts` (5), `tests/forget-menu.test.ts` (8), and the E2E below.

## 4.4 Encryption at rest

Threat model and recommendation written in `docs/ENTERPRISE.md`. **Not implemented**: a key stored in the same profile only protects against copying the IndexedDB folder alone. Owner decision required.

## 4.5 E2E and accessibility

Playwright, unpacked extension, persistent Chromium context. Two harness findings shaped the tests:

1. **Playwright request interception does not see the offscreen document**, where the model loads and chat runs. A first Ask test's `context.route` stub was bypassed and the request reached Google's real endpoint with the fake test key and fictional test text, where it was rejected. `e2e/cdp.ts` now connects to the browser over CDP and attaches to the offscreen document directly. This also turned the Phase 1 "no external fetch" check into a real assertion.
2. **axe cannot see into a closed shadow root.** `npm run build:e2e` produces `dist-e2e/`, identical except for an open overlay shadow root, used only by `e2e/a11y.spec.ts`. A separate test asserts the production build's shadow root is closed.

Output (`npx playwright test`, production build plus `dist-e2e` for axe):

```
  ok  1 e2e\a11y.spec.ts › overlay (light): search, results, ask, digest, forget menu (12.2s)
  ok  2 e2e\a11y.spec.ts › overlay (dark): search, results, ask, digest, forget menu (11.8s)
  ok  3 e2e\a11y.spec.ts › narrow overlay (360px): ask with chats drawer open (2.7s)
  ok  4 e2e\a11y.spec.ts › extension page: options.html (3.8s)
  ok  5 e2e\a11y.spec.ts › extension page: popup.html (2.9s)
  ok  6 e2e\a11y.spec.ts › extension page: onboarding.html (3.1s)
  ok  7 e2e\a11y.spec.ts › extension page: search-shell.html (3.2s)
  ok  8 e2e\embedding.spec.ts › indexes a page and stores 384-d embeddings without any external fetch (5.5s)
  ok  9 e2e\flows.spec.ts › production build keeps the overlay shadow root closed (2.1s)
  ok 10 e2e\flows.spec.ts › search: an indexed page is found from the overlay (6.4s)
  ok 11 e2e\flows.spec.ts › ask (on-device path): stubbed Prompt API answers with citations and nothing leaves the offscreen document (5.6s)
  ok 12 e2e\flows.spec.ts › ask (cloud path): Gemini receives only the question and retrieved snippets (5.4s)
  ok 13 e2e\flows.spec.ts › side panel: toolbar click on chrome://newtab opens the Cortex shell (2.2s)
  ok 14 e2e\flows.spec.ts › managed policy: options page locks managed fields (1.5s)
  ok 15 e2e\flows.spec.ts › forget this site from the overlay menu removes the page from the library (5.3s)
  ok 16 e2e\focus.spec.ts › Escape closes the overlay and focus returns to the previous element (2.0s)
  ok 17 e2e\overlay.spec.ts › content.js carries no overlay UI; toolbar click injects overlay.js and opens the panel (1.3s)
  ok 18 e2e\panel.spec.ts › panel keeps one size across Search, Ask and Digest and is vertically centered (2.1s)
  ok 19 e2e\panel.spec.ts › small viewport: panel fills width minus 32px and height minus 48px (1.7s)
  ok 20 e2e\rechunk.spec.ts › rechunk alarm upgrades a legacy document to the current chunking version (9.8s)
  20 passed (1.5m)
```

What each E2E asserts beyond "it opens":

- **Ask, on-device path**: a fake Prompt API is installed in the offscreen document; the answer streams into the overlay with a citation link; the prompt contains the retrieved snippet; the offscreen document made zero non-extension requests.
- **Ask, cloud path**: every request from the offscreen document is intercepted; exactly one goes to Gemini, with the key in the `x-goog-api-key` header only, the snippet in the body, no image or file parts, and a body under 20,000 characters.
- **Embedding**: the model and ONNX runtime load from `chrome-extension://` URLs, with zero external requests from the offscreen document.
- **Managed policy**: `chrome.storage.managed` is stubbed in the options page. Real OS policies were not installed, because that changes system settings. Enforcement is unit tested.

### axe-core

Zero violations of any severity (WCAG 2.0/2.1 A and AA plus best practices) on 15 audited states: overlay light and dark (search idle, results, Ask, Digest, forget menu), narrow Ask with drawer, options, popup, onboarding, side panel shell. Report: `docs/release-1.2.0/axe-report.json`.

Issues axe found and that were fixed (all pre-existing except the chip row role):

| Rule | Where | Fix |
|------|-------|-----|
| nested-interactive (serious) | search result cards were `role="option"` containing a link and a disclosure | list semantics; arrow keys focus the result link |
| aria-required-children (critical) | chat history `listbox` held headings and delete buttons | plain group; `aria-current` on the open chat |
| aria-allowed-attr (critical) | Digest range buttons were `role="tab"` with `aria-pressed` | toggle buttons in a labelled group |
| label (critical) | hidden pause checkbox in options | `aria-label` |
| aria-prohibited-attr (serious) | chip rows with `aria-label` and no role | `role="group"` |
| color-contrast (serious) | options tertiary text #8a8a8a (3.3:1); popup accent #c72a09 on tinted fills | #666666 (5.5:1); popup accent #a82207 |

## Gate

```
$ npm run typecheck
> tsc --noEmit

$ npm test
 Test Files  45 passed (45)
      Tests  234 passed (234)
 Test Files  3 passed (3)
      Tests  11 passed (11)

$ npm run check:budget
ok      content.js              44604 /    46080 bytes
ok      overlay.js              84655 /   143360 bytes
ok      service-worker.js      177747 /   225280 bytes
ok      offscreen.js           629080 /   716800 bytes
Bundle budget check passed
```

Note for Phase 5: `content.js` has 1.4 KB of headroom under its 45 KB budget.
