# Phase 2: Technique ranking

No code changes. Ranking is expected movement on this corpus divided by implementation cost and by runtime cost on the MV3 offscreen document. Expected movement is an estimate from the Phase 1 failures. Nothing below has been implemented, so none of the gains are measured.

The official headroom is small and concentrated. Factual nDCG@10 is 1.000 (100 queries). Recall@10 is 1.000 on every positive query. Exploratory nDCG@10 is 0.652, and 0.905 without the ten "people who work in X" queries. Three negatives still clear the floor. Two "Episode N" navigational queries rank the wrong transcript.

`check:budget` covers JS bundles only. `offscreen.js` is budgeted at 700 KB and was 639,632 bytes at release 1.2.0. Model files in `dist/models/` are not in that script. A worse embedder can ship without failing `check:budget` and still blow up the zip (1.2.0 zip was 21,213,717 bytes, dominated by the 14 MB WASM and this 23 MB ONNX file).

Privacy bar for every row: weights and queries stay on device, no network at retrieval time, incognito and blocklist gates untouched. All nine techniques can meet that bar if the weights are bundled. HyDE meets it only when the hypothetical answer is produced by the on-device model. It does not meet it if the hypothetical answer comes from Gemini.

## Off the list, higher leverage

These are not in the requested nine. They dominate the measured failures. They are listed first so the ranking of the nine is not mistaken for the best next commit.

1. Read the `person` flag that `detectKindIntent` already sets, and boost `linkedin.com` pages when it is true. Also treat "who work" like "who works" inside `preferLinkedIn`. Targets weakness 1. Expected exploratory nDCG from about 0.65 to about 0.90 if those ten queries move from mean nDCG 0.30 to about 0.90, which is roughly +0.03 overall nDCG. Implementation is a few lines plus the existing kind-intent tests. Runtime is one URL check. Risk: a query that says "people" and wants the news article about hiring gets the profiles instead. That is the labeled behavior of the current eval.

2. Apply the visit-log window before the abstain floor. If the best in-window score is under 0.18, abstain, or relax and say so. Today "orbital cargo logistics last week" returns glacier pages at 0.09. The current 193 queries contain no "last week" cases, so this fix will not move the official table until new queries are added.

3. Freeze the eval clock. `recencyBoost(Date.now())` moved seven queries between 18 September and 1 October, including two negatives across the floor. Until the harness pins "now" (latest `captured_at` is a reasonable pin), a technique cannot be blamed or credited for a 0.01 nDCG move.

## The nine, ranked

### 1. Learned fusion weights

Grid-search the `fuseRankScore` coefficients on the eval corpus. Keep the same four terms (cosine, lexical blend, recency, engagement) so the result stays readable.

Why it might help: engagement is 0.12 on every page here, so its 0.16 weight is a constant and only compresses scores toward the floor. Recency is the signal that picks a newer transcript over "Episode 32" once the title match has been diluted, and it is why negatives drift across 0.18 as weeks pass. A grid can shrink those two weights and give the rest to cosine and BM25.

Why it might not: on the people queries, BM25 and cosine already agree that news outranks profiles. Reweighting will not flip them. Factual is saturated, so the grid can only lose there.

Expected official gain: small, maybe one point of overall nDCG, concentrated in the two episode queries and the three negatives. Zero if the grid's best vector is the current one.

Cost: an offline script, then four constants. No extra bytes. No extra latency. Must recalibrate `ABSTAIN_FLOOR` if the score scale moves, using `eval/src/calibrate-abstain.ts`, and write the chosen vector down.

Fits privacy. Do this, on a frozen clock, as the first on-list experiment.

### 2. Reciprocal rank fusion

Replace the linear blend with RRF over the BM25 order, the cosine order, and a recency order. Standard k is 60.

Why it might help: the linear weights are hand set, and min-max BM25 plus a multiplier from `relevanceMultiplier` (up to 1.35, plus domain bonus) makes the fused number hard to interpret. RRF ignores those scales.

Why it might not: RRF of two lists that both put news first still puts news first. It does not fix weakness 1. A recency list inside RRF keeps the date dependence from weakness 2. k=60 also flattens the top of a 160 doc collection, which can hurt MRR on factual queries that are currently perfect.

Expected official gain: about zero, with a real chance of a factual regression. Worth one commit because the code is small. Revert if any reported metric drops.

Cost: small. Runtime is a sort of doc ids we already have. No bundle growth. Privacy: fine.

### 3. MMR

After fusion, greedily pick hits while penalizing chunks that are near-duplicates of hits already chosen. The people queries are the motivating case: two news pages occupy ranks 1 and 2 and the profiles sit at rank 9.

Why it might help: within a cluster, news articles are near-copies. MMR can spend ranks 2 to 5 on a profile and a docs page. That raises nDCG on the ten people queries without fixing rank 1, so MRR stays bad. Overview queries are already at mean nDCG 0.95, so the leftover gain is small.

Why it might not: if rank 1 is the wrong type, MMR that preserves rank 1 does not fix the user-visible first hit. Applying MMR before the person boost double-counts the same failure. Run it only after that boost, or instead of it, not both unmeasured.

Cost: small. Runtime is pairwise cosine among the top 30 docs, negligible next to the full chunk scan. No bundle growth. Privacy: fine. Needs a lambda written down. Diversifying across documents is the right unit. The search response is already one hit per document.

### 4. Query embedding cache

Cache the query vector for the normalized string inside the offscreen document, for the lifetime of that document.

Quality: unchanged. The eval runs each string once, so p95 will not move. Repeated searches and Ask retries skip a WASM forward pass. Node p95 is already 40 ms for the whole call, so the user-visible win is on a cold WASM inference, which this audit did not time.

Cost: a bounded `Map`. No disk. No bundle growth. Privacy: fine, the cache dies with the offscreen document and holds query text the user just typed. Do it only as a hold-quality commit. It is not a retrieval improvement.

### 5. BM25 pseudo-relevance feedback (RM3)

Take terms from the top hits and run BM25 again.

Why it looks attractive: vocabulary mismatch, as in the sieve paraphrase that abstains.

Why it fails here: the first pass is wrong on the failures we actually have. People queries would expand from news copy and push profiles further down. The sieve paraphrase's top hit is a glacier article, so RM3 would expand glacier terms. Factual queries are already perfect, so expansion can only add noise.

Expected official result: a regression. Cost is moderate (second pass over the chunk table, latency near 2x). Privacy: fine. Do not implement unless a later probe set shows first-pass hits that are relevant but term-poor. That is not this corpus.

### 6. Cross-encoder rerank

Rerank the top 20 to 30 fused docs with a MiniLM cross-encoder (query and passage together), bundled the same way as the bi-encoder.

What it would fix: weakness 1 is exactly a cross-encoder job (does this page answer "who works here", or does it merely share the topic). The three negatives and the sieve paraphrase are the other candidates. Factual cannot improve.

Cost: a second ONNX file. `Xenova/ms-marco-MiniLM-L-6-v2` is the same 6-layer MiniLM class as the current embedder. Budget another ~23 MB in the zip. `check:budget` will not notice. Memory: two models resident in the offscreen document.

Latency: not measured on WASM in this audit. The extension WASM path is single-threaded. A rerank is 20 to 30 sequential forward passes over query+passage, not one pooled query embed. Node search p95 is 40 ms. The CI latency gate is +25% against the committed p95 of 95 ms, about 119 ms. A cross-encoder will miss that gate by a wide margin. Search-as-you-type becomes a multi-second wait. I will not guess a WASM millisecond figure without a browser timing run.

Privacy: fine if bundled, `allowRemoteModels` stays false.

Decision: reject for Search. The people-query failure has a cheaper fix that uses a flag we already compute. Revisit only if that fix and the weight grid leave a measured residue, and only behind an explicit latency budget the current CI gate does not represent.

### 7. Chunking: sentence windows and proposition chunks

Current profile is 180 words, 40 overlap, chosen in release 1.2.0 phase 3 against 420/75. That comparison gained 0.2 nDCG points, tied Recall@10, and raised p95 from 73 ms to about 117 ms because the chunk count doubled (238 to 475; this run indexed 490).

The three weaknesses are document type, date-window order, and token dilution. None of them is a chunk boundary. Smaller chunks make the linear scan slower, which phase 3 already flagged for large libraries. Proposition chunking needs a segmenter. A rule-based sentence splitter is cheap. A model segmenter is another bundle.

Expected gain on the current failures: about zero. A new profile would also bump `CHUNKING_VERSION` and re-chunk stored pages. Do not run that experiment until weaknesses 1 and 2 are closed and a residual error is actually a passage that the 180-word window split apart.

### 8. Embedding model upgrade

| Model | Params | Dim | Quantized ONNX | Notes |
| --- | --- | --- | --- | --- |
| all-MiniLM-L6-v2 (shipped) | 22M | 384 | 22,972,370 bytes, measured in tree | Apache-2.0. No Matryoshka training. |
| bge-small-en-v1.5 | 33M | 384 | 34,014,426 bytes (Xenova q8) | MIT. Query instruction required. Not Matryoshka. |
| e5-small-v2 | 33M | 384 | 34,014,367 bytes (Xenova q8) | MIT. Needs `query:` and `passage:` prefixes. Not Matryoshka. |
| EmbeddingGemma 300M | 308M | 768, truncates to 512, 256, 128 | public int8 export ~310 MB, fp32 ~1.2 GB. Not downloaded here. | Gemma license, not Apache. Activations are not valid in fp16. |

Factual nDCG is 1.000. The people-query errors are lexical agreement between news and the query, which a stronger bi-encoder will often repeat, because the news page really does discuss that theme. The one probe a new model might win is the sieve paraphrase that currently abstains. That is one query.

bge and e5 are about 1.5x the current ONNX file, not 2x. `check:budget` still passes. The zip grows by about 12 MB, and every stored chunk must be re-embedded (a migration, plus a model id on the chunk, which already exists). WASM inference cost scales with the parameter count. Query embed is a small part of a 40 ms Node call. Indexing a long history is where 1.5x hurts. Prefix mistakes on e5 silently destroy quality.

EmbeddingGemma is the only candidate with a real MTEB gap and with Matryoshka dims. It is also about 14x the current weights at int8, a Gemma license, and a 768-d vector unless truncated. Single-thread WASM inference of a 300M model was not timed. It is the wrong shape for this extension. Truncating dims speeds the IndexedDB scan and does not speed the forward pass.

Decision: do not download these models and do not swap the shipped embedder. A bakeoff would re-embed 490 chunks per model to chase a saturated factual slice. Say so if you want that bakeoff anyway.

### 9. Matryoshka truncation

Only EmbeddingGemma, of the models above, was trained for it. Truncating the shipped MiniLM from 384 to 128 keeps the same forward pass and only shortens the scan. MiniLM was not trained with Matryoshka representation learning. Arbitrary truncation throws away dimensions the model uses. The scan of 490 vectors of 384 floats is not the p95 on this corpus (40 ms includes embed plus the scan). Truncation does not address any of the three weaknesses.

Decision: reject on the current model. Reject as a reason to adopt EmbeddingGemma.

### 10. HyDE

Embed a hypothetical answer instead of the query. The eval process has no generative model. Chrome's Prompt API is not available under `tsx`. Pointing HyDE at Gemini would send the query off device, which breaks the privacy model for Search. The optional Gemini path is specified to send retrieved snippets only, and this audit does not touch it.

Latency is one on-device generation before every search. That is seconds where the budget is tens of milliseconds.

Decision: reject. Unverifiable in this harness, and too slow for the search box even if a local model appears later. If it ever belongs anywhere, it belongs on Ask, behind the existing on-device model, and it would need a harness stub before anyone claims an nDCG number.

## Rejected as too heavy

ColBERT late interaction stores a vector per token. At 384 dims and ~80 tokens that is on the order of 80 times the current 1,536 bytes per chunk. A library of tens of thousands of chunks moves from hundreds of megabytes of embeddings to multiple gigabytes, and every query does a max-similarity against every token. There is no on-device path that keeps the linear scan cheaper than the bi-encoder we have. Reject.

SPLADE runs a second BERT to expand sparse terms. It is the technique that targets the sieve paraphrase. It is also a second model at index time, a second model at query time, and a reindex. The official 193 queries copy their distinctive terms from the pages, so SPLADE has almost nothing to fix once weakness 1 is handled in the ranker. Reject.

## Proposed commit order, if you approve

Each commit must pass `npm run eval` (no metric down versus the frozen baseline), `npm test`, `npm run typecheck`, and `npm run check:budget`. A regression is reverted in the same phase and written up. New queries for the fixed failures go in with the fix, reported as their own rows, so the original 193 stay comparable.

1. Pin the eval clock. Re-record `eval/results/baseline.json` only for the clock change, with the before and after pasted. No ranker edit in that commit.
2. Person intent boost. Add no new metric dependence on `Date.now()`.
3. Date window before the abstain floor, with new queries for "last week" on a topic outside the window and for "what did I read today".
4. Weight grid, documented vector, floor recalibrated if the scale moves.
5. RRF as a single experiment. Revert on any regression.
6. MMR only if weakness 1 is still visible at rank 1 after step 2.
7. Query embedding cache, quality required to hold.

Not in the queue: cross-encoder, HyDE, RM3, chunk profile change, model swap, Matryoshka, ColBERT, SPLADE.

## Decisions needed before any code

1. Are steps 1 to 3 (clock pin, person boost, date-window order) approved even though they are not in the nine? My recommendation is yes. If you want the nine only, the first commit is the weight grid, and I expect a smaller move.
2. Is skipping the bge / e5 / EmbeddingGemma bakeoff approved? My recommendation is yes.
3. New failure queries change the denominator. I will keep the original 193 as a reported slice and add the new probes beside them. Confirm that is the baseline policy you want when we re-record.
