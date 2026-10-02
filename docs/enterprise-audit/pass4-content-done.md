# Pass 4 — deferred polish + enterprise content

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Track:** Checklist polish P-2, P-5, P-6, P-7, P-8, P-9, P-11, P-12, P-13 + vibe-coded copy scan  
**Out of this track:** OAuth `release` fill; OAuth item id / public key; push / PR / git-config; new deps; search-engine / ranking / query-* / similarity; P-1, P-3, P-4, P-10 (left deferred unless trivial/safe).

---

## Polish items

| ID | Status | What changed |
|----|--------|--------------|
| **P-2** | **fixed** | Options Assist Sync consent (`#cx-assistant-consent`) names `drive.file` and states Cortex edits only files it creates in Cortex Memory, not the rest of Drive. |
| **P-5** | **fixed** | `docs/store-listing.md` single purpose, full description, privacy bullets, and permission short form aligned with `docs/release-1.2.0/STORE_RELEASE.md`. Cross-ref added on STORE_RELEASE. |
| **P-6** | **fixed** | Popup refresh control shows plain text **Refresh** (no `↻` glyph). Busy state uses opacity, not spin. |
| **P-7** | **fixed** | `.cx-storage-bar` uses solid `var(--cx-accent)`; removed accent→`#ea580c` gradient. |
| **P-8** | **fixed** | Removed `cx-btn-hero` from Open search; shared `cx-btn-primary` only (no hero shadow / oversized CTA). |
| **P-9** | **fixed** | Promotional “Connect with your AI assistant” → **Assist Sync** (options nav, H2, popup secondary CTA). Subsection “Connect an assistant” → “Assistant setup guides”. |
| **P-11** | **fixed** | Popup `prefers-reduced-motion: reduce` disables storage bar width transition; busy refresh stays a static dim. |
| **P-12** | **fixed** | Appearance description: “Settings and the toolbar popup stay light.” `docs/UI_DECISIONS.md` Theme + Dark mode sections document the same. Theme work did not change light-only Settings. |
| **P-13** | **fixed** | Overlay citation `0.82em` → 11px caption; markdown inline code `0.92em` → 13px small; onboarding `.cx-inline-code` → `var(--font-size-sm)`. Options already used named `--font-size-*` (no residual `em`). |

Left deferred (per brief): **P-1** (agent-debug-log), **P-3** (alarm when sync off), **P-4** (YouTube credentials), **P-10** (axe depth).

---

## Vibe-coded copy scan (options / popup / onboarding / overlay)

Rewrote promotional or casual user-visible strings to clear enterprise product English (no em dashes, no emoji, no Settings marketing headlines, no placeholder marketing):

| Surface | Before | After |
|---------|--------|-------|
| Popup / overlay / `en.json` tagline | “Your AI assistant's memory of what you browse and read.” | “Private library of pages you read on this device.” |
| Popup privacy ack | “Got it, do not show again” | “Do not show again” |
| Popup empty CTA | “Get started” | “Open welcome” |
| Popup Assist Sync CTA / options titles | “Connect with your AI assistant” / “Connect assistant” | “Assist Sync” |
| Overlay ask placeholder | “Ask anything about what you've read…” | “Ask about pages you have read” |
| Options Assist Sync consent lead | “Connect an AI assistant to your memory…” | Factual Assist Sync + `drive.file` consent (see P-2) |

Onboarding welcome / consent copy was already sober after Pass 3; left intact aside from type-scale CSS.

---

## Files changed

- `src/popup/popup.html`
- `src/popup/popup.css`
- `src/options/options.html`
- `src/content/overlay.ts`
- `src/content/overlay.shadow.css`
- `src/onboarding/onboarding.css`
- `src/lib/locales/en.json`
- `docs/UI_DECISIONS.md`
- `docs/store-listing.md`
- `docs/release-1.2.0/STORE_RELEASE.md` (cross-ref only)
- `docs/enterprise-audit/checklist.md` (polish statuses)
- `tests/assistant-sync-options.test.ts` (expects `drive.file` in consent)
- `docs/enterprise-audit/pass4-content-done.md` (this file)
- `src/shared/extension-settings.ts` (drive-by: restore `allowlistOnly` in whitelist `normalizeSettings` so typecheck passes; field was already on the type/defaults)

---

## Constraints verified

- Did not fill `config/oauth-clients.json` `release`.
- Did not change OAuth client id / public key / item id.
- No new npm dependencies.
- No search-engine / ranking / query-* / similarity edits.
- No push, PR, or git-config.

---

## Verification

Run after edits:

| Command | Expected |
|---------|----------|
| `npx vitest run tests/assistant-sync-options.test.ts` | **Pass** (4 tests; includes `drive.file` consent assert) |
| `npm run typecheck` | **Pass** (`tsc --noEmit` exit 0) |

*End of Pass 4 content report.*
