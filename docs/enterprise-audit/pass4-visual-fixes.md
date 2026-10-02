# Pass 4 — visual / product fixes (screenshot review)

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Track:** Popup indexing status honesty + search-shell / overlay dark error contrast  
**Out of this track:** OAuth `release` fill; push / PR / git-config; new deps; search-engine / ranking / query-* / similarity; Settings/popup/onboarding dark theme (stay light-only).

---

## Defects (from screenshot review)

| ID | Surface | Problem | Fix |
|----|---------|---------|-----|
| **V-1** | Popup (`popup.png`) | Sticky said “Indexing is off until you agree…” while status line said **Indexing · Active**. | Status follows the same flags as the service worker gate: no `INDEXING_CONSENT_KEY` → **Off**; consented + `indexingPaused` → **Paused**; else **Active**. |
| **V-2** | Search shell dark (`search-shell-dark.png`) | Boot error used inline `color:#1c1917` on dark page `#141312` (~1.06:1). | Themeable `.cx-shell-boot-error` class; dark / `prefers-color-scheme: dark` uses `#f2efe9`. Overlay empty/error CSS reinforced to `--cx-text` / `--cx-text-muted` under `data-theme="dark"`. |

Options scrolled (`options-scrolled.png`): light-only Settings About section; no status contradiction; left unchanged.

---

## Behavior notes (V-1)

- Sticky privacy line (SR-8) still rewrites to the welcome-page consent CTA when consent is missing.
- Status line no longer claims **Active** in that state (or when pause is on).
- Consent is read with fail-closed semantics (`readIndexingConsented`): storage errors → treat as not consented.
- Order matches `shouldSkipIndexing`: consent before pause (missing consent wins over paused).
- Managed `indexingDisabled` already forces `indexingPaused` via settings; still shows **Paused** once consented.
- Popup / options / onboarding remain light-only.

User-facing status labels: **Off**, **Paused**, **Active**. No em dashes.

---

## Files changed

- `src/popup/popup-stats.ts` — `applyIndexingStatus`; `applySnapshotToDom` / `showEmptyState` take `indexingConsented`
- `src/popup/popup.ts` — `readIndexingConsented`; pass flag on load / refresh
- `src/popup/popup.css` — `.cx-indexing-state--off`
- `src/popup/popup.html` — empty initial status (no flash of Active)
- `src/search/search-shell.ts` — boot error uses `.cx-shell-boot-error`
- `src/search/search-shell.css` — dark body text + boot-error contrast; OS dark before theme attribute
- `src/content/overlay.shadow.css` — error/empty primary + muted on dark
- `src/popup/popup.test.ts` — indexing status unit cases
- `tests/search-shell-error.test.ts` — asserts themeable class, no light-only inline color
- `docs/enterprise-audit/pass4-visual-fixes.md` (this file)

---

## Constraints verified

- No OAuth `release` fill; no OAuth client id / public key / item id edits.
- No new npm dependencies.
- No search-engine / ranking / query-* / similarity edits.
- No push, PR, or git-config.
- No user-facing em dashes in new copy.
- Settings / popup / onboarding stay light-only.

---

## Verification

| Command | Expected |
|---------|----------|
| `npm run typecheck` | Pass |
| `npx vitest run src/popup/popup.test.ts tests/search-shell-error.test.ts tests/theme.test.ts` | Pass |
| `npm run build` | Pass; `dist/` rebuilt |

