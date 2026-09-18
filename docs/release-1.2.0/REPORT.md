# Cortex 1.2.0: final report

Branch `release/1.2.0`, from `main` at `de96dd0` (1.0.1). 41 commits. Package `cortex-1.2.0.zip` built and verified, **not uploaded**. Details and pasted outputs per phase are in `phase-1.md` to `phase-6.md` next to this file.

## Per phase

| Phase | Commits | What changed |
|-------|---------|--------------|
| 0 Baseline | `ba93719` | Recorded tests, eval, bundle sizes and audit of 1.0.1 (`baseline.md`). |
| 1 Foundations | `03df5e2`, `bddfd6c` | `@xenova/transformers` 2 replaced by `@huggingface/transformers` 4 with the ONNX Runtime binary bundled (no CDN); embedding parity test (min cosine 0.995, mean 0.999). Web accessible resources cut to the icon and fonts on http(s) with dynamic URLs. Overlay split out of the content script. SECURITY.md, CycloneDX SBOM, CI gates (audit, typecheck, tests, build, budget, SBOM, E2E, axe, eval). LICENSE left for the owner. |
| 2 UI fixes | `c5cd712` to `3d4e82f` (9 commits) | Responsive layout, one panel size, chat stream state machine with Stop, frame-batched streaming, real focus trap, dark mode with AA contrast test, grouped chat history with undo, example prompts, store name and description, em dash guard, QA screenshots at 360/600/1280 and 200% zoom. |
| 3 Retrieval | `f4683b2` | 160-page, 193-query eval corpus; 180/40 chunking chosen over 420/75; abstain floor 0.18; background re-chunk of old pages. |
| 4 Enterprise | `afe05ad`, `158c921` | Managed policy (6 keys) with locked options UI, retention, forget site / hour / day / all across every store, encryption threat model (not implemented, owner decision), Playwright E2E with CDP access to the offscreen document, axe gate. |
| 5 Features | `0683c9e` plan; `b6e7d24` to `1976f0e` | One Dexie migration (v6). People, omnibox, highlights, collections, resurfacing, YouTube transcripts, tables, images, PDFs, export and backup; kind boosts, snippet labels, per-kind citation cards. See `phase-5.md` for the per-feature commit list. |
| 6 Verify and package | `bafc055` to `d0c0a86` | Version 1.2.0, dev dependency advisories fixed, live console sweep (found and fixed a focus bug on github.com), upgrade test from a real 1.0.1 install, duplicate 14.3 MB wasm removed from the package, zip, STORE_RELEASE.md. |

## Before and after

### Tests

| | 1.0.1 | 1.2.0 |
|---|---|---|
| Unit tests | 77 in 22 files | 406 in 74 files |
| Eval harness tests | 11 in 3 files | 11 in 3 files |
| E2E (Playwright, unpacked extension) | none | 41 (including 7 axe checks with zero violations), plus 3 on-demand specs: live console sweep, live GitHub comparison, 1.0.1 upgrade |

### Eval (160-page corpus, 193 queries)

| | 1.0.x retrieval (420/75, no floor) | Phase 3 | 1.2.0 final |
|---|---|---|---|
| nDCG@10 | 79.0% | 91.6% | 91.6% |
| Recall@10 | 85.0% | 97.4% | 97.4% |
| MRR@10 | 78.1% | 90.7% | 90.7% |
| Negative queries correctly empty | 9.4% | 84.4% | 84.4% |
| factual / navigational / exploratory nDCG@10 | 98.9 / 94.8 / 64.8 | 99.6 / 93.6 / 64.8 | 99.6 / 93.6 / 64.8 |
| p95 latency (ms, this machine) | 72.6 | 117.3 | 90.2 to 105.1 across runs |

No slice moved after Phase 3: all ten Phase 5 features left every slice unchanged (the rule was at most 2 points down). The only slice that moved in Phase 3 was navigational, down 1.2 points. The original 20-query corpus from Phase 0 (89.4% nDCG, 1 of 2 negatives) was too small to judge changes; it was kept and extended.

### Bundle sizes (bytes)

| File | 1.0.1 | 1.2.0 |
|---|---|---|
| content.js (runs on every page) | 103,200 | 2,705 |
| extract.js (injected after the privacy gate) | (in content.js) | 51,103 |
| overlay.js (injected on open) | (in content.js) | 94,548 |
| service-worker.js | 168,214 | 218,818 |
| offscreen.js | 900,137 | 639,632 |
| pdf.js + pdf.worker.min.mjs (lazy, PDFs only) | none | 494,185 + 1,245,523 |
| search-shell.js | 61,706 | 94,927 |
| options.js | 11,351 | 23,492 |
| popup.js / onboarding.js | 6,950 / 1,503 | 6,950 / 1,503 |
| Package zip | 16,961,190 (37 files) | 21,213,717 (51 files) |

The package is larger because the ONNX Runtime binary is now bundled instead of loaded from a CDN (a core value) and because of pdfjs. A duplicate copy of the runtime binary was found and removed in Phase 6; without that fix the package would carry 14.3 MB more.

### Dependency audit

| | 1.0.1 | 1.2.0 |
|---|---|---|
| `npm audit --omit=dev` (CI gate) | 5 (4 high, 1 critical), all through `@xenova/transformers` | 0 |
| `npm audit` (including dev tools) | not recorded in Phase 0 | 3 moderate, all in vitest's own packages |

## Bugs found by verification (not in the brief)

- Overlay focus trap and github.com's focus manager recursed into a stack overflow while the panel was open (live sweep). Fixed and tested, `77f8330`.
- A 14.3 MB duplicate of the ONNX Runtime binary in the package. Removed, guarded, `3686c20`.
- Images: 40 px icons backed by large files passed the size filter; re-index passes described the same images up to 4 times. Fixed in `ef45439`.
- Chunks left `pending` when the service worker stopped mid-queue were never embedded. Fixed by the drain added in `59a4a1a`.
- Search shell load error written with `innerHTML` (since 1.0.x). Fixed, `121b699`.
- E2E flake (about 1 in 5 runs): the toolbar click went to a different tab. Fixed in the harness, `929c7ba`.

## Skipped, blocked or not verified

- **LICENSE**: not added; owner decision.
- **Encryption at rest**: threat model written (`docs/ENTERPRISE.md`), not implemented; owner decision.
- **LinkedIn live check**: logged-out LinkedIn returned HTTP 999 or timed out; no Cortex errors seen, but a logged-in profile page was not tested live.
- **Real Chrome**: the console sweep and upgrade test ran in Playwright's Chromium (headless), not in Google Chrome loaded by hand.
- **Prompt API image input**: exercised only with a stub; the real API shape was not verified. It fails closed (no descriptions) if the API differs.
- **vitest 4.1.11**: blocked by an npm crash; 3 moderate dev-only advisories remain.
- **Eval latency baseline**: recorded on this machine; the CI latency gate compares a different machine's runs against it. Re-record `eval/results/baseline.json` on the CI runner.
- **Store upload**: not done, by instruction.

## Open questions for the owner

1. **License.** Which license should Cortex ship under (for example MIT, Apache-2.0, or proprietary)? pdfjs-dist (Apache-2.0) and the bundled model and runtime have their own notices, which are kept in the package.
2. **Encryption at rest.** Implement the option described in `docs/ENTERPRISE.md`, or keep relying on the operating system's disk encryption? The recommendation there is not to ship a key stored in the same profile.
3. **Web Store privacy form.** Declare "Personally identifiable information" because people memory stores LinkedIn names and headlines locally? Declaring it is the conservative choice.
4. **Export policy.** Should administrators be able to turn off export and backup? There is no policy for it today.
5. **Service worker budget.** 6.3 KB of headroom is left. Raise the budget, or move export and backup into the offscreen document before adding more to the worker?
