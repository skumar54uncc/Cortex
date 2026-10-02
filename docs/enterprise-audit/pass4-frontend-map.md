# Pass 4 — Frontend map for visual review

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Build:** `npm run build` (webpack production → `dist/`). Not `build:store`; OAuth release client id was not filled.  
**Scope of this note:** Map static HTML / injected UI surfaces, theme behavior, and one recommended theme approach. No browser launch here (parent uses computerUse). No push / PR / git-config.

---

## 1. Absolute `file://` paths (after build)

Open these in a browser for static HTML review. Relative assets (`*.css`, `*.js`, icons, fonts) resolve next to each HTML file under `dist/`.

| Surface | Absolute `file://` path | Dist artifacts |
|---------|-------------------------|----------------|
| **Options (Settings)** | `file:///workspace/cortex-work/Cortex/dist/options.html` | `options.html`, `options.css`, `options.js`, `cortex-theme.css`, `cx-buttons.css` |
| **Popup** | `file:///workspace/cortex-work/Cortex/dist/popup.html` | `popup.html`, `popup.css`, `popup.js`, `cortex-theme.css`, `cx-buttons.css` |
| **Onboarding** | `file:///workspace/cortex-work/Cortex/dist/onboarding.html` | `onboarding.html`, `onboarding.css`, `onboarding.js`, `cortex-theme.css`, `cx-buttons.css` |
| **Search shell** (side panel / restricted-page fallback) | `file:///workspace/cortex-work/Cortex/dist/search-shell.html` | `search-shell.html`, `search-shell.css`, `search-shell.js` (+ pulls overlay UI via JS) |

**Not a standalone HTML page:**

| Surface | Path / note |
|---------|-------------|
| **Overlay (in-page panel)** | No `overlay.html`. Bundle: `file:///workspace/cortex-work/Cortex/dist/overlay.js`. For static review of the same UI, use **search-shell.html** (mounts overlay in shell mode). |
| Always-on content script | `file:///workspace/cortex-work/Cortex/dist/content.js` — extraction + messaging only; does **not** mount the overlay. |
| Offscreen (not UI review) | `file:///workspace/cortex-work/Cortex/dist/offscreen.html` |

**Static-review caveats**

- Extension pages call `chrome.*` (storage, runtime messages). As `file://`, chrome APIs are missing: expect empty stats, failed saves, and console errors. Layout / CSS / structure are still reviewable.
- **search-shell** boots `mountOverlay({ shell: true })` then `openCortexOverlay()`. Without `chrome.runtime` / storage, boot may error into the shell’s fallback `<pre>`; if the shell mounts, theme defaults to **system** until settings load (see §3). To force dark chrome on the shell page for review: set `document.documentElement.setAttribute("data-theme","dark")` (and on `#cortex-overlay-root` if present) in DevTools.
- Overlay shadow root is **closed** in production builds (`__CORTEX_E2E_OPEN_SHADOW__` only for `build:e2e`). Inspecting inner overlay DOM from the page inspector is limited; axe against overlay needs the e2e open-shadow build.

---

## 2. How the overlay is injected (content / SW)

Declared content script (`manifest.json` → `content.js` on `http(s)://*/*`) stays **extraction + messaging**. The Search / Ask / Digest UI is **on-demand**:

1. User opens Cortex (toolbar / double-Shift / context / etc.).
2. Service worker `openSearchOnTab` → `openOverlayOnTab` (`src/lib/overlay-injector.ts`).
3. Tries `chrome.tabs.sendMessage` with `{ type: "CORTEX_OPEN_SEARCH", docked? }`.
4. If no listener yet: `chrome.scripting.executeScript({ files: ["overlay.js"] })`.
5. Retries open message (up to 4 × ~24 ms).
6. `overlay-entry.ts` sets `window.__cortexOverlayLoaded` and calls `mountOverlay()`.
7. On open: creates `#cortex-overlay-root`, attaches shadow root, injects `themeTokensCss()` + `overlay.shadow.css`, applies theme from `cortex_user_settings.theme`.

**Restricted URLs** (`chrome://`, etc.): side panel uses `search-shell.html` (`manifest.side_panel.default_path`), which mounts the same overlay in `shell: true` mode (no page inject).

Source pointers:

- `src/lib/overlay-injector.ts` — `OVERLAY_BUNDLE_FILE = "overlay.js"`
- `src/background/service-worker.ts` — `openSearchOnTab` / `deliverOpenSearchMessage`
- `src/content/overlay-entry.ts`, `src/content/overlay.ts`, `src/content/main.ts` (comment: overlay not in always-on CS)
- `src/search/search-shell.ts` — shell mount path

---

## 3. Current theme summary

| Surface | Theme behavior | Mechanism |
|---------|----------------|-----------|
| **Options** | **Light-only** chrome | `options.css`: `color-scheme: light`. Bridges to `cortex-theme.css`. Appearance radios **save** `theme` for the panel; they do **not** restyle Settings. Copy: “How the Cortex panel looks while you browse.” |
| **Popup** | **Light-only** | `popup.css`: `color-scheme: light` + `cortex-theme.css` |
| **Onboarding** | **Light-only** | `cortex-theme.css` + onboarding layout CSS |
| **Overlay** (in-page) | **Light / Dark / System** (default **system**) | `src/shared/theme.ts` → `themeTokensCss()` on `:host` / `:host([data-theme="dark"])`; `applyThemeToHost`; setting from `getUserSettings().theme` |
| **Search shell** | Same as overlay + page bg | `search-shell.css` sets `html`/`body` bg light `#e4e2dd` or dark `#141312` when `html[data-theme="dark"]`; overlay also mirrors theme onto `document.documentElement` in shell mode |

### Token files (two intentional sources after Pass 3 unify)

| File | Role |
|------|------|
| `src/styles/cortex-theme.css` → `dist/cortex-theme.css` | Extension pages (options / popup / onboarding). Accent `#a82207`, warm beige surfaces. Light only. |
| `src/styles/cx-buttons.css` → `dist/cx-buttons.css` | Shared `.cx-btn*` for options / popup / onboarding. |
| `src/shared/theme.ts` | Overlay + search-shell palettes. Light accent `#b8250a` (header gradient contrast); dark accent `#ef7554`. Emits `--cx-*` into shadow. Contrasts gated by `tests/theme.test.ts`. |
| `src/content/overlay.shadow.css` | Overlay layout / controls; consumes `--cx-*` (incl. dark confidence badge overrides). |
| `src/options/options.css` | Options layout; aliases `--accent` etc. to `--cx-*` from linked theme CSS. |
| `docs/UI_DECISIONS.md` | Documents light-only options vs overlay L/D/System and measured contrast table. |

Accent bridge (documented Pass 3): pages `#a82207` vs overlay light `#b8250a` — same brand family, intentional for WCAG on the overlay header gradient.

---

## 4. Recommended theme decision (for visual review)

**Recommendation: Keep Settings / popup / onboarding light-only; keep overlay + search-shell on Light / Dark / System.**

### Why this is the clear approach

1. **Already product policy.** Appearance section scopes the picker to the browsing panel; Settings does not flip with OS dark. Predictable admin chrome (Linear / Raycast–style restraint) matches `docs/UI_DECISIONS.md` and Pass 3 token work.
2. **Static HTML review will not look “broken.”** Opening `options.html` / `popup.html` as `file://` always paints light. If Settings followed system/dark, a dark OS + light token gaps would look like unfinished theming during this review.
3. **Overlay dark is the right place for dark.** The panel sits on arbitrary host pages; dark/system reduces glare and matches user OS. `search-shell.html` is the static stand-in for that surface—review light and dark there (force `data-theme` if storage is unavailable).
4. **Avoid “half-dark Settings.”** Extending dark to options/popup without a full second palette for every settings section would recreate the Pass 2 “three products” feel. Prefer one deliberate split over a rushed full-app dark mode.

### What visual review should validate (parent / computerUse)

- Options + popup + onboarding: warm beige light chrome, shared buttons, no accidental dark flash.
- Search-shell / overlay light: tokens align with page surfaces (beige family).
- Search-shell / overlay dark: readable text, accent contrast, confidence badges; host/page background `#141312` in shell mode.
- If overlay dark looks **jarringly** brand-different from light Settings (not just mode difference), prefer tightening **accent/surface bridge** (single generator later)—**do not** flip Settings to dark as the first fix unless review finds light Settings actively confusing next to a dark panel.

### Explicit non-goals this pass

- Do not implement full Settings/popup dark mode in this review pass.
- Do not fill OAuth release / store build.
- Do not push, open PR, or change git config.

---

## 5. Quick open checklist for computerUse

1. `file:///workspace/cortex-work/Cortex/dist/options.html` — Settings layout, Appearance picker (expect light page).
2. `file:///workspace/cortex-work/Cortex/dist/popup.html` — Toolbar popup.
3. `file:///workspace/cortex-work/Cortex/dist/onboarding.html` — First-run.
4. `file:///workspace/cortex-work/Cortex/dist/search-shell.html` — Overlay UI shell; force dark via `data-theme="dark"` if needed.
5. Remember: real in-page overlay requires a loaded extension + injectable tab (`overlay.js` inject), not a lone `file://` HTML.

*End of Pass 4 frontend map.*
