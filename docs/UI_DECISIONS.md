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

- Site badges are drawn on the device from the host name (one letter on a colour derived from the host, `src/lib/site-badge.ts`). Release 1.2.0 removed the Google s2 favicon API: it sent one request per domain the user had read to a third party, which core value 1 forbids. `chrome://favicon/` was not used either (unreliable from extension pages, and it needs a permission).

## History import running state

- Keeps detailed progress text from prior implementation; adds `.is-running` for CSS spinner prefix. Idle shows no status line (empty), matching spec.

## Delete confirmation

- Inline panel with type `DELETE` **or** enabled Confirm within 5s of opening (covers “second click” without `window.confirm`).

## Footer

- Omits ARCHITECTURE.md link per earlier product request; retains “Built by Shailesh Kumar · Version 1.0.1”.

## Bundle size

- Target was ≤4KB growth for `options.js`; with the full UI layer (theme, deduped recent list, save feedback, delete confirm, stat animation) production `options.js` is ~+7.3KB vs the prior options entry (~30.4KB → ~38.1KB). `history-import` is type-only in TS to avoid pulling fetch-security into this chunk. Further trimming would drop spec’d behavior (favicon rows, structured import metrics, or save spinners).

## Dark mode (release 1.2.0)

The overlay and side panel shell support Light, Dark and System (default). The setting lives in `cortex_user_settings.theme` and is picked from Options, Appearance. Tokens are defined once in `src/shared/theme.ts` and injected into the shadow root as custom properties on `:host` (light) and `:host([data-theme="dark"])` (dark). `tests/theme.test.ts` fails the build if any pair below drops under 4.5:1.

Light accent moved from `#c72a09` to `#b8250a` so accent text also clears 4.5:1 on the header gradient background (`--cx-bg`), not only on `--cx-surface`.

Measured contrast (WCAG 2.x, `contrastRatio` in `src/shared/theme.ts`):

| Theme | Foreground | Background | Ratio |
|-------|-----------|------------|-------|
| light | text #1c1917 | bg #e4e2dd | 13.51:1 |
| light | text #1c1917 | surface #f7f5f0 | 16.05:1 |
| light | text #1c1917 | surfaceInput #fffef9 | 17.32:1 |
| light | textMuted #3f3f46 | surface #f7f5f0 | 9.59:1 |
| light | textSubtle #52525b | surface #f7f5f0 | 7.09:1 |
| light | link #9a3412 | surface #f7f5f0 | 6.71:1 |
| light | accent #b8250a | surface #f7f5f0 | 5.83:1 |
| light | accent #b8250a | bg #e4e2dd | 4.91:1 |
| dark | text #f2efe9 | bg #141312 | 16.17:1 |
| dark | text #f2efe9 | surface #1e1c1a | 14.80:1 |
| dark | text #f2efe9 | surfaceInput #262321 | 13.61:1 |
| dark | textMuted #c9c4bb | surface #1e1c1a | 9.79:1 |
| dark | textSubtle #a8a29a | surface #1e1c1a | 6.71:1 |
| dark | link #f4a28a | surface #1e1c1a | 8.40:1 |
| dark | accent #ef7554 | surface #1e1c1a | 5.94:1 |
| dark | accent #ef7554 | bg #141312 | 6.49:1 |

Confidence badges (Strong, Good, Looser) have dedicated dark overrides at the end of `overlay.shadow.css`. The options page stays light (earlier product decision) apart from the theme picker itself.

## Responsive layout (release 1.2.0)

The panel is one size for every tab: `width: min(960px, 100vw - 32px)`, `height: min(760px, 100dvh - 48px)`, centered. Inside, `data-layout` on the panel is set by a ResizeObserver from the panel width: wide (880px and up) keeps a 240px chat sidebar; medium (560 to 879) turns it into a drawer behind a "Chats" button with `aria-expanded`; narrow (under 560) stacks everything in one column with a collapsible "Chats" header and stacked source rows.
