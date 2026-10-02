# Pass 4 — test suite / gates report

**Date:** 2026-10-02 15:38 EDT (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Node:** v20.19.2  
**Scope:** Run unit + eval tests, typecheck, bundle budget. No push/PR/git-config. No eval file edits. OAuth release client left empty. Out-of-scope failures noted, not “fixed.”

## Commands run

| Step | Command | Result |
|------|---------|--------|
| Deps | `node_modules` already present (prior `npm ci`/`install`); not re-run | OK |
| Unit tests | `npx vitest run` (main `vitest.config.ts`) | See counts below |
| Eval tests | `npm run eval:test` | **13/13 passed** (5 files) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| Build | Existing `dist/` used (built earlier same day) | present |
| Budget | `npm run check:budget` | **PASS** (all bundles under budget) |

Full `npm test` = `vitest run && npm run eval:test`. Both halves were run.

---

## Unit test counts (initial `npx vitest run`)

| | Files | Tests |
|--|------:|------:|
| Passed | 100 | 895 |
| Failed | 4 | 5 |
| **Total** | **104** | **900** |

Duration ~11.7s.

### After trivial fix (copy-guard only)

- Re-ran `npx vitest run tests/copy-guard.test.ts` → **1/1 passed**.
- Expected remaining unit failures if suite re-run in full: **4 tests / 3 files** (all out-of-scope below). Product-relevant unit failures: **0**.

---

## Failed tests

### Out of scope (do not treat as product fix for this pass)

#### 1–2. `tests/pdf.test.ts` — `Promise.withResolvers`

- **reads the title and the text of every page of a generated three page PDF**
- **stops at the page cap**

```
TypeError: Promise.withResolvers is not a function
  at PDFDocumentLoadingTask (pdfjs-dist/.../api.js)
  at getDocument → extractPdfPages (src/offscreen/pdf-extract.ts:20)
```

**Notes:** Host Node is v20.19.2 where `typeof Promise.withResolvers === "undefined"`. `Promise.withResolvers` is ES2024 / Node 22+. Failure is environment / pdfjs-dist API requirement under the Vitest Node runner, not a Chrome-extension runtime regression to chase in this pass. (Chrome itself ships the API.)

#### 3. `tests/embed-parity.test.ts` — cosine threshold

- **matches the @xenova/transformers 2.17.2 snapshot for 20 strings (min >= 0.995, mean >= 0.999)**

```
AssertionError: expected 0.3318808640711272 to be greater than or equal to 0.995
  at tests/embed-parity.test.ts:81
```

**Notes:** Cosine similarity floor far below snapshot thresholds after the transformers migration. Marked out-of-scope for this pass (threshold / model-parity track).

#### 4. `tests/chat-engine-abort.test.ts` — token count

- **stops after abort: no more tokens, no done event, and no assistant message is stored**

```
AssertionError: expected [] to have a length of 3 but got +0
  at tests/chat-engine-abort.test.ts:75
  expect(events.filter((e) => e === "token")).toHaveLength(3);
```

**Notes:** Zero `token` events observed before abort; test expects exactly three. Marked out-of-scope for this pass (abort / streaming token-count behavior).

---

### In-scope product failure (fixed — trivial)

#### 5. `tests/copy-guard.test.ts` — em dash in UI sources

- **contains no em dash (U+2014) in UI source files**

```
AssertionError: /src/options/options.css:39: --font-size-stat: 22px; /* metric — aligned with --cx-ts-metric */: expected [ Array(1) ] to deeply equal []
```

**Cause:** Em dash inside a trailing CSS comment on a declaration line. `isCommentLine` only skips lines that *start* with `//` / `*` / `/*`, so trailing `/* … */` comments are still scanned.

**Fix applied (trivial / safe):** In `src/options/options.css` line 39, replaced `—` with `-` inside the comment:

```css
--font-size-stat: 22px; /* metric - aligned with --cx-ts-metric */
```

Confirmed with targeted vitest re-run (pass).

**Optional follow-up (not done):** Harden `isCommentLine` / strip trailing CSS comments so comment-only em dashes never trip the guard.

---

## Gates status

| Gate | Status |
|------|--------|
| `npm run typecheck` | **PASS** |
| `npm run check:budget` | **PASS** (service-worker.js 223450 / 225280 — closest to limit) |
| Unit vitest (excl. OOS) | **PASS** after copy-guard fix |
| Eval vitest | **PASS** (13 tests) |
| Out-of-scope unit failures | **NOTED** (pdf ×2, embed-parity ×1, chat-engine-abort ×1) |

---

## Minimal fix suggestions (remaining — not implemented)

| Failure | Suggestion | Implement now? |
|---------|------------|----------------|
| pdf `Promise.withResolvers` | Polyfill in Vitest setup, or run pdf tests under Node ≥22 / a browser-like env that provides the API; confirm Chrome path still uses pdfjs correctly | No (OOS) |
| embed-parity cosine | Re-baseline snapshot after intentional model migration, or investigate loader/quantization/path divergence if parity is still required | No (OOS) |
| chat-engine-abort token count | Debug why `runChat` yields no `token` events in the test harness (mock stream / early abort / path change); adjust test or restore token emission before abort | No (OOS) |
| copy-guard | Done (CSS comment hyphen). Optional: improve comment detection | Already fixed |

---

## Constraints honored

- No git push / PR / git config changes
- No eval file edits
- OAuth release client not filled
- Out-of-scope tests not “fixed”
- Only trivial safe product fix applied: CSS comment em dash
