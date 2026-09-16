# Release 1.2.0 baseline (Phase 0)

Recorded 2026-09-16 on branch `release/1.2.0` (from `main` at `de96dd0`).

## Commands

### `npm ci`

```
added 400 packages in 50s
```

### `npm run typecheck`

```
> tsc --noEmit
(no output, exit 0)
```

### `npm test`

```
 Test Files  22 passed (22)
      Tests  77 passed (77)
   Duration  43.66s

> cortex@1.0.1 eval:test
 Test Files  3 passed (3)
      Tests  11 passed (11)
```

### `npm run build`

```
webpack 5.106.2 compiled with 3 warnings in 19414 ms
(warnings: asset size limit for offscreen.js, tokenizer.json, model_quantized.onnx)
```

### Bundle sizes (`dist/`, production, bytes)

| File | Bytes | KB |
|------|-------|----|
| content.js | 103,200 | 100.8 |
| service-worker.js | 168,214 | 164.3 |
| offscreen.js | 900,137 | 879.0 |
| search-shell.js | 61,706 | 60.3 |
| options.js | 11,351 | 11.1 |
| popup.js | 6,950 | 6.8 |
| onboarding.js | 1,503 | 1.5 |
| models/.../model_quantized.onnx | 22,972,370 | 22,434 |
| models/.../tokenizer.json | 742,346 | 725 |

### `npm run eval` (cold cache)

```
Latency ms  p50: 9.5  p95: 13.5  p99: 17.2

By type       nDCG@10  Recall@10  MRR@10  Neg pass  n
factual       93.8%    100.0%     91.7%   100.0%    8
navigational  100.0%   100.0%     100.0%  100.0%    6
exploratory   84.4%    100.0%     83.3%   100.0%    4
negative      50.0%    50.0%      50.0%   50.0%     2
Overall       89.4%    95.0%      88.3%   50.0%     20
```

Note: the brief said negatives pass 0%. The repo's current baseline shows 1 of 2 negative queries passing (q-019 fails: a "negative" query still returns a corpus hit because there is no abstain floor). Corpus is 5 synthetic pages, 20 queries. Trusting the repo.

### `npm audit --omit=dev`

```
protobufjs  <=7.6.2   Severity: critical  (via onnx-proto -> onnxruntime-web -> @xenova/transformers)
sharp  <=0.35.4-rc.0  Severity: high      (via @xenova/transformers)
5 vulnerabilities (4 high, 1 critical)
```

All five reach the tree only through `@xenova/transformers@2.17.2`.

## Verified starting state versus the brief

| Claim in brief | Repo reality |
|----------------|--------------|
| tsc clean, 77 tests / 22 files, build ok | Confirmed (plus 11 eval tests in 3 files). |
| content.js 100 KB on every http(s) page | Confirmed: 103,200 bytes, `content_scripts` matches `http://*/*`, `https://*/*`. |
| service-worker.js 168 KB, offscreen.js 900 KB | Confirmed. |
| 5 audit vulns via @xenova/transformers | Confirmed. |
| No SECURITY.md, LICENSE, managed schema, retention, i18n locales, E2E | Confirmed. `src/lib/locales/en.json` exists as an internal string table but there is no `_locales/` directory and no `default_locale` in the manifest. |
| No width breakpoints in overlay.shadow.css | Confirmed: only `prefers-reduced-motion` media queries. |
| Fixed 200px chat sidebar | Confirmed: `.cortex-chat-sidebar { flex: 0 0 200px }`. |
| Panel width changes per tab | Confirmed: 720px (search), 920px (ask), 760px (digest) at lines 53, 77, 122. |
| Send not disabled while streaming | Confirmed: no `disabled` toggling in overlay.ts on the send button. |
| Single chatEventSink overwritten on double submit | Confirmed: module-level `let chatEventSink` reassigned per submit (line 922). |
| 120s timeout never reset by tokens | Confirmed: `window.setTimeout(..., 120_000)` at line 898 with no reset on token. |
| Six stacked focus setTimeouts | Four in `focusPrimaryField` burst (lines 338 to 341) plus additional calls at 659 and 1251. Close enough; the pattern is confirmed. |
| Forced light mode | Confirmed: `:host { color-scheme: light }`, no dark tokens. |
| Author credit in every footer | Confirmed in overlay.ts, popup.html, onboarding.html, options.html. |
| 420 word chunks, 75 overlap | Confirmed in `src/lib/chunking.ts`. |
| Eval corpus 5 synthetic pages | Confirmed. |
| `web_accessible_resources` exposes `models/**` to `<all_urls>` | Confirmed, along with `icons/*.png` and `fonts/*.woff2`. No `use_dynamic_url`. |
| README has GhostWriter and `cd cortex` sections | Confirmed (lines 10 and 52). |
| Manifest name uses an em dash | Confirmed: "Cortex — Local Second Brain". |

## Can old pages be re-chunked?

**Partially.** Documents store only `summary` (500 char truncate) and metadata. Full text lives only in `chunks.text` as 420-word sliding windows with 75 words of overlap. The original text can be reconstructed by concatenating chunks in `ord` order and dropping the 75 overlapping words at each boundary. This is exact for pages under the 36 chunk cap (36 * 345 + 75 = 12,495 words). Pages that hit the cap were truncated at index time and cannot be fully recovered, but they can still be re-chunked from what was kept. Legacy v3-migrated rows (from the old `pages` table) are a single chunk with the whole text, so those re-chunk exactly.

Plan for Phase 3.4: background re-chunk reconstructs text from existing chunks (overlap aware), keyed by a new `chunkingVersion` on documents. No new "original text" column is required.

## Docs read

ARCHITECTURE.md, docs/UI_DECISIONS.md, docs/INNERHTML_AUDIT.md, docs/SECURITY_REVIEW_1.md, eval/FINDINGS.md.

Notable: SECURITY_REVIEW_1 remediations are in the tree (closed shadow root, sender checks). The overlay already uses `esc()` for page-derived text in `innerHTML` templates; that audit must be extended for any new sink.

The bundled model (23 MB `model_quantized.onnx`) is committed to git under `vendor/models/`.
