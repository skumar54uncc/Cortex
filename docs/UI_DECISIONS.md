# Options page redesign — UI decisions

Decisions made where the spec left room for interpretation. All aim at Linear / Raycast / Anthropic Console–style restraint.

## Typography

- **Plus Jakarta Sans** (existing Cortex brand via `injectBrandFontFacesInto`) instead of Inter. The extension already bundles this face; no CDN. Weight 500 on labels is synthesized from 400/700 files.
- Stat numbers use `--font-size-stat` (32px) rather than xl (24px) for clearer hierarchy in the library card.

## Accent color

- Light: `#c72a09` (existing header/logo coral-red).
- Dark: `#e05a3a` (slightly lighter for contrast on `#0e0e0d`).

## Theme

- Light mode only on the options page (dark-mode toggle removed per product request).

## Favicons in recent activity

- Google s2 favicon API by hostname (works under extension CSP) with letter fallback on error—not `chrome://favicon/` (unreliable from extension pages).

## History import running state

- Keeps detailed progress text from prior implementation; adds `.is-running` for CSS spinner prefix. Idle shows no status line (empty), matching spec.

## Delete confirmation

- Inline panel with type `DELETE` **or** enabled Confirm within 5s of opening (covers “second click” without `window.confirm`).

## Footer

- Omits ARCHITECTURE.md link per earlier product request; retains “Built by Shailesh Kumar · Version 1.0.1”.

## Bundle size

- Target was ≤4KB growth for `options.js`; with the full UI layer (theme, deduped recent list, save feedback, delete confirm, stat animation) production `options.js` is ~+7.3KB vs the prior options entry (~30.4KB → ~38.1KB). `history-import` is type-only in TS to avoid pulling fetch-security into this chunk. Further trimming would drop spec’d behavior (favicon rows, structured import metrics, or save spinners).
