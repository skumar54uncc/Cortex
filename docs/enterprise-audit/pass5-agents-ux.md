# Pass 5 — Connect AI Agents UX

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Track:** In-panel Agents tab, coach marks, delayed local feedback, typography readability  
**Out of this track:** OAuth release fill; search-engine / ranking / query-* / similarity; new npm deps; telemetry backend; git commit / push.

---

## Product shipped

| Item | Status | Notes |
|------|--------|-------|
| **Connect AI Agents tab** | **shipped** | New overlay tab beside People & Companies (`AGENTS_TAB_LABEL`). How-to steps, sheet rules (live Cortex Memory only), Assist Sync deep link to `#cx-sec-assistant`, one shared copyable prompt with assistant chips (Claude / ChatGPT / Gemini / Cursor-style / generic). |
| **Coach marks** | **shipped** | First-run tips for Search, Ask, People, Agents, Assist Sync (gear). One tip at a time. Dismissals in `chrome.storage.local` (`cortex_ux_local_v1`). |
| **Delayed feedback** | **shipped** | After 7 days **or** (≥20 indexed pages and ≥3 panel opens). Thumbs + optional note stored locally. Optional GitHub issue / mailto. 90-day quiet after dismiss or submit. No new analytics service. |
| **Typography** | **shipped** | System UI stack clarified (`-apple-system`, Noto Sans). Body type ~15px / 1.55 on overlay + options + popup tagline/privacy. No decorative fonts. |
| **Enterprise polish** | **shipped** | Focus-visible on new controls; sober empty-free Agents how-to; error-free copy tone (no em dashes, no emoji). |

---

## Files changed

- `src/shared/agent-prompts.ts` (new)
- `src/shared/ux-local.ts` (new)
- `src/content/agents-view.ts` (new)
- `src/content/coach-marks.ts` (new)
- `src/content/feedback-card.ts` (new)
- `src/content/overlay.ts`
- `src/content/overlay.shadow.css`
- `src/background/service-worker.ts` (`CORTEX_OPEN_OPTIONS` section whitelist for Assist Sync)
- `src/styles/cortex-theme.css`
- `src/options/options.css`
- `src/popup/popup.css`
- `tests/agent-prompts.test.ts` (new)
- `tests/ux-local.test.ts` (new)
- `tests/agents-tab.test.ts` (new)
- `scripts/check-bundle-budget.mjs` (overlay/search-shell 140→155 KiB)
- `docs/enterprise-audit/pass5-agents-ux.md` (this file)

---

## Privacy

- Coach dismissals and feedback thumbs/notes stay in `chrome.storage.local`.
- Opening GitHub or email is user-initiated only.
- No new telemetry endpoint, no new analytics npm package.

---

## Constraints verified

- Did not edit `search-engine.ts`, `ranking.ts`, `query-relevance.ts`, `query-parse.ts`, `similarity.ts`.
- Did not change OAuth item id / public key; `config/oauth-clients.json` release left empty.
- Assist Sync Google fetch remains in assistant-sync chunk; no offscreen `chrome.storage`.
- Interactive `getAuthToken` path unchanged (Enable click only).
- schema_version 3 for Assist Sync About sheet untouched.

---

## Bundle budget

- `overlay.js` / `search-shell.js` budgets raised **140 KiB → 155 KiB** for Agents tab, coach marks, and local feedback CSS/logic.
- `service-worker.js` budget unchanged (**220 KiB / 225280 bytes**). Pass 5 SW growth is small (Assist Sync options deep link only).

## Verification

| Command | Expected |
|---------|----------|
| `npx tsc --noEmit` | Pass |
| `npx vitest run tests/agent-prompts.test.ts tests/ux-local.test.ts tests/agents-tab.test.ts tests/assistant-sync*.test.ts` | Pass |
| `npm run build && npm run check:budget` | Pass (SW ≤225280 / 220 KiB) |
