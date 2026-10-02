# Pass 4 — S-2 fix: Gemini API key out of content-script reach

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Finding:** S-2 (Med) — Gemini API key lived in `cortex_user_settings` under `chrome.storage.local`, which content scripts load via `getUserSettings()`.

---

## Fix summary

| Piece | Change |
|-------|--------|
| Secret store | New `src/shared/gemini-api-key.ts` |
| Runtime isolation | `chrome.storage.session` + `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` so content scripts cannot read session |
| Persistence | Dedicated local key `cortex_gemini_api_key` (not inside `cortex_user_settings`); read/written only by the secret module |
| Settings blob | `normalizeSettings` / `getUserSettings` always return `geminiApiKey: ""`; `setUserSettings` routes any key update to the secret store and never persists it in `cortex_user_settings` |
| Migration | On SW install/startup (and first trusted read): move legacy `cortex_user_settings.geminiApiKey` → secret store, then blank the field in settings |
| Options | Load key via `getEffectiveSettings()` (merges secret); save still goes through `setUserSettings({ geminiApiKey })` which delegates to the store |
| Chat path | Unchanged architecture: overlay → `CORTEX_CHAT_START` → SW `getEffectiveChatSettings()` → offscreen; raw key never returned to overlay/content |
| Interactive token | Unchanged (Assist Sync Enable-only `getAuthToken({ interactive: true })`) |

---

## Why this shape

- Content/overlay only need UI flags (`theme`, `doubleShiftShortcutEnabled`, …). They keep using `getUserSettings()` and never import `gemini-api-key`.
- `chrome.storage.session` with `TRUSTED_CONTEXTS` is the hard MV3 wall against content-script reads of the live key.
- A dedicated local persist key survives browser restart (session alone would not). At-rest profile risk remains **S-10** (documented; no profile-bound encryption in 1.2.0 per `docs/ENTERPRISE.md`).
- No new dependencies; search-engine / ranking / query-* / similarity untouched; no OAuth / push / PR / git-config changes.

---

## Files touched

- `src/shared/gemini-api-key.ts` (new)
- `src/shared/storage-local.ts` — `storageLocalRemove`
- `src/shared/extension-settings.ts` — redact key; route saves
- `src/shared/managed-policy.ts` — merge key in `getEffectiveSettings`
- `src/background/service-worker.ts` — trusted access + migrate on install/startup
- `src/options/options.ts` — load key from effective settings
- `tests/helpers/chrome-storage-mock.ts` — session area
- `tests/gemini-api-key-s2.test.ts` (new)
- `tests/managed-policy.test.ts` — secret-store coverage
- `tests/pass4-security-gates.test.ts` — S-2 source gate
- `docs/enterprise-audit/pass4-security.md` — S-2 marked fixed
- `docs/enterprise-audit/checklist.md` — S-2 status
- `docs/enterprise-audit/pass4-security-s2.md` (this file)

---

## Verification

```bash
npm run typecheck
npx vitest run tests/gemini-api-key-s2.test.ts tests/pass4-security-gates.test.ts tests/managed-policy.test.ts tests/options-managed-ui.test.ts tests/message-security.test.ts tests/history-import.test.ts
```

---

*End of S-2 fix note.*
