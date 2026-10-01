# Phase 1: Retrieval audit

No ranker changes. Fresh harness run on 2026-10-01, then hand-built probes against the same 160 page corpus.

Machine: macOS, Node v20.19.4. Model: `Xenova/all-MiniLM-L6-v2`, `onnx/model_quantized.onnx` at 22,972,370 bytes. Index: 160 docs, 490 chunks (180/40). Embed cache was empty at the start of the run (`cacheMode: cold`). Run id `2026-10-01T05:13:34.651Z`.

`src/lib/search-engine.ts` last changed in `5440e6c` (Phase 5.4), before the committed baseline. The metric move versus `eval/results/baseline.json` (2026-09-18) is the clock, not a code change. `recencyBoost` calls `Date.now()`.

## Baseline this morning

```
nDCG@10      Recall@10    MRR@10       Neg pass     n
factual
100.0%       100.0%       100.0%       100.0%       100
navigational
94.2%        100.0%       92.4%        100.0%       37
exploratory
65.2%        100.0%       61.2%        100.0%       24
negative
90.6%        90.6%        90.6%        90.6%        32
overall
93.0%        98.4%        92.2%        90.6%        193
```

Latency on this machine: p50 32.0 ms, p95 40.3 ms, p99 46.9 ms. The committed baseline p95 is 94.7 ms from a Windows Node 22 run. Do not read the latency delta as a retrieval improvement. The CI gate compares absolute p95, so a faster machine false-passes it.

Diff versus the committed baseline:

```
nDCG@10 (overall)            0.9161 -> 0.9300 (+0.0139)
Recall@10 (overall)          0.9741 -> 0.9845
MRR@10 (overall)             0.9074 -> 0.9216
p95 latency ms               94.7 -> 40.3
nDCG@10 (factual)            0.9963 -> 1.0000
nDCG@10 (navigational)       0.9362 -> 0.9419
nDCG@10 (exploratory)        0.6475 -> 0.6517
nDCG@10 (negative)           0.8438 -> 0.9063
```

Seven queries moved. Two negatives that failed on 18 September now abstain, because their top score fell under `ABSTAIN_FLOOR` (0.18) as the pages aged: "best time of year to plant tomatoes" (0.198 to no hit) and "history of the printing press" (0.217 to no hit). One factual tie flipped to perfect ("gardworto Mini 9 price rating table", 0.631 to 1.000). The floor was calibrated on 18 September. It is not stable across weeks.

Recall@10 in this harness is "at least one relevant doc in the top 10", not graded recall. Every positive query already has Recall@10 of 1. Headroom is rank, not "did we find anything".

## What is already fine

Probes run through `runAdvancedSearch` on a freshly indexed copy of `eval/corpus/pages.jsonl`.

| Probe | Top hit | Verdict |
| --- | --- | --- |
| `Ezra Vasquez` | `gen-bees-profile-1` at 0.782 | exact name works |
| pasted LinkedIn URL for that profile | same doc at 0.746 | URL works, because the name tokens are in the body and `linkedin` sets `preferLinkedIn` |
| `Apitrak` | same profile at 0.482 | one distinctive token works |
| `Episode 32` | `gen-synth-transcript-2` at 0.793 | number alone works |
| `createTorvelixClient` | `gen-orbital-docs-1` at 0.670, one hit | exact identifier works |
| `Ostara` | `gen-synth-article-4` at 0.589 | works |
| "startup raised money to expand shipping cargo into orbit" | both orbital news pages at ranks 1 and 2 | paraphrase works when content words still overlap the theme |
| "linkedin page for the lead researcher who works on hive sensors" | the right profile at 0.509 | works, because the query contains `linkedin` and `who works` |
| `career` | abstain | the word is on `GENERIC_QUERY_TERMS` and occurs in 0 pages |
| `career at Apitrak` | the profile at 0.367 | a generic word plus one rare token still works |
| `glacier monitoring drones yesterday` | 4 hits, all captured on 30 September, evidence says the date window was applied | the window works when the topic was actually visited then |

Exact lookup is not the problem. Short queries are not the problem when the token is rare.

## Weakness 1: "people who work in X" ranks news above profiles

Ten exploratory queries, one per cluster. Mean nDCG@10 0.297. Mean MRR@10 0.119 (first profile around rank 8 to 10). The other 14 exploratory queries, mostly "{theme} overview", have mean nDCG@10 0.952 and MRR@10 1.000. Drop the ten people queries and the exploratory slice is 0.905, not 0.652. This slice is almost the entire gap versus factual (1.000).

Example, "people who work in urban beekeeping sensors". Relevant docs are the three LinkedIn profiles. Top of the list:

```
#1 1.048 gen-bees-news-2
#2 1.024 gen-bees-news-1
#3 0.838 gen-bees-article-2
```

First profile is rank 9. `detectKindIntent` sets `person: true` for this query (`PERSON_RE` matches "people"). Nothing in `runAdvancedSearch` reads that flag. `kindBoost` only scales chunk kinds, and profiles are stored as `text`. `parseAskQuery` sets `preferLinkedIn` only for `who works` (with an s), `profile`, `linkedin`, `employee`. "people who work in" matches none of those. News pages in the same cluster contain the theme and the sentence "now employs N people", so both BM25 and the embedding prefer them.

A cross-encoder might also fix this. A 1.25 boost on `linkedin.com` when `person` is already true would fix rank 1 directly. That flag is dead code today.

## Weakness 2: the date window runs after the abstain floor

`ABSTAIN_FLOOR` is applied to the best score in the unfiltered list. The visit-log window is applied later. If anything inside the window still clears the adaptive cutoff, those rows are returned even when their scores are far under 0.18.

Probe: "orbital cargo logistics last week". Orbital pages were captured 1 to 4 September, outside the 7 day window. Result: 10 hits, all recent glacier pages, top score 0.092, and the evidence line "Filtered to the visits in your date window." The search did not abstain and did not relax. The cutoff was set from the strong out-of-window orbital hit (`cutoff = max(0.028, min(0.26, topScore * 0.072))`), so weak in-window pages survived.

Probe: "what did I read today" returns `gen-glacier-docs-1` at 0.046. Same order bug. The visit-record answer path for "what did I see today" is a different code path and was not scored here.

`recencyBoost` (half-life 18 days) also makes the official metrics date-dependent, as the seven moved queries show. Engagement cannot compensate: every eval doc is inserted once, so `importanceScore` is 0.12 on all 160 pages. The 0.16 engagement weight in `fuseRankScore` is a constant on this corpus. It cannot change order.

## Weakness 3: generic tokens and diluted navigational queries

Three official negatives still return hits:

| Query | Top score | Top doc | Why it sticks |
| --- | --- | --- | --- |
| how to change a flat tire on a bicycle | 0.219 | a glacier article from 29 September | every article title contains "changed". Grounding uses `String.includes`, so the query token "change" counts as found. "how" is in every title. Recency picks the newest articles. |
| what is the boiling point of nitrogen | 0.217 | a cold-chain article | temperature language in that cluster. Score sits just above 0.18. |
| sql join types inner left right full | 0.182 | a sign-language transcript | "left" and "right" occur in signing pages. Just above the floor. |

`report` occurs on 46 pages and is not in `GENERIC_QUERY_TERMS` (`career` is). The one-word query "report" does not abstain. Top hit is a recent tidal transcript at 0.376, then other recent pages. There is no right document. The list is recency among pages that contain a common verb.

"that video about Episode 32" is an official navigational query. The bare query "Episode 32" ranks the right transcript first (0.793 vs 0.603). The longer query ranks `gen-tidal-transcript-2` first at 0.519. "video" matches "(video transcript)" on every transcript, `kindBoost` multiplies every transcript by 1.25, and "32" also appears inside timestamps, so the episode number is a weak IDF token. Recency then picks a newer transcript. "that video about Episode 80" fails the same way (right doc at rank 2, nDCG 0.631).

Abstract paraphrase with no shared content words fails closed. "method that narrows options by bucket identifier before word overlap" (the quantum sieve page, with the floor disabled) has top score 0.162 on a glacier article and the first relevant doc at rank 8. With the production floor it abstains. MiniLM did bridge "shipping cargo into orbit" to "orbital cargo logistics". It did not bridge this wording. Factual nDCG is already 1.000 because those queries copy anchor nouns out of the page.

## Harness defect, not a ranker target

Two navigational queries are the identical string "that page about Photo essay" with different relevant ids (`gen-bees-image-1` and `gen-glacier-image-1`). The title stem is shared by every image page. The generator splits titles on `:`. One ranking cannot put both pages at rank 1. Do not tune weights to chase either label.

## Not measured

WASM latency inside the extension. This run is onnxruntime on Node. Single-thread WASM in the offscreen document is slower. Phase 1 of release 1.2.0 records that extension pages are not cross-origin isolated, so the WASM runtime stays single-threaded.

No technique from the proposal list was implemented in this phase.
