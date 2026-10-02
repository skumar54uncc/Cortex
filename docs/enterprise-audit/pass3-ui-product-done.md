# Pass 3 Track B — UI / product done

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Track:** User-facing defects (UI unification) + Assist Sync control UX + product gaps 1–4  
**Out of this track:** STORE_RELEASE / PERMISSIONS / privacy Limited Use / first-install consent / popup privacy sticky disclosure (other track). No push, PR, or git-config changes. No OAuth item id / public key / `config/oauth-clients.json` release fill. No search-engine / ranking / query-* / similarity edits. No new npm deps.

---

## Product gaps

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 1 | People/Companies backfill on next sync | **Done** | `seedPeopleFromLibrary` copies Cortex `db.people` onto Assist Sync People/Companies when the profile URL was visited inside retention. Runs on every sync tick (Enable / Sync now / 15-minute alarm / soon alarm). |
| 2 | Index-time LinkedIn fields + delayed sync | **Done** | Index payload `person` is passed through `captureAssistantSyncVisit` → offscreen capture as `linkedInFields` (no Document). Schedules one-shot `cortex-assistant-sync-soon` (~2 minutes). 15-minute alarm remains the backstop. No Google call on every page. |
| 3 | Questions section on About (schema_version 3) | **Done** | About tab adds a **Questions** section mapping shapes to Visits, Content, Searches, People, Companies, Daily. Last row still `schema_version: 3`. |
| 4 | Drive JSON backup as separate file | **Done** | Sync writes/updates `Cortex Memory Backup.json` in the Cortex Memory folder via `upsertJsonFile` (lazy `assistant-sync-json-backup` chunk using `collectBackup`). About tells the assistant not to read archives or the JSON backup; live sheet stays the only query file. Backup file id stored in `cortex_assistant_sync_backup_file_id`. |

---

## User-facing defects (this track)

| ID | Fix |
|----|-----|
| **U-1** | Disable control in Settings (`#cx-assistant-disable`). Message bus action `disable` sets `syncEnabled: false`, leaves Drive files. Enable/Disable swap visibility from status. |
| **U-3** | Sync now disabled (and titled) while Off; SW also rejects `now` when disabled with calm copy. |
| **U-5 + U-7** | Options bridges to `cortex-theme.css` tokens (accent `#a82207`, warm beige surfaces). Named type scale documented; options `--font-size-*` aliased; metric aligned to `--cx-ts-metric`. Overlay gets `--cx-ts-*` via `themeTokensCss()`. Documented bridge: extension pages = CSS theme; overlay = `theme.ts` (light accent `#b8250a` for gradient contrast). |
| **U-6 + U-8** | Shared `src/styles/cx-buttons.css` linked from options, popup, onboarding. Popup privacy ack + link buttons get `:focus-visible`. |
| **U-9** | Shared `src/shared/empty-copy.ts`; popup / options Library / overlay Ask / search / digest empty copy aligned (factual lead + next step). |

Hard architecture preserved: Google fetch stays in assistant-sync chunk; offscreen does not read `chrome.storage` (SW passes ids/token); interactive `getAuthToken` only from Enable click.

---

## Files changed (primary)

- `src/assistant-sync/sheet.ts` — Questions + JSON backup About copy  
- `src/assistant-sync/capture.ts` — `linkedInFields` path  
- `src/assistant-sync/sync-engine.ts` — `seedPeopleFromLibrary`, `disableAssistantSync`, Drive JSON backup upsert  
- `src/assistant-sync/drive-api.ts` — `upsertJsonFile`, `DRIVE_JSON_BACKUP_NAME`  
- `src/assistant-sync/runtime.ts` — disable / LinkedIn capture / people + backup hooks  
- `src/assistant-sync/db.ts` — soon-alarm constants  
- `src/assistant-sync/preference-keys.ts` — backup file id key  
- `src/background/service-worker.ts` — disable, soon alarm, LinkedIn fields on capture, backup id storage  
- `src/offscreen/offscreen.ts` — disable / backupFileId / linkedInFields  
- `src/options/assistant-sync-panel.ts`, `options.html`, `options.css`  
- `src/popup/popup.html`, `popup.css`  
- `src/onboarding/onboarding.html`  
- `src/content/overlay.ts`  
- `src/shared/empty-copy.ts` (new), `src/shared/theme.ts`  
- `src/styles/cortex-theme.css`, `src/styles/cx-buttons.css` (new)  
- `webpack.config.js` — copy `cx-buttons.css`  
- `tests/assistant-sync-*.test.ts` — mocks, Disable test, About asserts  

---

## Verification

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npx vitest run tests/assistant-sync.test.ts tests/assistant-sync-engine.test.ts tests/assistant-sync-drive.test.ts tests/assistant-sync-options.test.ts` | **34 passed** |
| `npm run check:budget` | Pass (service-worker **223455 / 225280**) |
| `npx vitest run tests/theme.test.ts` | 22 passed |

Known out-of-scope failing tests (not run as gates here): `pdf` Promise.withResolvers, `embed-parity` cosine, `chat-engine-abort` token count.

---

## Coordination note (other track)

Did not edit STORE_RELEASE, PERMISSIONS, privacy HTML/MD, first-install consent gate, or popup privacy sticky disclosure. Shared files touched only for Assist Sync / UI unify (`popup.html` empty copy; `options.html` Assist Sync controls + theme links). Other track should keep those privacy edits minimal if they touch the same HTML.

*End of Pass 3 Track B report.*

## Shared-tree note

While this track ran, the privacy/consent track also edited shared surfaces on the same box (`popup.html` sticky disclosure, onboarding consent, options indexing consent, release-pack docs). Track B kept Assist Sync Disable, token/button unify, empty copy, and product gaps intact alongside those edits. Re-run typecheck / assistant-sync tests / `check:budget` after merging both tracks if either side still has uncommitted work.

