# Pass 5 — retrieval / agent-chat path verification

**Date:** 2026-10-02 16:04 EDT (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Node:** v20.19.2  
**Constraints:** No push/commit. No edits to `search-engine` / `ranking` / `query-relevance` / `query-parse` / `similarity`. OOS failures not “fixed.”

**Overall:** **PASS**

---

## Scope

Verify that Cortex **retrieval** and **agent/chat (Ask)** paths still work after Pass 3/4 changes:

1. Identify unit tests covering retrieval, chat/ask, ranking integration, Assist Sync sheet Questions, overlay Ask surfaces.
2. Run those tests (exclude known OOS: pdf `Promise.withResolvers`, embed-parity cosine, chat-engine-abort token count).
3. Run `npm run typecheck`.
4. Record pass/fail here. Fix only real Pass 3/4 regressions outside forbidden files.

---

## Gate table

| # | Gate | Command | Result | Detail |
|---|------|---------|--------|--------|
| 1 | Identified suite | See “Tests identified” below | **PASS** | 34 files / 289 tests curated |
| 2 | Unit tests (scoped) | `npx vitest run` on curated file list | **PASS** | **34/34 files, 289/289 tests** (~3.0s) |
| 3 | Eval harness | `npm run eval:test` | **PASS** | **5/5 files, 13/13 tests** |
| 4 | Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** | exit 0 |
| 5 | Forbidden sources | `git status` on ranking/search/query/similarity | **PASS** | **unchanged** (no edits this pass) |

**Product regressions found:** **none**. No code fixes applied.

---

## Tests identified

### Retrieval

| File | Role |
|------|------|
| `src/lib/search-engine.test.ts` | `runAdvancedSearch` fusion, BM25/semantic, abstain, kinds, highlights, collection scope, recency clock |
| `tests/eval/search-eval.test.ts` | Synthetic corpus pass-rate gate over search engine |
| `tests/recall.test.ts` | Recall query parse + answer build (“what did I see…”) |
| `tests/query-embed-cache.test.ts` | Session query-embedding cache |
| `tests/omnibox.test.ts` | Omnibox suggestion formatting / URL resolve from hits |
| `tests/person-forwarding.test.ts` | Person intent forwarding into Ask/search path |

### Chat / Ask (agent paths)

| File | Role |
|------|------|
| `tests/chat-engine-recall.test.ts` | Ask recall path (visit record, no passage search) |
| `tests/chat-engine-people.test.ts` | Ask people store + collection id → retrieval |
| `tests/chat-context.test.ts` | Chat context wiring |
| `tests/chat-drawer.test.ts` | Ask drawer UI helpers |
| `tests/chat-history.test.ts` | Conversation history groups / search |
| `tests/chat-run-registry.test.ts` | Concurrent chat run registry |
| `tests/chat-stream-controller.test.ts` | Stream lifecycle for Ask |
| `src/lib/chat/context-builder.test.ts` | Chunk budget + evidence expansion for RAG prompt |
| `src/lib/chat/llm-router.test.ts` | Nano / Gemini routing + abort |
| `tests/citation-cards.test.ts` | Citation cards from Ask sources |
| `tests/stream-renderer.test.ts` | Token stream rendering |
| `tests/example-prompts.test.ts` | Empty-library Ask prompts |
| `tests/gemini-client.test.ts` | Cloud Ask client |
| `tests/nano-client.test.ts` | On-device Ask client |

**Excluded (OOS, Pass 4):** `tests/chat-engine-abort.test.ts` (token-count before abort).

### Ranking integration

| File | Role |
|------|------|
| `tests/ranking-clock.test.ts` | `recencyBoost` + `parseAskQuery` injected clock |
| `tests/kind-intent.test.ts` | Kind/person intent → ranking boosts |
| `tests/query-relevance.test.ts` | Relevance / confidence tier grounding |
| *(also)* `src/lib/search-engine.test.ts` | End-to-end ranking behaviors via search |

Sources under C-3 (`ranking.ts`, `query-relevance.ts`, …) were **exercised by tests only**, not edited.

### Assist Sync — sheet Questions

| File | Role |
|------|------|
| `tests/assistant-sync-drive.test.ts` | Sheet layout: About **Questions** section, LinkedIn sample Q, schema_version 3, JSON backup note |
| `tests/assistant-sync-engine.test.ts` | Sync tick rewrites About with **Questions** + schema_version 3 |
| `tests/assistant-sync.test.ts` | Capture / redact / topics / LinkedIn sync inputs to sheet |
| `tests/assistant-sync-options.test.ts` | Options UI (About / Assist Sync) |

### Overlay Ask surfaces

| File | Role |
|------|------|
| `tests/overlay-host.test.ts` | Overlay host modifier (centred / docked / shell) |
| `tests/overlay-injector.test.ts` | Inject `overlay.js` delivery path |
| `tests/open-cortex-search.test.ts` | Open Ask/search: overlay vs side-panel routing |
| `tests/panel-mode.test.ts` | Panel preference / host rules for overlay Ask |
| `tests/scope-bar.test.ts` | Ask scope bar |
| `tests/shell-routing.test.ts` | Search-shell routing |
| `tests/search-shell-error.test.ts` | Search-shell error surface |

**Not run:** Playwright e2e (`e2e/answers.spec.ts`, `e2e/overlay.spec.ts`, `e2e/recall.spec.ts`) — browser e2e outside this unit verification gate.

### Counts (this run)

| Category | Files | Tests |
|----------|------:|------:|
| Retrieval | 6 | 40 |
| Chat / Ask | 14 | 77 |
| Ranking integration | 3 | 14 |
| Assist Sync (incl. sheet Questions) | 4 | 34 |
| Overlay Ask surfaces | 7 | 124 |
| **Total curated** | **34** | **289** |

*(chat-engine-recall counted under Chat/Ask; search-engine under Retrieval.)*

---

## Out of scope (excluded from this gate)

Same as Pass 4 — **not re-run as pass criteria**, not fixed:

| File | Issue |
|------|--------|
| `tests/pdf.test.ts` (×2) | `Promise.withResolvers` missing on Node 20 Vitest host |
| `tests/embed-parity.test.ts` (×1) | Cosine below snapshot floor after transformers migration |
| `tests/chat-engine-abort.test.ts` (×1) | Expects 3 `token` events before abort; harness yields 0 |

---

## Forbidden files

Confirmed **not modified** this pass:

- `src/lib/search-engine.ts`
- `src/lib/ranking.ts`
- `src/lib/query-relevance.ts`
- `src/lib/query-parse.ts`
- `src/lib/similarity.ts`

---

## Failures / fixes

**None.** All curated retrieval / chat / ranking / Assist Sync / overlay tests passed. Typecheck passed. Eval unit suite passed.

No Pass 3/4 regression signal requiring a code fix outside (or inside) the forbidden ranking/search files.

---

## Constraints honored

- No git push / commit
- No edits to search-engine / ranking / query-relevance / query-parse / similarity
- OOS tests excluded from the gate (not “fixed”)
- Report written only under `docs/enterprise-audit/pass5-retrieval-verify.md`
