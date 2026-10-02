# Pass 4 — final verification

**Date:** 2026-10-02 15:52 EDT (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex` only (no user laptop)  
**Node:** v20.19.2  
**Constraints:** No push / PR / git-config. OAuth `release` not filled.  
**Overall:** **PASS** — all gates green after SW budget trim.

---

## Gate table (this verification run)

| # | Gate | Command / check | Result | Detail |
|---|------|-----------------|--------|--------|
| 1 | Typecheck | `npm run typecheck` | **PASS** | `tsc --noEmit` exit 0 |
| 2 | Assistant Sync tests | `npx vitest run tests/assistant-sync.test.ts tests/assistant-sync-engine.test.ts tests/assistant-sync-drive.test.ts tests/assistant-sync-options.test.ts` | **PASS** | 4 files, **34/34** tests |
| 3 | S-2 / security gates | `npx vitest run tests/gemini-api-key-s2.test.ts tests/pass4-security-gates.test.ts` | **PASS** | 2 files, **11/11** tests |
| 4a | Production build | `npm run build` | **PASS** | webpack production compiled (asset-size warnings only; unrelated to budget script) |
| 4b | Bundle budget | `npm run check:budget` | **PASS** | `service-worker.js` **189006 / 225280** bytes (was 226962 / +1682 over; now −36274 under). Lazy `history-extract.js` **36888 / 40960**. Gemini secret chunk `202.js` **1717** (not budget-listed; loaded on demand). |
| 5a | OAuth release empty | `config/oauth-clients.json` `"release": ""` | **PASS** | Still empty; not filled |
| 5b | Store build latch | `npm run build:store` | **PASS** (refuses) | Throws: `Release OAuth client id is empty…` |

**Prior blocking failure (cleared):** `check:budget` had SW at 226962 (+1682). Trimmed without raising the 220 KiB SW cap.

---

## Budget trim (how SW got under 225280)

Analysis: SW statically pulled `@mozilla/readability` via `extractPageTextFromHtml` (history import only) and statically pulled `gemini-api-key` via `managed-policy` + install/startup migrate.

Changes (behavior preserved; no ranking/search edits; no new deps; S-2 store kept; Assist Sync Google fetch still in `assistant-sync` chunk):

1. **`src/shared/managed-policy.ts`** — `getGeminiApiKey` via dynamic `import("./gemini-api-key")` inside `getEffectiveSettings` (same merge semantics).
2. **`src/background/service-worker.ts`** — install/startup migrate uses dynamic `import("../shared/gemini-api-key")`; history import loads Readability via `import(/* webpackChunkName: "history-extract" */ "../content/extract")` only when Scan history fetches HTML.
3. **`scripts/check-bundle-budget.mjs`** — added `history-extract.js` cap at **40 KiB** (does not raise SW cap).

| Asset | Bytes | Cap | Notes |
|-------|------:|----:|-------|
| `service-worker.js` | **189006** | 225280 | Main SW entry |
| `history-extract.js` | 36888 | 40960 | Lazy; history import only |
| `202.js` | 1717 | (unlisted) | Gemini S-2 secret store async chunk |

---

## Pass 4 work summary

### Tests

- Targeted Assistant Sync + S-2/security suites: all green this run (see gate table).
- Earlier Pass 4 suite report (`pass4-test-report.md`): typecheck/budget were green *before* later SW growth; unit suite had OOS failures only after a trivial copy-guard CSS comment fix.
- **Out-of-scope unit failures (not fixed, not claimed as product regressions for this pass):**
  - `tests/pdf.test.ts` ×2 — `Promise.withResolvers` missing on Node 20 Vitest host
  - `tests/embed-parity.test.ts` ×1 — cosine below snapshot floor
  - `tests/chat-engine-abort.test.ts` ×1 — zero `token` events before abort

### Security

| ID | Severity | Status | Notes |
|----|----------|--------|-------|
| S-1 | High | **fixed** | History import start/cancel + Assist Sync `enable` require options-page sender |
| S-2 | Med | **fixed** | Gemini key in `gemini-api-key.ts` (session TRUSTED + dedicated local persist); content never sees raw key; still lazy-loaded into SW |
| S-3 | Med | **fixed** | Whitelist-only `normalizeSettings` |
| S-4 | Med | **open (intentional)** | Broad `http(s)://*/*` hosts — core indexing product |
| S-5 | Low | **open** | Overlay delete messages from content scripts |
| S-6 | Low | **open** | Residual escaped `innerHTML` templates |
| S-7 / P-1 | Low | **fixed** | agent-debug-log noop; no localhost ingest URL |
| S-8 / P-4 | Low | **fixed** | YouTube timedtext `credentials: "omit"` |
| S-9 | Low | **open** | `wasm-unsafe-eval` CSP for ORT |
| S-10 | Low | **open** | Gemini key plaintext at rest in profile (post S-2 isolation) |

Details: `pass4-security.md`, `pass4-security-s2.md`.

### Content polish

Fixed this pass: **P-2, P-5, P-6, P-7, P-8, P-9, P-11, P-12, P-13** plus vibe-coded copy pass (Assist Sync naming, sober popup/overlay strings, no em dashes / emoji marketing). See `pass4-content-done.md`.

### Visual fixes

- **V-1** Popup indexing status honesty (Off / Paused / Active aligned with consent + pause).
- **V-2** Search-shell / overlay dark boot/error contrast.
- See `pass4-visual-fixes.md`.

### S-2

Secret store + migration + redaction shipped; targeted tests **11/11** this run. Residual at-rest risk tracked as **S-10**. Lazy chunk does not change trust model (TRUSTED_CONTEXTS + dedicated local key).

### Theme decision (Settings light-only)

**Decision unchanged:** Settings (options) and toolbar popup stay **light-only**. Appearance Light / Dark / System applies only to overlay + search/side panel shell. Documented in `docs/UI_DECISIONS.md` (Theme + Dark mode) and Appearance copy (**P-12**).

---

## Screenshots

Under `docs/enterprise-audit/screenshots/`:

| File | Surface |
|------|---------|
| `docs/enterprise-audit/screenshots/popup.png` | Toolbar popup |
| `docs/enterprise-audit/screenshots/options.png` | Settings |
| `docs/enterprise-audit/screenshots/options-scrolled.png` | Settings (scrolled / About) |
| `docs/enterprise-audit/screenshots/onboarding.png` | Welcome / onboarding |
| `docs/enterprise-audit/screenshots/search-shell-light.png` | Search shell light |
| `docs/enterprise-audit/screenshots/search-shell-dark.png` | Search shell dark |

---

## Residual open / deferred items

| Item | Status | Why open |
|------|--------|----------|
| **S-4** Broad install-time hosts | intentional open | Product requires index-what-you-read |
| **S-10** API key at rest | open | Profile/local persist; no OS-bound encryption in 1.2.0 |
| **S-5 / S-6 / S-9** | open (low) | Overlay deletes; escaped innerHTML; wasm CSP |
| **OOS tests** | deferred | pdf `withResolvers`, embed-parity, chat-engine-abort |
| **P-3** Assist Sync alarm when sync off | deferred | Handler no-ops when disabled; architecture note |
| **P-10** Deeper axe scenarios | deferred | Idle/load gate kept; deeper paths later |
| **C-1** OAuth `release` empty | intentional latch | `build:store` correctly refuses until operator fills client id |
| **Budget** | **PASS this run** | SW **189006 / 225280**; history-extract lazy **36888 / 40960** |

---

## Constraints honored this run

- Worked only in `/workspace/cortex-work/Cortex`
- No push, PR, or git-config
- Did not fill `config/oauth-clients.json` `release`
- Did not touch user laptop
- Did not edit search-engine / ranking / query-relevance / query-parse / similarity
- No new dependencies; SW budget cap unchanged at 220 KiB

---

## Verdict

**Pass 4 final verification: PASS**

All gates 1–5 passed. Bundle budget cleared by moving history-import Readability and the Gemini secret store off the SW static graph into existing/lazy chunks (S-2 semantics unchanged).

*Path: `docs/enterprise-audit/pass4-final.md`*
