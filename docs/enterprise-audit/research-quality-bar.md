# Enterprise quality bar — research (Pass 1)

**Date:** 2026-10-02 (America/New_York)  
**Repo commit skimmed:** `2f0ef75` on `main` (or later)  
**Scope:** Articulate what a durable, enterprise-grade Manifest V3 Chrome extension needs for UI polish, accessibility, honest empty/error states, settings UX, release discipline, and tests that match privacy claims. Read-only exploration of Cortex; no application/source edits.

This note is the quality bar for Pass 2 (full audit). It is criteria-first, with a short Cortex surface map and early observations only.

---

## 1. What “enterprise-grade / not vibe-coded” means here

A durable MV3 extension that enterprises and privacy-conscious individuals will trust does not look like a weekend prototype with marketing headlines in Settings. It looks like Linear / Raycast / Anthropic Console: restraint, one design system, predictable controls, honest failure, and automated proof that store/privacy claims match the code.

For Cortex specifically, the product promises compound the bar:

- Library on device; no Cortex server; no telemetry.
- Optional Assistant Sync → user’s Google Drive folder `Cortex Memory` only after Enable; `chrome.identity.getAuthToken`; OAuth scope `drive.file` only.
- Intentional limits (not defects): Content excerpts only after a real ≥5-minute read; dwell left blank until measured — never invent data to “fill” empty cells.

Chrome Web Store [best practices](https://developer.chrome.com/docs/webstore/best-practices) already require accurate privacy disclosures, MV3, and a UX that respects privacy. Enterprise buyers additionally expect managed policy clarity, WCAG-aligned UI, and a release checklist that is repeatable—not tribal knowledge.

---

## 2. Cortex surface map (paths only)

UI and privacy-critical areas found in-repo. Paths relative to repo root.

### Manifest and packaging

- `manifest.json`
- `managed_schema.json`
- `package.json`
- `webpack.config.js`
- `icons/`
- `fonts/`

### Extension pages (HTML / CSS / TS)

- `src/options/options.html`
- `src/options/options.css`
- `src/options/options.ts`
- `src/options/assistant-sync-panel.ts`
- `src/options/managed-ui.ts`
- `src/options/backup-ui.ts`
- `src/popup/popup.html`
- `src/popup/popup.css`
- `src/popup/popup.ts`
- `src/popup/popup-stats.ts`
- `src/onboarding/onboarding.html`
- `src/onboarding/onboarding.css`
- `src/onboarding/onboarding.ts`
- `src/search/search-shell.html`
- `src/search/search-shell.css`
- `src/search/search-shell.ts`
- `src/offscreen/offscreen.html`
- `src/offscreen/offscreen.ts`
- `src/offscreen/image-describer.ts`
- `src/offscreen/pdf-fetch.ts`
- `src/offscreen/pdf-extract.ts`

### In-page overlay (content / shadow UI)

- `src/content/main.ts`
- `src/content/overlay.ts`
- `src/content/overlay-entry.ts`
- `src/content/overlay-host.ts`
- `src/content/overlay.shadow.css`
- `src/content/extract.ts`
- `src/content/extract-entry.ts`
- `src/content/focus-trap.ts`
- `src/content/chat-drawer.ts`
- `src/content/chat-history.ts`
- `src/content/chat-stream-controller.ts`
- `src/content/forget-menu.ts`
- `src/content/people-view.ts`
- `src/content/resurface-chip.ts`
- `src/content/resurface-chip-view.ts`
- `src/content/scope-bar.ts`
- `src/content/citation-cards.ts`
- `src/content/example-prompts.ts`
- `src/content/layout-mode.ts`
- `src/content/markdown-render.ts`
- `src/content/stream-renderer.ts`
- `src/content/youtube-bridge.ts`
- `src/content/youtube-capture.ts`
- `src/lib/overlay-injector.ts`

### Design tokens / shared UI primitives

- `src/styles/cortex-theme.css` (options / popup brand tokens)
- `src/shared/theme.ts` (overlay / side-panel light+dark tokens + contrast helpers)
- `src/shared/extension-settings.ts`
- `src/shared/managed-policy.ts`
- `src/shared/shell-routing.ts`
- `src/shared/storage-local.ts`
- `src/lib/i18n.ts`
- `src/lib/locales/en.json`
- `src/lib/site-badge.ts`
- `docs/UI_DECISIONS.md`

### Background / sync / privacy-critical logic

- `src/background/service-worker.ts`
- `src/assistant-sync/` (capture, sync-engine, drive-api, excerpt, sheet, redact-sync, preferences, denylist, …)
- `src/lib/data-controls.ts`
- `src/lib/forget-request.ts`
- `src/lib/pii-filter.ts`
- `src/lib/url-security.ts`
- `src/lib/message-security` (via tests: `tests/message-security.test.ts`)
- `src/lib/agent-debug-log.ts`
- `src/db/`

### Privacy / store / enterprise docs (public-facing claims)

- `docs/PRIVACY_POLICY.md`
- `docs/privacy-policy.html`
- `docs/data-deletion.html`
- `docs/ENTERPRISE.md`
- `docs/SECURITY_REVIEW_1.md`
- `SECURITY.md`
- `docs/release-1.2.0/STORE_RELEASE.md`
- `docs/release-1.2.0/PERMISSIONS.md`
- `docs/release-1.2.0/REPORT.md`
- `docs/store-listing.md`

### Tests that already touch quality / privacy

- `e2e/a11y.spec.ts` (axe on overlay + extension pages)
- `e2e/focus.spec.ts`
- `tests/theme.test.ts`
- `tests/manifest.test.ts` (incl. `drive.file` OAuth limit)
- `tests/assistant-sync*.test.ts` (excerpt/dwell honesty, consent copy)
- `tests/managed-policy.test.ts`
- `tests/options-managed-ui.test.ts`
- `tests/data-controls.test.ts`
- `tests/oauth-client.test.ts`
- `tests/message-security.test.ts`
- `docs/release-1.2.0/axe-report.json`

---

## 3. Design system quality bar

### 3.1 Single source of truth

| Criterion | Pass condition |
|-----------|----------------|
| Token ownership | One documented token set (or a clear split: “extension pages” vs “overlay shadow”) with names that match across CSS and TS. No silent drift of accent hex, type scale, or semantic colors. |
| Type scale | Named steps only (e.g. caption / small / body / title / display / metric). No one-off `font-size: 15px` / `0.92em` outside the scale without a documented exception. |
| Spacing / radius | A small scale (4/8/12/16/24…) used consistently; cards and panels share the same radius and border treatment. |
| Buttons | Shared variants: primary, secondary, ghost, danger; sizes sm/md; disabled, loading, focus-visible states defined once. |
| Form controls | Native or ARIA-correct custom toggles/radios with the same focus ring and error association pattern on every surface. |
| Semantic color | Success / warning / danger / focus tokens used for status—not ad-hoc orange gradients for “energy.” |
| Iconography | SVG (or one icon set) with `aria-hidden` when decorative; no emoji as UI icons in Settings / status rows. |

### 3.2 Focus and interactive states (non-negotiable)

- Visible `:focus-visible` on every interactive control; never remove outlines without a replacement ring that meets contrast.
- Hover / active / disabled are distinct; disabled controls are not only color-coded (Chrome a11y guidance: keyboard focus must remain obvious).
- Custom controls (toggles, radio cards) expose correct `role` / `aria-checked` / `aria-labelledby` and are operable with Space/Enter.

### 3.3 Tone of UI chrome

Enterprise Settings is not a landing page:

- No marketing headlines (“Unlock your second brain”).
- No gradient “hero” cards in Settings.
- No placeholder / lorem / “Coming soon ✨” copy in shipping UI.
- Section titles describe what the control does; helper text is factual and short.

Cortex’s options page already aims at Linear/Raycast restraint (`docs/UI_DECISIONS.md`); the bar is to keep every surface at that standard, including popup and overlay empty states.

---

## 4. Accessibility quality bar

Primary references:

- [Chrome Extensions — Support accessibility](https://developer.chrome.com/docs/extensions/how-to/ui/a11y)
- [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22/) (practical floor for enterprise buyers)

### 4.1 Concrete criteria

| Area | Actionable bar |
|------|----------------|
| Keyboard | Every feature reachable without a mouse. Overlay: initial focus in primary field; Tab cycles inside dialog; Escape closes and restores prior focus (already covered by `e2e/focus.spec.ts` intent). |
| Focus trap | Modal/dialog patterns use a real trap; side panel / search shell remain orderly under Tab. |
| Contrast | Text/UI components ≥ **4.5:1** for normal text, ≥ **3:1** for large text and non-text UI (WCAG 1.4.3 / 1.4.11). Automated token tests (`tests/theme.test.ts`) plus axe. |
| Zoom | Usable at **200%** page zoom (Chrome a11y “200% test”; WCAG 1.4.4). |
| Name, role, value | Buttons/links have accessible names; switches expose state; live regions for save/error feedback (`aria-live` / `role="status"` / `role="alert"` as appropriate). |
| Skip link | Multi-section options pages offer skip-to-main (present on options). |
| Images | Decorative `alt=""`; meaningful images describe purpose, not pixels. |
| Motion | Prefer reduced-motion respect for non-essential animation (`prefers-reduced-motion`). |
| Automated gate | axe-core **serious/critical = 0** on overlay (light+dark), options, popup, onboarding, search-shell (`e2e/a11y.spec.ts` pattern). Manual screen-reader spot-check of Assistant Sync Enable flow and Forget/Delete. |

### 4.2 Custom control rule

Prefer native HTML controls. When custom (radio cards, toggles), implement WAI-ARIA roles/states from the start—Chrome’s a11y guide warns that retrofitting is harder than designing accessible from day one.

---

## 5. Honest empty and error states

### 5.1 Empty states

| Rule | Pass condition |
|------|----------------|
| Truthful | Empty means empty: “No visits logged yet.” / “Nothing relevant in your library.” — not fabricated sample rows. |
| Intentional blanks | Assistant Sync: missing dwell stays blank; no excerpt until measured ≥5 minutes. UI and Drive sheet must not invent values. |
| Actionable | Empty copy says what to do next in one sentence (browse, enable, import)—not a campaign slogan. |
| Visual | Brand mark or simple SVG OK; emoji icons and rainbow gradient cards are out. |
| Consistency | Same empty pattern language across popup, options Library, overlay Ask, search-no-hits. |

### 5.2 Error states

| Rule | Pass condition |
|------|----------------|
| User language | State what failed and what to try; avoid raw stack traces / opaque codes as the only message. |
| Recoverable path | Retry, open Settings, or Sync now when relevant (`renderErrorBlock` + `userAction` pattern in overlay is the right shape). |
| Live regions | Errors that appear after an action are announced (`role="alert"` or polite status as appropriate). |
| Network / identity | OAuth cancel, token revoke, Drive 403/429, offline: each has a distinct, calm message (Chrome Store troubleshooting: communicate error conditions clearly; handle timeouts and HTTP errors). |
| No blame theater | Do not imply the user’s library is “broken” when the intentional 5-minute rule withheld an excerpt. |

### 5.3 Anti-patterns (fail the bar)

- Placeholder copy shipped to production.
- Emoji as status icons in Settings.
- Gradient marketing cards in options.
- Inventing dwell minutes or excerpts to avoid “empty-looking” Drive rows.
- Silent failure (button does nothing; no status line).

---

## 6. Predictable settings UX

| Criterion | Pass condition |
|-----------|----------------|
| Information architecture | Stable section nav (Library, Appearance, Capture, Intelligence, Connect assistant, Privacy, Backup, About). Labels match what the section does. |
| Save model | Explicit: either auto-save with clear “Saved” feedback, or Save buttons that never leave the user unsure. Never half-persisted state without feedback. |
| Destructive actions | Two-step confirm (type DELETE / timed confirm) for wipe; forget actions scoped correctly (tab origin for “this site”). |
| Managed policy | Managed controls disabled + “Managed by your organization”; banner when any policy applies; user values preserved under policy (see `docs/ENTERPRISE.md`). |
| Opt-in clarity | Assistant Sync and cloud chat stay off until the user enables; consent text matches privacy policy (titles, URLs, 5-minute excerpts, searches, LinkedIn, topics; `drive.file` only). |
| External links | Privacy policy and data-deletion links open with `rel="noopener noreferrer"`; copy matches published HTML. |
| Predictable defaults | Theme system default, sync off, image descriptions off, retention documented—not surprise network calls. |

Settings copy should read like a control panel, not App Store promotional text.

---

## 7. Release checklist expectations

A durable release is a checklist, not a vibe. Minimum enterprise MV3 pack:

### 7.1 Build & integrity

- [ ] Clean CI: typecheck, unit tests, build, bundle budgets, `npm audit --omit=dev`, SBOM attached.
- [ ] Packed zip matches what reviewers will see (no source maps in store zip; `manifest.json` at root).
- [ ] Version bump aligned across manifest, About UI, and release notes.

### 7.2 Functional / privacy

- [ ] Privacy policy URL live and **byte-level consistent** with in-extension claims and CWS Privacy practices form.
- [ ] Permission justifications match actual use (`identity` only for Assistant Sync Enable; alarms for sync only after Enable; no undeclared hosts).
- [ ] OAuth scope remains `https://www.googleapis.com/auth/drive.file` only.
- [ ] Incognito policy unchanged (`not_allowed` if that is the product rule).
- [ ] No remote code (MV3 requirement); CSP `script-src 'self' 'wasm-unsafe-eval'`.
- [ ] Manual: Enable → Drive folder created → Sync now → Disable / Delete all moves folder to trash as documented.

### 7.3 UX / a11y gates

- [ ] axe serious/critical = 0 on overlay (light+dark), options, popup, onboarding, search-shell.
- [ ] Focus trap + Escape restore still green.
- [ ] Theme contrast unit test green.
- [ ] Spot-check 200% zoom on options + overlay.
- [ ] Empty/error copy review: no placeholders, no emoji status icons, no marketing heroes in Settings.

### 7.4 Regression / eval

- [ ] Playwright E2E suite green on the packaged build.
- [ ] Known out-of-scope failing tests documented (do not “fix” by inventing data): e.g. `tests/pdf.test.ts` Promise.withResolvers; `tests/embed-parity.test.ts` cosine threshold; `tests/chat-engine-abort.test.ts` token count — track separately; do not block honesty of dwell/excerpt behavior.
- [ ] Assistant Sync unit tests still assert blank dwell / no excerpt without ≥5 minutes.

### 7.5 Store listing

- [ ] Single purpose, screenshots, and “What’s new” match shipped features.
- [ ] Privacy practices form ticks match reality (history, website content, PII for People/LinkedIn if still stored locally).
- [ ] No claim of telemetry if none exists—and no debug ingest left in production paths.

Chrome’s store troubleshooting guidance: test the exact packed submission; communicate errors; listing must not misrepresent capabilities.

---

## 8. Tests that match privacy-policy claims

Privacy text is a contract. Tests should pin the contract so refactors cannot quietly widen collection or invent data.

### 8.1 Claim → test mapping (target bar)

| Privacy / product claim | Test / gate expectation |
|-------------------------|-------------------------|
| No Cortex server / no telemetry | Bundle or source gate: no analytics SDKs; production paths do not POST library content to third parties. Debug localhost ingest must not ship enabled. |
| Indexing stays on device | Architecture/tests around IndexedDB + offscreen; cloud chat only when opted in with user key. |
| Optional Gemini: snippets only | Chat/cloud strip tests (e.g. image descriptions stripped before cloud). |
| Assistant Sync off until Enable | Options/engine tests: default disabled; alarm/sync inactive until Enable. |
| OAuth `drive.file` only | `tests/manifest.test.ts` + drive client scope constant. |
| Consent copy lists titles, URLs, 5-min excerpts, searches, LinkedIn, topics | Snapshot/string assert on options consent (`assistant-sync-options` pattern). |
| Excerpts only if dwell ≥ 5 minutes | `buildExcerpt` unit tests; sync engine leaves blank when dwell null. |
| Dwell blank until measured | Engine/backfill tests assert `null`, not `0` or guessed minutes. |
| Delete all + typed DELETE removes library and trashes Drive folder | Data-controls / drive tests + documented manual check. |
| Managed policy overrides without wiping user prefs | `managed-policy` + `options-managed-ui` tests. |
| Message bus trust boundary | `message-security` tests. |
| WAR / CSP minimize attack surface | `manifest.test.ts` WAR allowlist. |

### 8.2 Copy consistency

Automated or checklist compare:

- `docs/PRIVACY_POLICY.md` ↔ `docs/privacy-policy.html` ↔ options Assistant Sync consent ↔ CWS privacy form answers in `docs/release-1.2.0/STORE_RELEASE.md`.

Drift between these is an enterprise defect even if code is correct.

---

## 9. Early observations (Pass 1 only — not a full audit)

Grounded in skim of commit `2f0ef75`; full severity triage is Pass 2.

### Strengths already visible

- Options page: skip link, section nav, managed banner, radio cards with ARIA, honest Assistant Sync consent (5-minute excerpts called out), status `dl`, destructive delete confirm.
- Overlay: dialog roles, focus trap E2E, structured `renderErrorBlock`, chat empty state with factual hint (not emoji spam).
- Theme contrast unit tests + axe gate across overlay and extension pages.
- Manifest tests pin `drive.file`; assistant-sync tests explicitly refuse invented excerpts when dwell is blank.
- Enterprise managed policy + docs (`docs/ENTERPRISE.md`) are unusually mature for a solo MV3 product.

### Gaps / inconsistencies to verify in Pass 2

1. **Dual token systems** — `src/styles/cortex-theme.css` (extension pages; accent `#a82207`) vs `src/shared/theme.ts` (overlay; light accent `#b8250a`). Type scales also differ (`--cx-ts-*` vs options `--font-size-*`). Enterprise bar wants one documented mapping or a single generator.
2. **Button / CSS duplication** — `.cx-btn*` redefined in `options.css` and `popup.css`; overlay uses separate `cortex-*` classes in `overlay.shadow.css`. Risk of divergent focus/disabled treatment.
3. **Decorative gradients** — `linear-gradient` remains in popup progress, options (stat skeleton area), and overlay chrome. Confirm none read as “marketing hero cards” in Settings; popup accent gradient may feel less restrained than options.
4. **Popup refresh control** — uses a text “↻” glyph as the visible icon (`popup.html`); enterprise bar prefers SVG + accessible name only (name exists; glyph tone is slightly informal).
5. **Axe coverage depth** — pages are audited on load; Assistant Sync Enable / error / managed-policy states and overlay “no results” / Drive failure paths may need dedicated scenarios.
6. **Privacy claim vs debug ingest** — `src/lib/agent-debug-log.ts` contains a `fetch` to a localhost ingest URL. Confirm it cannot run in production builds; otherwise it conflicts with “no telemetry” messaging even if local-only.
7. **Settings vs overlay theme** — options stay light-only while overlay supports light/dark/system (`docs/UI_DECISIONS.md`). Document as intentional or align for predictability.
8. **Release checklist location** — strong material lives in `docs/release-1.2.0/*` and CI, but a single evergreen `docs/enterprise-audit/` release checklist (Pass 2 deliverable territory) would make the bar enforceable every ship.

### Non-defects (do not “fix”)

- Blank dwell / missing Content excerpts before a real 5-minute read.
- Out-of-scope failing tests listed in the task brief (`pdf.test.ts` Promise.withResolvers; `embed-parity.test.ts` cosine; `chat-engine-abort.test.ts` token count)—track, do not paper over with invented behavior.

---

## 10. Pass 2 handoff

Pass 2 should score Cortex against §§3–8 surface-by-surface, cite file paths and copy snippets, and produce a gap list with severity—without editing `src/`, tests, or manifest. Prefer concrete diffs-of-expectation (“options accent token ≠ overlay accent token”) over taste commentary.

