# Phase 6: verify and package

Branch `release/1.2.0`. All outputs below are pasted from real runs on 2026-09-18 (Windows 11, Node 22.15.0, Playwright Chromium).

## 1. Gates

```
$ npx tsc --noEmit -p .
(exit 0)

$ npx vitest run
 Test Files  74 passed (74)
      Tests  406 passed (406)

$ npm run eval:test
 Test Files  3 passed (3)
      Tests  11 passed (11)

$ node scripts/check-bundle-budget.mjs
ok      content.js               2705 /    15360 bytes
ok      extract.js              51103 /    61440 bytes
ok      resurface-chip.js        2501 /     8192 bytes
ok      youtube-bridge.js        1031 /     4096 bytes
ok      overlay.js              94548 /   143360 bytes
ok      service-worker.js      218818 /   225280 bytes
ok      offscreen.js           639632 /   716800 bytes
ok      pdf.js                 494185 /   573440 bytes
ok      pdf.worker.min.mjs    1245523 /  1433600 bytes
ok      search-shell.js         94927 /   143360 bytes
ok      options.js              23492 /    40960 bytes
ok      popup.js                 6950 /    20480 bytes
ok      onboarding.js            1503 /    10240 bytes
Bundle budget check passed

$ npm audit --omit=dev --audit-level=high
found 0 vulnerabilities

$ npm audit
@vitest/mocker  2.1.0 - 4.1.10
3 moderate severity vulnerabilities
```

Build: `npm run build` compiles with 2 warnings, both webpack's generic "asset size limit (244 KiB)" notices for the offscreen bundle, the model files and the PDF chunk; the project's own budgets above are the gate.

E2E (`npx playwright test`, production `dist/`, axe on `dist-e2e/`): `41 passed (4.2m)`, `3 skipped` (the on-demand live sweep, live GitHub comparison and upgrade specs, which need network or a 1.0.1 build). The axe spec (7 tests: overlay light, dark, narrow, options, popup, onboarding, search shell) is part of the 41 and reports zero violations.

Eval (`npx tsx eval/src/cli.ts`, 160-page corpus, 193 queries):

```
nDCG@10 (overall)            0.9161 -> 0.9161 (+0.0000, +0.0%) [ok]
Recall@10 (overall)          0.9741 -> 0.9741 (+0.0000, +0.0%) [ok]
MRR@10 (overall)             0.9074 -> 0.9074 (+0.0000, +0.0%) [ok]
p95 latency ms               94.6878 -> 90.2447 (-4.4431, -4.7%) [ok]
nDCG@10 (factual)            0.9963 -> 0.9963 [ok]
nDCG@10 (navigational)       0.9362 -> 0.9362 [ok]
nDCG@10 (exploratory)        0.6475 -> 0.6475 [ok]
nDCG@10 (negative)           0.8438 -> 0.8438 [ok]
```

### Dependency audit fix

`npm audit` listed 13 advisories (6 high) in dev tools only (undici via jsdom, vite via vitest, postcss, nanoid, browserslist, fast-uri, fflate, esbuild, postcss-selector-parser). `npm audit fix` and `npm install vitest@4.1.11` both crash inside npm (`Cannot read properties of null (reading 'edgesOut')` in arborist `#loadPeerSet`), with npm 11.3.0 and npm 10, and also on the untouched 1.0.1 lockfile, so it is a tooling bug. Fixed with `overrides` for the transitive packages instead. No production dependency changed (checked in the lockfile diff). The 3 remaining moderate findings are vitest's own packages (`@vitest/mocker` up to 4.1.10); they need vitest 4.1.11, which the npm bug blocks.

## 2. Load unpacked: console sweep on real sites

`CORTEX_LIVE=1 npx playwright test e2e/live` runs the unpacked 1.2.0 build in Playwright's Chromium and records, over CDP, every uncaught exception and `console.error` in the service worker, the offscreen document, and Cortex's contexts in pages (content script isolated world, scripts served from the extension). The sites' own errors are excluded.

**Found and fixed a real bug.** The first sweep reported "Maximum call stack size exceeded" on github.com. A controlled comparison (`e2e/live/github-overflow.spec.ts`) gave: without Cortex 0, Cortex idle 0, Cortex overlay open 20 (2 of 2 runs). Root cause: the overlay focus trap pulled focus back synchronously inside `focusin`, GitHub's focus manager did the same, and the two handlers re-entered each other until the stack overflowed (the deepest frames were GitHub's, so it looked like GitHub's error). Reproduced as a unit test (`RangeError: Maximum call stack size exceeded`), fixed in `src/content/focus-trap.ts` (reclaim after the event, at most 3 times per second, then yield until the user focuses the overlay), commit `77f8330`. After: overlay open 0, 3 of 3 live runs.

Final sweep result:

```
"visited": [
  "LinkedIn: navigation error page.goto: net::ERR_CONNECTION_TIMED_OUT at https://www.linkedin.com/in/satyanadella/",
  "YouTube: HTTP 200",
  "Wikipedia table: HTTP 200",
  "PDF: opened in a tab",
  "GitHub: HTTP 200",
  "chrome://newtab: HTTP 200"
],
"chunkKinds": { "text": 64, "transcript": 1, "pdf": 1, "table": 28 },
docs: ['Me at the zoo', '(next autoplayed YouTube video)', 'List of countries and dependencies by population - Wikipedia', 'dummy.pdf', 'GitHub - mozilla/pdf.js: PDF Reader in JavaScript']
findings: 0
```

The live run also shows the new capture paths working on real sites: a YouTube caption window, 28 table chunks from Wikipedia, and the PDF read through Chrome's viewer.

Not verified: **LinkedIn.** Logged out, LinkedIn answered HTTP 999 (its bot wall) in the first sweep, with no Cortex errors on that page, and timed out in the second. A logged-in profile page was not tested live; people capture is covered by the fixture-based E2E only. The sweep ran in Playwright's Chromium, not in Google Chrome, and headless.

## 3. Upgrade test 1.0.1 to 1.2.0

`CORTEX_UPGRADE_FROM=<1.0.1 dist> npx playwright test e2e/upgrade`. 1.0.1 is `main` at `de96dd0`, built in a separate worktree. The test installs 1.0.1 unpacked, indexes 10 pages, runs 2 chats through 1.0.1's real chat path (stubbed on-device model), sets a blocklist and chat mode, closes the browser, replaces the extension folder with 1.2.0, and relaunches the same profile.

```
version 1.0.1 -> 1.2.0
db schema 50 -> 60
stores after ['chunks', 'collectionItems', 'collections', 'conversations', 'digestCache', 'documents', 'highlights', 'messages', 'pages', 'people', 'visitLog']
documents 10 -> 10 identical
chunks 10 -> 10 identical per doc
chats 2 -> 2 ; messages 4 -> 4 identical
visits 20 -> 20
settings {'blocklist': ['blocked-before-upgrade.test'], 'chatMode': 'on-device-only'} -> {'blocklist': ['blocked-before-upgrade.test'], 'chatMode': 'on-device-only'}
```

After the upgrade, search finds an upgraded page ("The frostwick field report"). `1 passed (32.7s)`.

## 4. Version

`manifest.json` and `package.json` (and the lockfile root) are `1.2.0`, commit `bafc055`.

## 5. Package

Found before zipping: webpack emitted a second, hashed copy of the 14.3 MB ONNX Runtime binary (byte-identical, MD5 `1845ac0b...`). The extension loads `wasm/ort-wasm-simd-threaded.wasm`; deleting the copy left the embedding and search E2E passing. The webpack rule now points the reference at `wasm/` without emitting it, and the budget script fails on any `.wasm` at the package root (checked with a planted duplicate). Commit `3686c20`. Full E2E after the change: 41 passed.

```
$ cd dist && zip -r ../cortex-1.2.0.zip . -x "*.map"
-rw-r--r-- 1 ... 21213717 Sep 18 19:15 cortex-1.2.0.zip
     2097  2026-09-18 18:39   manifest.json
 14264838  2026-09-16 19:55   wasm/ort-wasm-simd-threaded.wasm
 41198523                     51 files
  "version": "1.2.0",
```

`manifest.json` is at the zip root; no `.map` files; one `.wasm`. For comparison, 1.0.1 packaged the same way: 16,961,190 bytes, 37 files, 25,220,021 bytes unpacked. The growth is mostly pdfjs (pdf.js 494 KB and its worker 1.2 MB) and the locally bundled ONNX Runtime binary, which 1.0.1 loaded from a CDN.

## 6. Store pack

`docs/release-1.2.0/STORE_RELEASE.md`: release notes, a justification for every permission, the privacy practices delta, listing copy (no em dashes), 5 screenshots to capture at 1280x800 and a 45 second video script.

## 7. Not uploaded

Nothing was uploaded to the Chrome Web Store.
