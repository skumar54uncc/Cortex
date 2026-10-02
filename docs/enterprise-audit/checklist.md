# Cortex enterprise audit — final verification checklist

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Baseline commit audited:** `2f0ef75`  
**Working tree:** Pass 3 (privacy + UI/product) + Pass 4 security fixes present, uncommitted.
**Pass 4 doc:** `pass4-security.md`  
**Authority:** Every item from `docs/enterprise-audit/audit.md` listed below as **fixed** or **deferred**.  
**Done docs:** `pass3-privacy-done.md`, `pass3-ui-product-done.md`, `pass4-content-done.md`

---

## Verification (gates)

| Gate | Result | Detail |
|------|--------|--------|
| `npm run typecheck` | **PASS** | `tsc --noEmit` exit 0 |
| Assistant Sync tests | **PASS** | `npx vitest run tests/assistant-sync.test.ts tests/assistant-sync-engine.test.ts tests/assistant-sync-drive.test.ts tests/assistant-sync-options.test.ts` → **4 files / 34 tests passed** |
| `npm run check:budget` | **PASS** | After `npm run build`; all budgets ok |
| `config/oauth-clients.json` `release` | **Empty (intentional)** | `"release": ""` unchanged |
| `npm run build:store` | **Refuses (intentional pass)** | Throws: `Release OAuth client id is empty. Put the Chrome Web Store OAuth client id in config/oauth-clients.json under "release"...` |

### SW / key bundle sizes (`npm run check:budget`)

| Bundle | Bytes | Budget |
|--------|------:|-------:|
| service-worker.js | **223450** | 225280 |
| content.js | 6349 | 15360 |
| overlay.js | 131445 | 143360 |
| offscreen.js | 689439 | 716800 |
| assistant-sync.js | 40146 | 49152 |
| assistant-sync-topics.js | 23026 | 49152 |
| assistant-sync-capture.js | 4219 | 16384 |
| assistant-sync-options.js | 3366 | 16384 |
| options.js | 26920 | 40960 |
| popup.js | 6525 | 20480 |
| onboarding.js | 2174 | 10240 |

Full check output: all listed budgets **ok**; “Bundle budget check passed”.

---

## Blocker (1)

| ID | Status | How / pointer |
|----|--------|---------------|
| **B-1** Release-pack privacy practices omit Drive sync / identity | **fixed** | Rewrote `docs/release-1.2.0/STORE_RELEASE.md` + `PERMISSIONS.md` to match shipped Assist Sync (`identity`, `drive.file`, Enable-gated, Cortex Memory) + Gemini. See `pass3-privacy-done.md`. |

---

## Store-review risks (8)

| ID | Status | How / pointer |
|----|--------|---------------|
| **SR-1** History / indexing before affirmative consent | **fixed** | `INDEXING_CONSENT_KEY`; install no longer auto-runs backfill; welcome **Start indexing** + Settings grant consent. `pass3-privacy-done.md`. |
| **SR-2** Missing Limited Use affirmative statement | **fixed** | Sentence added to `docs/privacy-policy.html` + `docs/PRIVACY_POLICY.md`. |
| **SR-3** Broad install-time hosts + content scripts | **fixed** (hosts kept; justifications hardened) | Release pack + store-listing + privacy + in-product consent/sticky disclosure. Broad hosts retained as intentional core indexing design. |
| **SR-4** Privacy “draft” + disclosure gaps | **fixed** | Dropped “(draft)”; documented consent-gated history, `incognito: not_allowed`, Drive work only while sync enabled. |
| **SR-5** PERMISSIONS.md denies `identity` | **fixed** | Real `identity` row (Enable-only interactive auth; silent thereafter; `drive.file` only). Folded with B-1. |
| **SR-6** Popup blurb omits Assist Sync / Drive | **fixed** | Assist Sync / Cortex Memory / `drive.file` sentence + narrowed network wording (`pass3-privacy-done.md`; with U-4). |
| **SR-7** Single-purpose stretch if listing omits sync | **fixed** | STORE_RELEASE detailed description + store-listing one-memory narrative (Assist Sync + Gemini as features). |
| **SR-8** Popup privacy disclosure dismissible / not sticky | **fixed** | Always-visible `#cx-privacy-sticky`; long blurb still dismissible. |

---

## User-facing defects (9)

| ID | Status | How / pointer |
|----|--------|---------------|
| **U-1** Assist Sync Enable but no Disable | **fixed** | `#cx-assistant-disable`; bus action `disable` → `syncEnabled: false`; leaves Drive files. `pass3-ui-product-done.md`. |
| **U-2** Docs say user-started history; code auto-ran | **fixed** | Same product gate as SR-1; public copy aligned. |
| **U-3** Sync now while Off | **fixed** | Button disabled/titled when off; SW rejects `now` when disabled. |
| **U-4** “Live indexing uses no network” over-read | **fixed** | Narrowed with SR-6: embeddings/index on device; network for history/PDF URL fetch and user-enabled Drive/Gemini. |
| **U-5** Triple design-token sources | **fixed** | Options bridges to `cortex-theme.css`; accent/surfaces aligned; overlay via `theme.ts` bridge documented. |
| **U-6** Button primitives redefined three ways | **fixed** | Shared `src/styles/cx-buttons.css` on options / popup / onboarding. |
| **U-7** Type scale not shared | **fixed** | Named scale; options aliases; overlay gets `--cx-ts-*` via `themeTokensCss()`. |
| **U-8** Popup controls missing `:focus-visible` | **fixed** | Privacy ack + link buttons share focus ring with buttons. |
| **U-9** Empty-state language inconsistent | **fixed** | Shared `src/shared/empty-copy.ts` across popup / Library / overlay Ask / search / digest. |

---

## Pass 3 product gaps (4)

| # | Gap | Status | How / pointer |
|---|-----|--------|---------------|
| 14 | People/Companies backfill on next sync | **fixed** | `seedPeopleFromLibrary` on sync ticks. `pass3-ui-product-done.md`. |
| 15 | Index-time LinkedIn fields + delayed sync | **fixed** | `linkedInFields` on capture; one-shot ~2 min soon alarm; 15-min backstop; no Google on every page. |
| 16 | Questions section on About (schema_version 3) | **fixed** | About Questions section; stays on schema_version 3. |
| 17 | Drive JSON backup as separate file | **fixed** | `Cortex Memory Backup.json` via `upsertJsonFile`; About tells assistant not to read it. |

---

## Polish (13) — P-1/P-4 fixed in Pass 4; remainder deferred

| ID | Status | Reason |
|----|--------|--------|
| **P-1** `agent-debug-log` localhost ingest URL | **fixed** | Pass 4: `agent-debug-log.ts` is a pure noop — no localhost URL / `fetch` in shipped source. See `pass4-security.md` S-7. |
| **P-2** Options Assist Sync consent omits naming `drive.file` | **fixed** | Consent names `drive.file` and folder limit. See `pass4-content-done.md`. |
| **P-3** Assist Sync alarm registered when sync off | **deferred** | Handler no-ops when disabled; intentional architecture note in privacy docs. |
| **P-4** YouTube caption fetch `credentials: "include"` | **fixed** | Pass 4: `youtube-capture.ts` uses `credentials: "omit"` (validated timedtext URL; DOM panel fallback). See `pass4-security.md` S-8. |
| **P-5** Dual listing docs drift | **fixed** | `store-listing.md` aligned to `STORE_RELEASE.md` single purpose, listing copy, permissions; cross-ref added. |
| **P-6** Popup refresh text glyph `↻` | **fixed** | Plain text **Refresh** control. |
| **P-7** Popup storage bar marketing gradient | **fixed** | Solid `--cx-accent`; removed `#ea580c` gradient. |
| **P-8** Popup primary hero shadow / larger CTA | **fixed** | Dropped `cx-btn-hero`; shared `cx-btn-primary` only. |
| **P-9** “Connect with your AI assistant” promotional title | **fixed** | Renamed to **Assist Sync** (nav, H2, popup CTA); guides retitled. |
| **P-10** Axe gate covers load/happy paths only | **deferred** | Deeper axe scenarios later; idle gate kept. |
| **P-11** Popup lacks `prefers-reduced-motion` | **fixed** | Reduce media query on storage bar transition / busy state. |
| **P-12** Appearance copy could state Settings stays light | **fixed** | Appearance sec-desc + `UI_DECISIONS.md` state Settings/popup stay light. |
| **P-13** Overlay / options one-off `em` font sizes | **fixed** | Citation/code/onboarding mapped to type scale px tokens; options already on named scale. |

---

## Intentional constraints / non-findings (do not “fix”)

| ID / topic | Status | Reason |
|------------|--------|--------|
| **C-1** `config/oauth-clients.json` `release` empty; `build:store` refuses | **deferred (intentional constraint)** | Operator/secrets step outside this pass. Filling release would invent a client id or force item id / public key change — forbidden. Refusal is the safety latch. Verified still empty; `build:store` still throws. |
| **C-2** No backend / account / analytics / new dependency | **deferred (intentional)** | No finding required a new dependency; stack unchanged. |
| **C-3** No search / ranking / query-* / similarity edits | **deferred (intentional)** | Out of audit scope; those files not modified for audit fixes. |
| OAuth item id / public `key` unchanged | **deferred (intentional)** | Hard constraint; not touched. |
| Excerpts only after real ≥5-minute read; dwell blank until measured | **deferred (intentional privacy limit)** | Do not invent dwell/excerpts. |
| No Cortex server; sync default off; interactive token only from Enable | **deferred (intentional)** | Architecture preserved. |
| Scope `drive.file` only | **deferred (intentional / good)** | Unchanged. |
| `incognito: "not_allowed"` | **deferred (intentional privacy posture)** | Documented in privacy fix; not changed. |
| Google fetches stay in assistant-sync chunk (offscreen) | **deferred (intentional architecture)** | Preserved in Track B. |
| Local JSON/Markdown backup only (disk); Assist Sync is Drive path | **deferred (intentional)** | Product gap 17 adds separate Drive JSON backup file alongside live sheet. |
| Remote ML / CDN closed; WAR minimized | **deferred (intentional / good)** | Unchanged. |
| Out-of-scope failing tests (`pdf` Promise.withResolvers, `embed-parity` cosine, `chat-engine-abort` token count) | **deferred (out of scope)** | Not run as gates; do not “fix” by inventing behavior. |
| Broad hosts as core indexing design | **deferred (intentional design)** | Justified (SR-3); not removed as a faux enterprise gap. |
| Options page light-only; skeleton gradients; no em dashes / emoji status / placeholder marketing in Settings | **deferred (intentional / non-finding)** | Quality bar already met or intentional. |

---

## Not enterprise-ready claims

This checklist does **not** claim the product is “enterprise-ready,” CWS-approved, or ready for store upload beyond what the gates above prove:

- Typecheck, the 34 Assistant Sync unit tests, and bundle budgets passed on the current working tree.
- Privacy/consent/docs and UI/product Pass 3 queue items are marked **fixed** or **deferred** as listed. Pass 4 security fixed P-1, P-4, S-1, S-3 (see `pass4-security.md`); remaining polish/intentional items stay deferred/open as listed.
- **`npm run build:store` correctly refuses** while `release` OAuth is empty — that is required safety behavior, not a ship gate pass. A real store pack still needs an authorized human to supply the existing CWS-bound client id (without changing item id / public key), then re-run store build and CWS submission steps outside this audit.
- No push, PR, or git-config changes were made in this verification pass. Eval files were not edited. `config/oauth-clients.json` `release` was not filled.

---

## Pass 4 security (2026-10-02)

| ID | Status | Notes |
|----|--------|-------|
| **S-1** History import without options sender | **fixed** | Options-only start/cancel; enable Assist Sync options-only |
| **S-3** Settings `...raw` spread | **fixed** | Whitelist normalizeSettings |
| **P-1** / **S-7** agent-debug localhost URL | **fixed** | See polish table |
| **P-4** / **S-8** YouTube credentials include | **fixed** | See polish table |
| **S-2** Gemini key in storage + content scripts | **fixed** | Secret store + session TRUSTED; see `pass4-security-s2.md` |
| **S-4** Broad hosts | **open (intentional)** | Same as SR-3 design |
| Other Low (S-5/S-6/S-9/S-10) | **open** | See `pass4-security.md` |

*End of final verification checklist. Path: `docs/enterprise-audit/checklist.md`.*
