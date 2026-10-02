# Cortex enterprise audit — Pass 2 half A: packaging / sync / privacy core

**Audit date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Scope:** READ ONLY on application code. Findings written only under `docs/enterprise-audit/`. No `src/` edits, no eval edits, no push/PR/git-config changes. No OAuth item id / public key changes recommended.  
**Research base:** `docs/enterprise-audit/research.md` (skimmed `research-chrome-policy.md` as needed).  
**Surfaces covered:** `manifest.json` / packaging / permissions / oauth2 / public key / host permissions / content scripts / incognito; service worker; offscreen; Assistant Sync; local JSON backup; privacy / enterprise disclosure docs; `agent-debug-log` and other outbound fetch paths.

---

## Counts by severity

| Severity | Count |
|----------|------:|
| blocker | 2 |
| store-review risk | 7 |
| user-facing defect | 4 |
| polish | 5 |
| **Total findings** | **18** |

### Top 5 blockers / store-review risks

1. **B-1** — `config/oauth-clients.json` `release` OAuth client id is empty → `build:store` cannot produce a working CWS OAuth binding.
2. **B-2** — `docs/release-1.2.0/STORE_RELEASE.md` privacy practices / data-transmission answers omit Assistant Sync (Drive) and `identity`, while claiming “nothing is sent anywhere by default” / only Gemini — false if submitted as written.
3. **SR-1** — First-install history backfill + live indexing start without affirmative in-product consent; disclosures claim user-triggered import.
4. **SR-2** — Privacy policy (HTML + MD) lacks the required affirmative Limited Use / Google APIs statement.
5. **SR-3** — Broad install-time `http://*/*` + `https://*/*` host permissions and content scripts remain the highest Purple Potassium scrutiny area (justify; do not “fix” by breaking core indexing).

---

## blocker

### B-1 — Empty release OAuth client id blocks store build

- **Severity:** blocker  
- **Title:** Store OAuth client id empty in `config/oauth-clients.json`  
- **Path(s):**
  - `config/oauth-clients.json` (`"release": ""`)
  - `scripts/oauth-client.cjs` (`resolveOAuthClientId` throws if release id empty)
  - `webpack.config.js` (CopyWebpackPlugin overwrites `manifest.oauth2.client_id` from resolved id; `--env store` uses release)
  - `manifest.json` (dev client id currently baked in source; key/public extension id must stay unchanged)
- **Evidence:** `"release": ""` in `config/oauth-clients.json`. `resolveOAuthClientId("release")` throws: *Release OAuth client id is empty…*. Dev client `1001602130427-c4skn7nc1rglp56h5egnchv2khlafk5v…` is present and matches source `manifest.json`.
- **Why it matters:** A Chrome Web Store zip built without the CWS-bound OAuth client id cannot complete Assistant Sync Enable against the published item id `happibddmmagkgneicjkndapcpmhdbfn`. Yellow Magnesium (core flow broken for reviewers) and identity integration failure.
- **Suggested fix direction:** Put the **existing** Chrome Extension OAuth client id for the published item into `release` (do **not** mint a new client or change `manifest.json` `"key"` / item id). Keep `npm run build:store` as the only path that writes the release client into `dist/manifest.json`.

### B-2 — Release-pack privacy practices omit Drive sync / identity

- **Severity:** blocker  
- **Title:** `STORE_RELEASE.md` certifications contradict shipped Assistant Sync  
- **Path(s):**
  - `docs/release-1.2.0/STORE_RELEASE.md` (Permission justifications; Privacy practices form; Data transmission)
  - `docs/release-1.2.0/PERMISSIONS.md` (lists `identity` under “deliberately does not add” / “No accounts”)
  - Contrast: `manifest.json` (`identity`, `oauth2.scopes: drive.file`), `src/options/assistant-sync-panel.ts`, `src/assistant-sync/drive-api.ts`, `docs/store-listing.md` (accurate)
- **Evidence:**
  - STORE_RELEASE permission table has no `identity` row; host justification ends with “Nothing is sent to any server.”
  - Data transmission section: “nothing is sent anywhere by default. The one exception is optional cloud chat…” — omits optional Drive writes to `Cortex Memory`.
  - Privacy practices “Sent off the device” row only mentions Gemini.
  - PERMISSIONS.md §“deliberately does not add”: `| identity | No accounts. |` while manifest includes `identity` + oauth2.
- **Why it matters:** Submitting those answers as written is inaccurate Limited Use / privacy-practices certification (Purple Lithium / Red Nickel). Reviewers comparing form answers to `identity` + Drive network calls will reject or escalate.
- **Suggested fix direction:** Rewrite release-pack privacy practices and permission justifications to match `docs/store-listing.md` + live privacy HTML: disclose Enable-gated Assistant Sync, `drive.file` only, `Cortex Memory`, `identity` interactive-only-from-Enable; keep Gemini as a second optional path. Fix PERMISSIONS.md identity row. Do not weaken code; fix the pack.

---

## store-review risk

### SR-1 — Indexing / first-install history without affirmative consent

- **Severity:** store-review risk  
- **Title:** History backfill and indexing start before affirmative consent  
- **Path(s):**
  - `src/background/service-worker.ts` (`onInstalled` → `maybeRunFirstInstallBackfill`; no consent gate)
  - `src/shared/onboarding-constants.ts` (`FIRST_INSTALL_HISTORY_DAYS = 30`, `FIRST_INSTALL_HISTORY_MAX_URLS = 500`)
  - `src/lib/first-install-history-notify.ts` (notifications after scan already started)
  - `src/onboarding/onboarding.html` (“Getting ready… saving your recent browsing” — after the fact)
  - Claims: `docs/PRIVACY_POLICY.md`, `docs/privacy-policy.html`, `docs/store-listing.md`, `docs/release-1.2.0/STORE_RELEASE.md` (“optional” / “you trigger” / “opts in during onboarding”)
- **Evidence:** `maybeRunFirstInstallBackfill` sets `FIRST_INSTALL_BACKFILL_DONE_KEY` and immediately runs `runHistoryImportJob(30, 500)` + open-tab priming. Onboarding has no checkbox/opt-in; only a notice that scanning is already underway. Privacy MD: “optional bulk import features you trigger”; store-listing: “optional import you start yourself.”
- **Why it matters:** CWS User Data FAQ requires prominent disclosure **and** affirmative informed consent **in the Product UI** before collection (local indexing still counts). Mismatch between docs and behavior is deceptive-metadata risk.
- **Suggested fix direction:** Gate first-install history import (and ideally first live indexing) behind an explicit onboarding control; align privacy/store copy with whatever the code does. Keep sensitive-site / incognito skips.

### SR-2 — Missing Limited Use affirmative statement on privacy surfaces

- **Severity:** store-review risk  
- **Title:** No Google APIs Limited Use compliance sentence  
- **Path(s):**
  - `docs/privacy-policy.html`
  - `docs/PRIVACY_POLICY.md`
  - (Also absent from README / ENTERPRISE homepage-style docs)
- **Evidence:** Privacy HTML/MD disclose `drive.file` and Gemini but never state that use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements (required when using restricted scopes / Google user data).
- **Why it matters:** Explicit Limited Use homepage/privacy statement is a CWS policy requirement for extensions using Google user data (Drive via `chrome.identity`).
- **Suggested fix direction:** Add one clear affirmative sentence to `privacy-policy.html` + MD (and keep them byte-consistent). No scope change.

### SR-3 — Broad install-time hosts + content scripts

- **Severity:** store-review risk  
- **Title:** Install-time `http(s)://*/*` hosts and content script (Purple Potassium scrutiny)  
- **Path(s):**
  - `manifest.json` (`host_permissions`, `content_scripts`)
  - `docs/release-1.2.0/PERMISSIONS.md`, `docs/release-1.2.0/STORE_RELEASE.md`
  - `tests/manifest.test.ts` (pins hosts; `optional_host_permissions` undefined)
- **Evidence:** Required hosts `http://*/*`, `https://*/*`; content script `content.js` on all http(s) at `document_idle`. Product purpose is “index what you read,” so broad access is arguable — but install warning is “Read and change all your data on all websites.”
- **Why it matters:** Highest recurring CWS rejection theme for privacy-first indexers without airtight single-purpose + browsing-activity justification in dashboard **and** UI.
- **Suggested fix direction:** Keep hosts if core UX requires them; harden reviewer justifications and in-product browsing-activity disclosure (see SR-1). Do not move core indexing behind optional hosts unless product explicitly accepts broken default indexing. **Do not** treat this intentional design as an “enterprise gap.”

### SR-4 — Privacy policy still labeled “draft”; disclosure gaps vs behavior

- **Severity:** store-review risk  
- **Title:** Privacy MD marked draft; history / alarm / incognito incomplete vs code  
- **Path(s):**
  - `docs/PRIVACY_POLICY.md` (title “(draft)”)
  - `docs/privacy-policy.html` (no “draft”; no Limited Use; history bullet softens first-install)
  - `docs/data-deletion.html` (solid for Delete-all + Drive trash)
  - Options links: `src/options/options.html` → GitHub Pages privacy / data-deletion URLs
- **Evidence:** MD title still says draft. History described as user-triggered; HTML says “e.g. first-install backfill” without saying it is automatic. Incognito `not_allowed` is not called out in the privacy HTML summary. Alarm claim: “15 minute Assistant Sync alarm runs only after you enable sync” while SW always `chrome.alarms.create(ASSISTANT_SYNC_ALARM)` on startup (handler no-ops if disabled).
- **Why it matters:** Reviewers and enterprises treat the hosted privacy URL as the contract. “Draft” + drift from behavior undermines trust and Limited Use accuracy.
- **Suggested fix direction:** Drop “draft”; document automatic first-install scan (or remove it — SR-1); mention incognito never indexed; clarify alarm is scheduled but **Drive work** runs only while sync is enabled.

### SR-5 — Maintainer PERMISSIONS.md contradicts shipped `identity`

- **Severity:** store-review risk  
- **Title:** Internal permissions doc denies `identity` while manifest ships it  
- **Path(s):**
  - `docs/release-1.2.0/PERMISSIONS.md` (lines listing identity as not added)
  - `manifest.json` (`permissions` includes `identity`; `oauth2` block)
  - `tests/manifest.test.ts` (expects `identity` + `drive.file` only)
- **Evidence:** PERMISSIONS.md “Permissions this release deliberately does not add” includes identity / “No accounts.” Manifest and tests require the opposite.
- **Why it matters:** Release operators copying PERMISSIONS.md into the CWS form will omit or mis-justify `identity`.
- **Suggested fix direction:** Replace that row with the store-listing justification (Enable-only interactive auth; silent token thereafter).

### SR-6 — Popup privacy blurb omits Assistant Sync / Drive

- **Severity:** store-review risk  
- **Title:** Primary privacy blurb silent on optional Drive sync  
- **Path(s):**
  - `src/popup/popup.html` (`#cx-privacy-blurb`)
  - `src/popup/popup.ts` (`cortex_popup_privacy_ack_v1`)
  - Contrast: `src/options/options.html` `#cx-assistant-consent` (accurate Assist Sync copy)
- **Evidence:** Blurb: “Indexed data stays on your device. Live indexing uses no network… Optional Cloud Chat… Gemini…” — no mention of optional Assistant Sync writing titles/URLs/excerpts to the user’s Drive.
- **Why it matters:** Prominent disclosure must cover optional off-device transfers. Chat-only disclosure understates browsing-activity sync when Assist Sync ships in the same build.
- **Suggested fix direction:** One factual sentence on Assist Sync (off until Enable; user’s `Cortex Memory` folder; `drive.file`). Keep tone non-marketing.

### SR-7 — Single-purpose stretch if listing omits sync narrative

- **Severity:** store-review risk  
- **Title:** Local memory + Drive sync + Gemini must stay one purpose in listing  
- **Path(s):**
  - `docs/store-listing.md` (good framing)
  - `docs/release-1.2.0/STORE_RELEASE.md` detailed description (Drive/Assist Sync largely absent; Gemini optional only)
  - `manifest.json` name/description (on-device memory only)
- **Evidence:** store-listing.md frames Assist Sync as copy of the same memory. STORE_RELEASE detailed description emphasizes on-device only and skips Drive folder narrative present in options consent.
- **Why it matters:** Red Magnesium risk if reviewers see three products (indexer / Drive exporter / Gemini client) without a tight “one memory” story.
- **Suggested fix direction:** Prefer `docs/store-listing.md` narrative for the live CWS listing; keep Assist Sync and Gemini as features of private memory, not separate tools.

---

## user-facing defect

### U-1 — Assistant Sync has Enable but no Disable

- **Severity:** user-facing defect  
- **Title:** No way to turn sync off without Delete all  
- **Path(s):**
  - `src/options/options.html` (`#cx-assistant-enable`, `#cx-assistant-now` only)
  - `src/options/assistant-sync-panel.ts` (Enable + Sync now handlers only)
  - `src/assistant-sync/sync-engine.ts` (`enableAssistantSync` sets `syncEnabled: true`; no disable API used by UI)
  - `src/assistant-sync/db.ts` (default `syncEnabled: false`; wipe clears state via Delete all)
- **Evidence:** Status can show On, but UI never sets `syncEnabled` back to false short of wiping the Assistant Sync DB through Delete all / forgetAll.
- **Why it matters:** Privacy-critical control without an off switch violates predictable settings UX; users who revoke Google access still see Sync On until errors accumulate.
- **Suggested fix direction:** Add Disable that sets `syncEnabled: false`, clears the 15-minute work path, and leaves Drive files in place unless user chooses Delete/trash. (Overlaps Pass 2 half B note; listed here because it is sync/privacy core.)

### U-2 — Privacy / store copy says history import is user-started; code auto-runs

- **Severity:** user-facing defect  
- **Title:** Documented “optional import you start” ≠ automatic first-install scan  
- **Path(s):** Same as SR-1 (`maybeRunFirstInstallBackfill` vs privacy/store-listing claims)
- **Evidence:** Notifications and onboarding acknowledge an in-progress scan; Settings also exposes manual `CORTEX_HISTORY_IMPORT_START`. Docs describe only the manual story.
- **Why it matters:** Users who trust “you start yourself” discover a 30-day history fetch already ran.
- **Suggested fix direction:** Same as SR-1 — change product gate or change every public sentence.

### U-3 — “Sync now” available while sync is Off

- **Severity:** user-facing defect  
- **Title:** Sync now not gated on enabled state  
- **Path(s):**
  - `src/options/assistant-sync-panel.ts` (now button always clickable)
  - `src/background/service-worker.ts` (`forwardAssistantSync("now")` → silent token)
  - `src/assistant-sync/sync-engine.ts` (`runSyncTick` returns `disabled` if `!syncEnabled`)
- **Evidence:** UI always offers Sync now; engine correctly no-ops when disabled, but user gets a confusing failure/auth prompt path via silent token before/around that.
- **Why it matters:** Predictable settings: secondary actions should not invite OAuth errors before Enable.
- **Suggested fix direction:** Disable Sync now until `syncEnabled`; or make it call Enable flow with clear copy.

### U-4 — Popup claim “Live indexing uses no network” is easy to over-read

- **Severity:** user-facing defect  
- **Title:** Absolute “no network” indexing claim vs history fetch / PDF fetch / optional sync  
- **Path(s):**
  - `src/popup/popup.html` privacy blurb
  - `src/lib/history-import.ts` (`fetch` of page HTML during import)
  - `src/offscreen/pdf-fetch.ts` (`fetch` of PDF URL)
  - `src/assistant-sync/drive-api.ts` (Google APIs when sync on)
- **Evidence:** Blurb asserts live indexing uses no network. History import and PDF indexing intentionally fetch the same URL; Assist Sync uses Google HTTPS when enabled.
- **Why it matters:** Privacy-conscious users treat that sentence as a hard guarantee; Red Nickel if paired with Drive/Gemini later.
- **Suggested fix direction:** Narrow wording: e.g. embeddings/index storage stay on device; optional network only for history/PDF URL fetch and user-enabled Drive/Gemini.

---

## polish

### P-1 — `agent-debug-log` ships disabled localhost ingest URL

- **Severity:** polish  
- **Title:** Debug ingest URL present but gated off  
- **Path(s):**
  - `src/lib/agent-debug-log.ts` (`CORTEX_AGENT_DEBUG_INGEST_ENABLED = false`; `fetch("http://127.0.0.1:7424/ingest/…")`)
  - Call sites: `src/background/service-worker.ts`, `src/offscreen/offscreen.ts`
- **Evidence:** Hard `false` short-circuits before `fetch`. No production telemetry path observed from this module when flag is false. ENTERPRISE.md / README “no telemetry” remains accurate for shipped behavior.
- **Why it matters:** Bundle greps / curious reviewers may flag the ingest URL as contradicting “no telemetry,” even though it is dead.
- **Suggested fix direction:** Strip call sites + module from production builds (DefinePlugin / dead-code), or keep flag false and document in release checklist. Not a live leak today.

### P-2 — Options Assist Sync consent omits naming `drive.file`

- **Severity:** polish  
- **Title:** Consent copy lists data types but not scope name  
- **Path(s):** `src/options/options.html` `#cx-assistant-consent`; privacy HTML names `drive.file`
- **Evidence:** Consent accurately lists titles, URLs, 5-minute excerpts, searches, LinkedIn, topics, `Cortex Memory`, Enable gate. Scope name only in linked privacy policy / store-listing.
- **Why it matters:** Slightly weaker in-product OAuth explanation than Chromium identity guidance (“explain what authorization is for”).
- **Suggested fix direction:** One short clause: “Enable asks Google for the Drive file permission (`drive.file`) only.”

### P-3 — Assist Sync alarm registered even when sync is off

- **Severity:** polish  
- **Title:** Alarm always created; work gated in handler  
- **Path(s):**
  - `src/background/service-worker.ts` `scheduleStorageMaintenanceAlarm` → always `chrome.alarms.create(ASSISTANT_SYNC_ALARM, { periodInMinutes: 15 })`
  - `runAssistantSyncAlarm` returns immediately if `!syncEnabled`
  - Privacy/store copy: “alarm runs only after you enable”
- **Evidence:** Behavior is safe (no Drive calls when off). Copy is slightly imprecise.
- **Suggested fix direction:** Create/clear alarm on Enable/Disable, or soften disclosure to “Drive sync checks run only while sync is on.”

### P-4 — YouTube caption fetch uses `credentials: "include"`

- **Severity:** polish  
- **Title:** Same-page caption fetch sends cookies  
- **Path(s):** `src/content/youtube-capture.ts` (`fetch(url, { credentials: "include" })` for caption `baseUrl` on youtube.com)
- **Evidence:** Comment notes same site the user is on. Distinct from PDF path (`credentials: "omit"`). Not Cortex telemetry; still a credentialed third-party-ish request shape for captions.
- **Why it matters:** Fine for product; worth a privacy-policy footnote if reviewers ask about credentialed fetches.
- **Suggested fix direction:** Document in privacy/permissions notes; keep omit elsewhere.

### P-5 — Dual listing docs drift (`store-listing.md` vs `STORE_RELEASE.md`)

- **Severity:** polish  
- **Title:** Accurate Assist Sync listing draft vs stale 1.2.0 release pack  
- **Path(s):** `docs/store-listing.md`, `docs/release-1.2.0/STORE_RELEASE.md`
- **Evidence:** store-listing includes identity + drive.file + Enable narrative; STORE_RELEASE detailed description does not (see B-2).
- **Why it matters:** Operators may paste the wrong file into CWS.
- **Suggested fix direction:** Make STORE_RELEASE the single source or mark it superseded by store-listing for Assist Sync sections.

---

## Intentional limits / non-findings

Do **not** treat these as enterprise gaps or “fix” them by inventing data or widening OAuth:

| Topic | Status | Paths / notes |
|-------|--------|----------------|
| Excerpts only after real ≥5-minute read | Intentional | `src/assistant-sync/excerpt.ts` (`buildExcerpt`); options consent copy; blank when dwell missing |
| Dwell blank until measured | Intentional | `src/assistant-sync/runtime.ts` `captureVisitFromChrome` passes `dwellMinutes: null`; engine must not invent `0` |
| No Cortex server; optional Drive sync user-gated | Intentional / accurate | No Cortex backend; Enable → interactive token; alarm/now silent; sync default off (`db.ts`) |
| OAuth scope `drive.file` only | Intentional / good | `manifest.json` oauth2; `DRIVE_FILE_SCOPE`; `tests/manifest.test.ts` |
| Interactive `getAuthToken` only from Enable click | Intentional / good | `assistant-sync-panel.ts` `driveTokenFromClick`; SW `silentDriveToken` for alarm/now/trash |
| Google fetches stay in assistant-sync chunk (offscreen) | Intentional / good | `offscreen.ts` dynamic `import(/* webpackChunkName: "assistant-sync" */…)`; `FetchDriveApi` only under `src/assistant-sync/`; SW passes token + storage ids |
| Folder name `Cortex Memory` | Intentional | `createMemoryFile` / `reenableMemory` |
| Do not change OAuth item id or public `key` | Constraint | `manifest.json` `"key"`; published id `happibddmmagkgneicjkndapcpmhdbfn`; unpacked `fkhaacmaaaheapelljjcmfdmifmfbboa` |
| `incognito: "not_allowed"` | Intentional privacy posture | `manifest.json`; tests pin it |
| Offscreen cannot use `chrome.storage`; SW passes data | Intentional architecture | Comment + `readAssistantSyncLaunch` / message payload ids+token |
| Local JSON/Markdown backup only (no Drive JSON backup path) | Intentional | `src/lib/export/backup.ts`, `backup-ui.ts`, `backup-router.ts` — disk download via blob link; Assist Sync is the Drive path |
| Remote ML / CDN closed | Intentional / good | `src/lib/transformers-env.ts` `allowRemoteModels` default false; bundled wasm |
| WAR minimized | Intentional / good | icons+fonts only, `use_dynamic_url: true`; models/wasm not web-accessible |
| `agent-debug-log` disabled | Non-finding for live telemetry | Flag false; see P-1 for dead URL polish only |
| Out-of-scope failing tests | Note only — do not “fix” | `tests/pdf.test.ts` Promise.withResolvers; `tests/embed-parity.test.ts` cosine threshold; `tests/chat-engine-abort.test.ts` token count |
| Managed enterprise policy schema | Strength | `managed_schema.json`, `docs/ENTERPRISE.md` — not a sync defect |
| Permissions actually used | Non-finding | `tabs`, `offscreen`, `alarms`, `scripting`, `storage`, `history`, `notifications`, `sidePanel`, `contextMenus`, `identity` all have call sites (notifications ≈ first-install scan; contextMenus highlights/collections) |

---

## Architecture snapshot (verified)

```
Enable click (options)
  → chrome.identity.getAuthToken({ interactive: true })
  → CORTEX_ASSISTANT_SYNC { action: "enable", token }
  → SW ensureOffscreen + CORTEX_ASSISTANT_SYNC_WORK (token + folder/file ids from chrome.storage.local)
  → offscreen lazy-loads assistant-sync chunk → FetchDriveApi → Drive/Sheets HTTPS
  → SW persists returned ids to chrome.storage.local

Alarm / Sync now
  → SW silent getAuthToken({ interactive: false })
  → same offscreen work path

Backup
  → options CORTEX_EXPORT → offscreen/export path → local JSON or Markdown zip download (no Drive)
```

CSP: `script-src 'self' 'wasm-unsafe-eval'` on extension pages. No remote script loading observed in packaging config.

---

## Out of scope (noted, not fixed)

- `tests/pdf.test.ts` — Promise.withResolvers  
- `tests/embed-parity.test.ts` — cosine threshold  
- `tests/chat-engine-abort.test.ts` — token count  

---

*End of Pass 2 half A. No `src/`, tests, manifest, package.json, or eval files were modified. No push, PR, or git config changes.*
