# Eval harness — findings (PR 2)

Issues discovered during harness work. **Not fixed in this PR** unless noted.

## Architecture / coupling

- `runAdvancedSearch` and `chunkArticle` import cleanly in Node; **no `chrome.*` at module load** on the retrieval path.
- `schema.ts` uses a module singleton `db`; eval relies on `fake-indexeddb/auto` imported **before** any schema import in `cli.ts`.
- Eval does **not** call `summarizeBestEffort` (Chrome Summarizer API). Summaries are a deterministic 500-char truncate of `extracted_text`. Documented so ranking still uses a summary field without browser APIs.
- Harness runs via **`tsx`** (not emitted JS) because production `src/` is webpack-bundled, not emitted for Node.

## Baseline (2026-05-17, synthetic 5-page corpus)

Recorded via `npm run eval:baseline` → `eval/results/baseline.json`.

| Slice | nDCG@10 | Recall@10 | MRR@10 | Neg pass |
|-------|---------|-----------|--------|----------|
| factual (8) | 0.927 | 1.00 | 0.917 | — |
| navigational (6) | 0.938 | 1.00 | 0.917 | — |
| exploratory (4) | 0.858 | 1.00 | 0.833 | — |
| negative (2) | 0.00 | 0.00 | 0.00 | 0.00 |
| **overall** | **0.824** | 0.90 | 0.808 | 0.00 |

Negative queries still return corpus hits (no score floor in production search) — **expected failure** until PR 4+ work; do not “fix” search to pass negatives on this tiny fiction corpus.

Warm-cache run ~8s total for 5 pages / 20 queries. Do **not** tune production search to inflate baseline.

## Non-determinism

- (Record after first runs) Embedding cache should make warm runs bit-identical; note any float drift here.

## Performance

- Cold run: model load + embed all chunks dominates.
- Warm run: target &lt;15s for 5 pages / 20 queries with cache under `eval/.cache/`.

## Existing tests

- `tests/eval/search-eval.test.ts` (mocked DB) remains in `npm test`; this harness is the CI gate for retrieval file changes.
