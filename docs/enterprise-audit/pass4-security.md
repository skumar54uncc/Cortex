# Pass 4 — Security audit

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Scope:** MV3 permissions/CSP/host access, identity/OAuth, storage secrets, XSS (innerHTML), message validation, agent-debug-log, YouTube `credentials`, remote code, prototype pollution, unsafe eval.  
**Constraints honored:** no push/PR/git-config; OAuth item id / public `key` unchanged; `config/oauth-clients.json` `release` left empty; no edits to search-engine/ranking/query-*/similarity; no backend/analytics/new deps; architecture (Enable-only interactive token; silent token in SW; Google fetch in assistant-sync chunk; offscreen no `chrome.storage`; `drive.file` only; no telemetry) preserved.

---

## Summary

| Severity | Open | Fixed this pass |
|----------|-----:|----------------:|
| Critical | 0 | 0 |
| High | 0 | 1 |
| Med | 1 | 3 |
| Low | 4 | 2 |

**Fixed:** S-1 (history-import / consent message gate), S-2 (Gemini key SW/options-only), S-3 (settings raw spread), P-1 (agent-debug-log URL), P-4 (YouTube credentials).  
**Open:** S-4 (broad install-time hosts — intentional design), plus Low items below.

---

## Architecture verification (non-findings / strengths)

| Check | Result |
|-------|--------|
| Interactive `getAuthToken({ interactive: true })` | Only `options/assistant-sync-panel.ts` `driveTokenFromClick` (Enable click) |
| Silent token in SW | `silentDriveToken` → `interactive: false` for alarm / now / trash |
| Google / Drive HTTPS | `src/assistant-sync/*` via offscreen dynamic `assistant-sync` chunk; SW does not import drive-api |
| Offscreen + storage | SW reads folder/file ids and passes them on `CORTEX_ASSISTANT_SYNC_WORK`; offscreen runtime avoids `chrome.storage` |
| OAuth scope | `drive.file` only in `manifest.json` |
| Telemetry | No analytics SDK; agent-debug ingest disabled and URL removed |
| CSP | `script-src 'self' 'wasm-unsafe-eval'`; `worker-src`/`object-src` `'self'` — required for on-device ORT WASM |
| Remote ML / CDN | `allowRemoteModels` default false; bundled WASM paths |
| Shadow DOM | Overlay / resurface chip `mode: "closed"` (open only under `__CORTEX_DEBUG__` / `__CORTEX_E2E_OPEN_SHADOW__`) |
| `externally_connectable` | Absent — web origins cannot message the extension by id |
| Gemini auth | Header `x-goog-api-key` (not query `?key=`) |
| Offscreen privileged gate | `isPrivilegedExtensionSender`; sync work / backup require service-worker sender |
| WAR | Icons + fonts only; `use_dynamic_url: true` |
| XSS helpers | Overlay `esc()`; options/managed/backup prefer `textContent` / createElement (see `docs/INNERHTML_AUDIT.md`) |
| Unsafe eval | No `eval` / `new Function` in `src/`; CSP blocks remote script |
| YouTube timedtext URL | `captionJson3Url` allows only `https` + youtube host + `/api/timedtext` |

---

## Findings

### S-1 — High — **FIXED** — History import / consent from any content-script sender

- **Title:** `CORTEX_HISTORY_IMPORT_START` granted indexing consent and started history fetch without an options-page sender check  
- **Path(s):** `src/background/service-worker.ts`  
- **Evidence:** Handler rate-limited only; called `grantIndexingConsent()` then `runHistoryImportJob`. Content scripts on attacker pages share the extension message bus (no `externally_connectable` needed).  
- **Impact:** Malicious or buggy content-script path could flip consent and pull history URLs / page bodies into the index without Settings UI.  
- **Fix:** Require `isOptionsPageSender(sender)` for `CORTEX_HISTORY_IMPORT_START` and `CORTEX_HISTORY_IMPORT_CANCEL`. Also require options sender for Assist Sync `action: "enable"` (interactive token path).  
- **Tests:** `tests/history-import.test.ts`, `tests/pass4-security-gates.test.ts`

### S-2 — Med — **FIXED** — Gemini API key in `chrome.storage.local` (all extension contexts)

- **Title:** User Gemini key lived in `cortex_user_settings` under `chrome.storage.local`  
- **Path(s):** `src/shared/extension-settings.ts`; content `main.ts` / `overlay.ts` call `getUserSettings()`  
- **Evidence:** Content scripts loaded full settings (including `geminiApiKey`) to read UI toggles. MV3 storage is readable from content scripts by design.  
- **Impact:** Isolated-world memory held the key on every http(s) page; page JS cannot read it directly, but a content-script compromise or future bridge bug could.  
- **Fix:** Secret store in `src/shared/gemini-api-key.ts` — `chrome.storage.session` with `TRUSTED_CONTEXTS` plus dedicated local persist key `cortex_gemini_api_key`. `getUserSettings` always redacts the key; options save/load via secret store; SW migrates legacy settings field on install/startup. Overlay still requests Gemini only via messages (SW/offscreen holds key). See `pass4-security-s2.md`.  
- **Tests:** `tests/gemini-api-key-s2.test.ts`, `tests/pass4-security-gates.test.ts`, `tests/managed-policy.test.ts`

### S-3 — Med — **FIXED** — Settings normalize spread unknown keys / `__proto__`

- **Title:** `normalizeSettings` did `...DEFAULT_USER_SETTINGS, ...raw` then overwrote some fields  
- **Path(s):** `src/shared/extension-settings.ts`  
- **Evidence:** Unknown keys from storage survived on the returned object; `indexingPaused` was not explicitly boolean-normalized.  
- **Impact:** Prototype-pollution / unexpected-key persistence if storage were attacker-influenced (already a strong foothold); weak typing of `indexingPaused`.  
- **Fix:** Whitelist-only construction; `indexingPaused: bool(...)`; no `...raw`.

### S-4 — Med — **OPEN (intentional design)** — Broad `host_permissions` + content scripts

- **Title:** Install-time `http://*/*` + `https://*/*` hosts and content scripts  
- **Path(s):** `manifest.json`  
- **Evidence:** Required for core “index what you read” product; documented in Pass 3 SR-3 / privacy pack.  
- **Impact:** CWS / enterprise scrutiny; large attack surface for content-script trust boundary.  
- **Why open:** Removing hosts would break product; optional hosts deferred by product choice. Not a code defect.

### S-5 — Low — **OPEN** — Destructive library messages from content scripts

- **Title:** `CORTEX_PEOPLE_DELETE`, `CORTEX_COLLECTION_DELETE`, `CORTEX_CHAT_DELETE` accept content-script senders  
- **Path(s):** `src/background/service-worker.ts`  
- **Evidence:** Overlay UX needs these; no options-only gate.  
- **Impact:** Compromised content-script world can delete library objects (same privilege as opening overlay on a page).  
- **Direction:** Optional confirm tokens or privileged-only for bulk delete; accepted for single-item overlay actions.

### S-6 — Low — **OPEN** — Overlay `innerHTML` templates (escaped)

- **Title:** Search/digest empty/hit paths still assign `innerHTML` with interpolated strings  
- **Path(s):** `src/content/overlay.ts`  
- **Evidence:** Page-derived strings go through `esc()` / `safeHttpUrl`; static SVG templates; documented in `INNERHTML_AUDIT.md`.  
- **Impact:** Residual XSS risk if a future edit drops `esc()`.  
- **Direction:** Prefer DOM APIs for new UI; keep audit grep gate.

### S-7 — Low — **FIXED (was P-1)** — agent-debug-log localhost ingest URL

- **Title:** Disabled flag still shipped a hardcoded `http://127.0.0.1:7424/ingest/...` fetch  
- **Path(s):** `src/lib/agent-debug-log.ts`  
- **Fix:** Pure noop when disabled; no localhost URL / `fetch` in source. Call sites unchanged.

### S-8 — Low — **FIXED (was P-4)** — YouTube caption `credentials: "include"`

- **Title:** Credentialed fetch to timedtext URL  
- **Path(s):** `src/content/youtube-capture.ts`  
- **Evidence:** URL already validated by `captionJson3Url`; cookies unnecessary for public captions.  
- **Fix:** `credentials: "omit"`; private/age-gated fall back to DOM transcript panel.

### S-9 — Low — **OPEN** — `wasm-unsafe-eval` in extension CSP

- **Title:** CSP allows WASM eval for ORT  
- **Path(s):** `manifest.json` `content_security_policy.extension_pages`  
- **Impact:** Required for on-device embeddings; no remote script-src. Accepted tradeoff.

### S-10 — Low — **OPEN** — Gemini key plaintext at rest in profile storage

- **Title:** Same as S-2 at-rest angle (profile compromise / backup sync of Local Extension Settings)  
- **Direction:** OS-level profile protection; document in enterprise threat model (`docs/ENTERPRISE.md`); fold with S-2 remediation.

---

## Checklist polish updates

| ID | Status after Pass 4 |
|----|---------------------|
| **P-1** | **fixed** — dead localhost ingest URL removed |
| **P-4** | **fixed** — YouTube caption fetch uses `credentials: "omit"` |

---

## Fixes applied (code)

1. `src/background/service-worker.ts` — options-only gates for history import start/cancel; options-only Assist Sync `enable`.  
2. `src/lib/agent-debug-log.ts` — noop without ingest URL.  
3. `src/content/youtube-capture.ts` — `credentials: "omit"`.  
4. `src/shared/extension-settings.ts` — whitelist `normalizeSettings`.  
5. Tests: `tests/history-import.test.ts`, `tests/pass4-security-gates.test.ts`.  
6. S-2 Gemini secret store — `src/shared/gemini-api-key.ts`; settings redact; SW migrate; options load via effective settings. Tests: `tests/gemini-api-key-s2.test.ts`.

---

## Verification

Run from repo root:

```bash
npx vitest run tests/history-import.test.ts tests/pass4-security-gates.test.ts tests/gemini-api-key-s2.test.ts tests/managed-policy.test.ts tests/message-security.test.ts tests/assistant-sync-engine.test.ts tests/youtube.test.ts
npm run typecheck
```

---

## Fixed vs open (report)

### Fixed this pass
- **S-1 High** — history import / cancel sender gate (+ Assist Sync enable options-only)  
- **S-2 Med** — Gemini key SW/options-only (`gemini-api-key.ts`; session TRUSTED + dedicated persist)  
- **S-3 Med** — settings normalize whitelist  
- **S-7 / P-1 Low** — agent-debug-log URL removed  
- **S-8 / P-4 Low** — YouTube credentials omit  

### Open
- **S-4 Med** — broad hosts (intentional product design)  
- **S-5 Low** — overlay delete messages from content scripts  
- **S-6 Low** — residual innerHTML templates (escaped)  
- **S-9 Low** — wasm-unsafe-eval CSP  
- **S-10 Low** — API key at rest (ties to S-2)  

### Critical
- None identified.

---

*End of Pass 4 security audit. Path: `docs/enterprise-audit/pass4-security.md`.*

## S-2 disposition — FIXED

Implemented 2026-10-02: Gemini API key moved to SW/options secret store (`src/shared/gemini-api-key.ts`). Content/overlay never read the raw key. Details: `pass4-security-s2.md`. Residual at-rest profile risk remains **S-10**.
