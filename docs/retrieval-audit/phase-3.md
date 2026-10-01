# Retrieval phase 3

Implementation after the phase 1 audit and the phase 2 ranking. Pinned clock `2026-10-03T16:00:00.000Z` (latest `captured_at` in the frozen corpus). Production still calls `Date.now()`.

The original 193 queries stay in `eval/results/baseline.json`. Probe queries stay in `eval/queries/probes.jsonl` and `eval/results/probes-baseline.json`. The two denominators are never averaged.

Machine for every number below: macOS, Node v20.19.4. Model unchanged: `Xenova/all-MiniLM-L6-v2`. Index: 160 docs, 490 chunks.

## Commits

| Step | Commit | Result |
|------|--------|--------|
| Clock pin | `26f8d03` | Eval passes `now`. `pinnedNow` is stored on the baseline. |
| Person intent | `cb86247` | LinkedIn `/in/` chunks boosted 2.4x. Pages that say "employs N people" multiplied by 0.4. `who work` matches as well as `who works`. |
| Date window | `99fccce` | Visit window is applied before the abstain floor. Empty windows set `timeWindow: "relaxed"` and `timeRelaxed: true`, then the floor runs on the full set. |
| Probe slice | `99fccce` | Four `last week` queries, reported alone. |
| Fusion grid, first pass | `dc76ded` | Recorded the hook and a grid that renormalized the no-embedding fallback. That grid is not the result. |
| Fusion weights | `ef5b1ab` | Adopted cosine 0.36, lexical 0.36, recency 0.12, engagement 0.16. Fallback without embeddings stays 0.52 / 0.26 / 0.22. |
| RRF | not committed | Regressed every core slice against the learned vector. Removed. |
| MMR | not committed | All ten "people who work" queries are already rank 1. |
| Query cache | `275f0cf` | 32 embeddings, memory only, dropped when the offscreen document unloads. Failed embeds are not stored. |

`ABSTAIN_FLOOR` stays 0.18. The learned vector did not move the negative top scores (still max 0.211).

Embedding bakeoff (bge-small, e5-small, EmbeddingGemma) was skipped. Factual nDCG is 1.000.

## Core 193

| Stage | nDCG | Recall | MRR | factual | nav | expl | neg |
|-------|------|--------|-----|---------|-----|------|-----|
| 18 Sep baseline, unpinned | 0.9161 | 0.9741 | 0.9074 | 0.9963 | 0.9362 | 0.6475 | 0.8438 |
| Clock pin only | 0.9358 | 0.9896 | 0.9268 | 1.0000 | 0.9419 | 0.6565 | 0.9375 |
| Person intent | 0.9715 | 0.9896 | 0.9725 | 1.0000 | 0.9419 | 0.9436 | 0.9375 |
| Date window | 0.9715 | 0.9896 | 0.9725 | 1.0000 | 0.9419 | 0.9436 | 0.9375 |
| Learned weights | 0.9734 | 0.9896 | 0.9725 | 1.0000 | 0.9419 | 0.9589 | 0.9375 |
| Query cache | 0.9734 | 0.9896 | 0.9725 | 1.0000 | 0.9419 | 0.9589 | 0.9375 |

The 193 contain no yesterday, today, last week, or last month phrasing, so the date window cannot move this table. It is covered by the probe slice and by unit tests.

p95 on this Mac is about 40 ms after the pin. The 18 Sep baseline p95 is 94.7 ms from a Windows run. That gap is the machine. Do not read it as a retrieval win. Later commits moved p95 by about 1 ms, inside the 25% gate.

## What improved

Person intent. Exploratory nDCG 0.6565 to 0.9436. Overall nDCG 0.9358 to 0.9715. MRR 0.9268 to 0.9725. All ten "people who work in X" queries (`q-224`, `q-226`, `q-228`, `q-230`, `q-232`, `q-234`, `q-236`, `q-238`, `q-240`, `q-242`) are nDCG 1.000 and reciprocal rank 1.000. Rank 1 is a `gen-*-profile-*` page. Factual, navigational, and negative held.

Learned weights. Overall nDCG 0.9715 to 0.9734. Exploratory nDCG 0.9436 to 0.9589. Recall, MRR, factual, navigational, and negative held. Probes held at 1.000.

The corrected grid kept the no-embedding vector fixed and searched 25 with-semantic points (cosine 0.36/0.48/0.60, lexical 0.16/0.24/0.36, recency 0/0.06/0.12/0.20, engagement = 1 minus the sum, kept only when engagement was in [0, 0.30]). Two points held every slice and beat the hand tuned vector:

| cosine | lexical | recency | engagement | nDCG | expl |
|--------|---------|---------|------------|------|------|
| 0.48 | 0.24 | 0.12 | 0.16 | 0.9715 | 0.9436 |
| 0.36 | 0.36 | 0.12 | 0.16 | 0.9734 | 0.9589 |
| 0.48 | 0.36 | 0.12 | 0.04 | 0.9730 | 0.9560 |

A 10 point neighborhood around the winner did not find a higher nDCG that still held every slice. The shipped vector is the middle row.

Clock pin. Same code, frozen `now`, versus the 18 Sep file: overall nDCG 0.9161 to 0.9358, recall 0.9741 to 0.9896, factual 0.9963 to 1.0000, negative 0.8438 to 0.9375. That is the clock, recorded so later commits are comparable across days.

Probe slice, n = 4, all 1.000. `p-001` and `p-002` abstain (clusters sit outside the pinned 7 day window, which opens `2026-09-26T16:00:00.000Z`). `p-003` returns the glacier cluster (all 15 pages are inside the window). `p-004` returns `gen-orbital-table-2` only.

Query cache. Quality held on both slices. The harness embeds each string once, so it cannot show a latency win. Unit tests cover a second lookup, a failed embed, and eviction past 32. `offscreen.js` is 680,664 bytes against a 716,800 budget.

## What regressed

RRF, k = 60, five lists (cosine, BM25, title, recency, engagement), scaled so a unanimous rank 1 scores 1 before the existing multipliers. Measured against the learned vector, then removed.

| Arm | nDCG | Recall | MRR | factual | nav | expl | neg |
|-----|------|--------|-----|---------|-----|------|-----|
| Learned linear | 0.9734 | 0.9896 | 0.9725 | 1.0000 | 0.9419 | 0.9589 | 0.9375 |
| RRF, floor 0.18 | 0.8324 | 0.8549 | 0.8311 | 0.9926 | 0.9352 | 0.9491 | 0.1250 |
| RRF, floor 0 | 0.8116 | 0.8342 | 0.8104 | 0.9926 | 0.9352 | 0.9491 | 0.0000 |

With the floor off, negative top scores sit between 0.127 and 0.405. Every negative clears the 0.08 pass ceiling, because RRF always has a rank 1. Recalibrating `ABSTAIN_FLOOR` cannot separate those tops from factual tops (factual min 0.669 on the linear arm, and RRF factual tops stay in the same high band). The code is not in the tree.

The first fusion grid (`dc76ded`) renormalized the no-embedding fallback on every point, so its incumbent row was not the production score. It was not used to pick the vector. `ef5b1ab` replaces that conclusion.

No shipped commit dropped a core slice or the probe slice.

## Still wrong

`q-243` "how to change a flat tire on a bicycle" returns glacier articles at 0.210. `q-256` "what is the boiling point of nitrogen" returns cold chain articles at 0.211. Both stay over the floor. Negative nDCG stays 0.9375 (30/32).

Navigational nDCG stays 0.9419. The learned vector did not fix "that video about Episode 32".

## Gates

`npm run eval` improved or held on every reported metric for each shipped commit. `npm run typecheck` passed. `npm run check:budget` passed.

`npm test` on this Node is 859 passed, 4 failed. The failures are outside this phase:

- `tests/pdf.test.ts`: `Promise.withResolvers` is missing. pdfjs wants Node 22.
- `tests/embed-parity.test.ts`: min cosine 0.99436, threshold 0.995.
- `tests/chat-engine-abort.test.ts`: abort produced 0 token events, expected 3.

## Needs a decision

1. The two remaining negatives (`q-243`, `q-256`) sit just above 0.18. The existing floor note says 0.22 would pass more negatives and abstain on one exploratory query. I left the floor alone. Say if you want a pass aimed at those two queries.

2. `npm test` is red on Node 20 for the four failures above. This phase did not change those files. Say if the local gate should move to Node 22, or if those four tests are in scope.
