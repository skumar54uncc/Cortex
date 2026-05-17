# Cortex retrieval eval (offline)

Measures **nDCG@10**, **Recall@10**, **MRR@10**, and query latency against a frozen corpus. No user-visible changes; CLI + CI only.

## Quickstart

```bash
npm run prepare-model   # once — vendor/models/
npm run eval:seed       # regenerate pages.jsonl + retrieval.jsonl
npm run eval            # index corpus, run queries, print table
npm run eval:baseline        # write eval/results/baseline.json
```

Warm second run (embedding cache populated) should finish in under ~15s on a modern laptop.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run eval:seed` | TS fixtures → JSONL |
| `npm run eval` | Full harness |
| `npm run eval -- --baseline` | Overwrite baseline |
| `npm run eval -- --ci` | Exit 1 on regression vs baseline |
| `npm run eval:test` | Harness unit tests |

## Metrics

| Metric | Meaning |
|--------|---------|
| **nDCG@10** | Binary doc relevance, discounted gain (higher is better) |
| **Recall@10** | Fraction of queries with ≥1 relevant doc in top 10 |
| **MRR@10** | Mean reciprocal rank of first relevant doc |
| **Neg pass** | Negative queries: no hit above score floor |
| **p50/p95/p99** | Wall-clock ms per `runAdvancedSearch` call |

**Rule of thumb:** factual nDCG &gt;0.5 is decent on a tiny corpus; compare **deltas vs baseline**, not absolute scores in isolation.

## CI gate

On PRs that touch retrieval paths (see `.github/workflows/ci.yml`), job **`eval`** runs `npm run eval -- --ci`.

Fails when vs `eval/results/baseline.json`:

- nDCG@10 drops **&gt;2%** (absolute 0.02 on proportion scale used in diff), or
- p95 latency increases **&gt;25%**

Override: include `[eval-override: your reason]` in the PR description.

## Updating baseline after an intentional change

1. Merge-quality improvement on purpose.
2. `npm run eval -- --baseline`
3. Commit `eval/results/baseline.json`
4. PR description must explain the expected metric shift.

## Layout

See `corpus/README.md` and `queries/chat.jsonl.example` (chat eval stub for PR 5).
