# Cortex enterprise audit — Pass 2 half B: UI / product surfaces

**Audit date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Scope:** READ ONLY on application code. Findings written only under `docs/enterprise-audit/`. No `src/` edits, no eval edits, no push/PR/git-config changes.  
**Quality bar:** `docs/enterprise-audit/research.md` §4 and `docs/enterprise-audit/research-quality-bar.md` (one product feel; named type scale; shared buttons; real focus; no placeholder/emoji/gradient marketing in Settings; no user-facing em dashes).

---

## Counts by severity

| Severity | Count |
|----------|------:|
| blocker | 0 |
| store-review risk | 2 |
| user-facing defect | 7 |
| polish | 8 |
| **Total findings** | **17** |

Top defects that break **“one product” feel** (popup ≠ options ≠ overlay):

1. **Triple accent / token sources** (`#c72a09` / `#a82207` / `#b8250a`) with three type-scale systems.
2. **Duplicated button CSS** with divergent secondary style, radius, and focus-ring weight.
3. **Popup CTA chrome** (hero shadow, orange storage gradient, `↻` glyph) vs Linear/Raycast options restraint.
4. **Assistant Sync** Enable-only (no Disable) and Sync now always available — settings predictability gap on a privacy-critical control.

---

## store-review risk

### SR-1 — Indexing and first-install history scan start without affirmative consent

- **Severity:** store-review risk  
- **Title:** No in-product affirmative consent before local indexing / history backfill  
- **Path(s):**
  - `src/background/service-worker.ts` (`onInstalled` → `maybeRunFirstInstallBackfill`, open-tab priming, history import)
  - `src/shared/onboarding-constants.ts` (`FIRST_INSTALL_HISTORY_DAYS = 30`, `FIRST_INSTALL_HISTORY_MAX_URLS = 500`)
  - `src/onboarding/onboarding.html` (disclosure after the fact)
  - `src/lib/first-install-history-notify.ts` (notifications while scan already running)
  - `src/popup/popup.html` / `src/popup/popup.ts` (dismissible privacy blurb, `cortex_popup_privacy_ack_v1`)
- **Evidence:** On `install`, SW kicks history import (30 days / 500 URLs) and open-tab indexing in parallel with opening onboarding. Onboarding copy is past-tense/ongoing: *“Getting ready. Cortex is saving your recent browsing and open tabs in the background…”* — not an Enable/Agree gate. Popup privacy note can be permanently dismissed; there is no separate “Start indexing” control. Continuous page indexing also proceeds whenever content scripts run (product default), gated only by Pause later in Settings.
- **Why:** CWS User Data FAQ: handling browsing activity **even when stored only locally** requires **prominent disclosure + affirmative informed consent in the Product UI** before collection; store listing alone is insufficient (research.md §2.6, store-review checklist item 2). Reviewers map this to Purple Lithium / disclosure failures.
- **Suggested fix direction:** First-run modal or onboarding step with explicit **Start indexing** (and optional **Scan last 30 days**) before `maybeRunFirstInstallBackfill` / live indexing; keep Pause as ongoing control. Do not mark backfill done until the user opts in.

### SR-2 — Persistent indexing disclosure is easy to lose on the most-seen surface

- **Severity:** store-review risk  
- **Title:** Popup privacy blurb is one-shot dismissible; core browsing-activity disclosure not sticky  
- **Path(s):** `src/popup/popup.html` (`#cx-privacy-blurb`), `src/popup/popup.ts` (`POPUP_PRIVACY_ACK_KEY`)  
- **Evidence:** After “Got it, do not show again”, the popup no longer states that indexing captures browsing activity on-device. Options About and Assistant Sync consent remain, but the toolbar popup is the high-frequency surface.
- **Why:** 2026 disclosure rules + Limited Use expect browsing activity to stay **prominently** described in-product as the user-facing feature, not only once at first open.
- **Suggested fix direction:** Keep a short always-visible status/disclosure line on popup (or link “What’s indexed” that cannot be fully hidden); reserve dismiss for the long blurb only.

---

## user-facing defect

### UD-1 — Triple design-token sources (accent + surfaces drift)

- **Severity:** user-facing defect  
- **Title:** Dual/triple token systems: options CSS vs cortex-theme.css vs theme.ts  
- **Path(s):**
  - `src/options/options.css` (`--accent: #c72a09`; own `--font-size-*` scale; does **not** import `cortex-theme.css`)
  - `src/styles/cortex-theme.css` (`--cx-accent: #a82207`; `--cx-ts-*` scale; used by popup)
  - `src/shared/theme.ts` (overlay light accent `#b8250a`, dark `#ef7554`; injected into shadow)
  - `docs/UI_DECISIONS.md` (documents overlay tokens; options still on older `#c72a09`)
- **Evidence:** Three shipping accents for “the same” coral brand. Options page background `#fafaf8` / white panels vs popup/overlay warm beige `#e4e2dd`. Type tokens named differently (`--font-size-base` vs `--cx-ts-body` vs raw `font-size: 14px` in overlay).
- **Why:** Quality bar requires one documented token set (or an explicit mapped split). Silent hex drift breaks “one product” across Settings, toolbar, and in-page panel.
- **Suggested fix direction:** Single generator (or documented bridge) emitting CSS + `theme.ts`; options should consume the same accent/surface tokens as popup light theme; keep dark tokens overlay-only if product insists Settings stay light.

### UD-2 — Button primitives redefined three ways

- **Severity:** user-facing defect  
- **Title:** `.cx-btn*` duplicated in options and popup; overlay uses separate `cortex-*` controls  
- **Path(s):** `src/options/options.css` (`.cx-btn` ~L915+), `src/popup/popup.css` (`.cx-btn` ~L152+), `src/content/overlay.shadow.css` (`.cortex-ask-send`, `.cortex-icon-btn`, …)  
- **Evidence:**
  - Focus ring: options `outline: 3px solid var(--focus-ring)` vs popup `outline: 2px solid var(--cx-focus)`.
  - Secondary: options neutral border + `--text`; popup accent-colored border/text (`color: var(--cx-accent)`).
  - Radius: options `--radius-sm` (4px) on buttons vs popup `10px` / hero `11px`.
  - Overlay send control is a bespoke circle/rect, not the shared primary/secondary/ghost/danger set.
- **Why:** Same labels (“primary”, “secondary”) do not mean the same control. Users feel a different product when moving popup → Settings → panel.
- **Suggested fix direction:** One shared button stylesheet (or CSS module) imported by options, popup, onboarding; overlay maps to the same variants inside the shadow root.

### UD-3 — Type scale not shared; many one-off sizes

- **Severity:** user-facing defect  
- **Title:** Named type scales diverge; overlay/popup use ad-hoc px/`em` sizes  
- **Path(s):** `src/options/options.css` (`--font-size-xs`…`--font-size-stat`), `src/styles/cortex-theme.css` (`--cx-ts-display`…`--cx-ts-metric`), `src/content/overlay.shadow.css` (dozens of raw `font-size` including `10px`, `15px`, `0.82em`, `0.92em`), `src/popup/popup.css` (`11px`/`12px`/`15px`/`10px` one-offs)  
- **Evidence:** Options alone also has `font-size: 0.92em` (L532) and `font-size: 10px` (L1181) outside the named scale. Popup metrics use `15px` while theme metric token is `22px`. Overlay has no `--cx-ts-*` consumption.
- **Why:** Bar: named steps only; no undocumented one-offs. Inconsistent hierarchy is the main “vibe-coded” tell across surfaces.
- **Suggested fix direction:** Collapse to one scale (caption/small/body/title/display/metric); replace raw sizes; document rare exceptions.

### UD-4 — Assistant Sync has Enable but no Disable in UI or message bus

- **Severity:** user-facing defect  
- **Title:** Cannot turn Assistant Sync off from Settings (Enable-only)  
- **Path(s):**
  - `src/options/options.html` (`#cx-assistant-enable`, `#cx-assistant-now`; status `dl` only)
  - `src/options/assistant-sync-panel.ts` (Enable → `getAuthToken` + `action: "enable"`; no disable handler)
  - `src/background/service-worker.ts` / `src/assistant-sync/runtime.ts` (actions: `"alarm" | "now" | "enable"` only)
- **Evidence:** Status can show Sync **On**, but the primary control remains **Enable**. No Disable/Stop sync button. Turning sync off appears to require wiping via Forget all / Drive trash path (`data-controls`), not a reversible toggle.
- **Why:** Predictable settings UX: opt-in features must be clearly reversible. Privacy-critical Drive sync without an off control fails the enterprise settings bar and confuses Enable consent narrative.
- **Suggested fix direction:** Add Disable (revoke/stop alarms, set `syncEnabled: false`, optional “keep folder” vs “trash”); swap Enable label/state when on; gate Sync now when off.

### UD-5 — Sync now is always available before Enable

- **Severity:** user-facing defect  
- **Title:** Sync now clickable while sync is Off; failure messaging generic  
- **Path(s):** `src/options/options.html`, `src/options/assistant-sync-panel.ts`, `src/assistant-sync/sync-engine.ts` (`if (!state.syncEnabled) return { status: "disabled", ... }`)  
- **Evidence:** `#cx-assistant-now` is not disabled from `paint(state)`. Engine returns `status: "disabled"`; panel maps non-ok to *“Sync did not finish.”* (or similar) rather than *“Turn on sync with Enable first.”*
- **Why:** Settings predictability — controls that cannot succeed should be disabled or explain the prerequisite.
- **Suggested fix direction:** Disable Sync now until `syncEnabled`; distinct calm copy when fired early.

### UD-6 — Popup interactive controls missing focus-visible treatment

- **Severity:** user-facing defect  
- **Title:** Privacy ack and text-link button lack `:focus-visible` styles  
- **Path(s):** `src/popup/popup.css` (`.cx-privacy-ack`, `.cx-btn-link`; focus-visible only on `.cx-btn`, `.cx-save`, `.cx-stats-refresh`)  
- **Evidence:** `.cx-privacy-ack` and `.cx-btn-link` define hover only. Keyboard users get browser default or no visible ring depending on UA/reset context. Quality bar: visible `:focus-visible` on **every** interactive control.
- **Why:** A11y non-negotiable; popup is audited by axe on load but focus styling gaps still fail the durable bar and Chrome a11y guidance.
- **Suggested fix direction:** Share the same focus ring token as `.cx-btn:focus-visible` on ack + link buttons.

### UD-7 — Empty-state language inconsistent across surfaces

- **Severity:** user-facing defect  
- **Title:** Empty / zero-data copy does not share one pattern language  
- **Path(s):**
  - Options: `src/options/options.html` — *“No visits logged yet.”*
  - Popup: `src/popup/popup.html` — *“Welcome. Browse a few pages to build your private library.”*
  - Overlay search: `src/content/overlay.ts` — *“No matching memory”* + tip list
  - Overlay ask: *“What would you like to know?”* + factual hint (good)
  - Overlay digest: *“Nothing indexed for …”*
- **Evidence:** Mix of welcome marketing tone (popup), factual (options), and metaphorical “memory” (search). Actions differ (Get started → onboarding vs tips vs none).
- **Why:** Bar asks for the **same empty pattern language** across popup, options Library, overlay Ask, search-no-hits.
- **Suggested fix direction:** Shared copy module: truthful lead + one next step; keep Ask empty factual; avoid “memory” metaphor if Settings says “library/pages”.

---

## polish

### P-1 — Popup refresh uses text glyph `↻` as icon

- **Severity:** polish  
- **Title:** Informal refresh glyph instead of SVG icon  
- **Path(s):** `src/popup/popup.html` (`.cx-stats-refresh-icon`)  
- **Evidence:** `aria-hidden` glyph `↻` with accessible name on the button — functionally OK, tone slightly informal vs options SVG chevrons/checks.  
- **Why:** Iconography bar prefers SVG (+ `aria-hidden` when decorative).  
- **Suggested fix direction:** Inline SVG refresh icon; keep `aria-label="Refresh stats"`.

### P-2 — Popup storage bar uses accent→orange marketing gradient

- **Severity:** polish  
- **Title:** Storage meter gradient (`#ea580c`) reads as energy chrome  
- **Path(s):** `src/popup/popup.css` (`.cx-storage-bar` `linear-gradient(90deg, var(--cx-accent), #ea580c)`)  
- **Evidence:** Hard-coded orange not in token set; options Library storage is plain text (`#cx-opt-storage-line`). Overlay gradients observed are skeleton shimmer / people-card legibility scrub — different intent.  
- **Why:** Semantic color bar rejects ad-hoc orange gradients for “energy.”  
- **Suggested fix direction:** Solid accent or success/warning thresholds; no second hue.

### P-3 — Popup primary uses hero shadow / larger CTA

- **Severity:** polish  
- **Title:** `.cx-btn-hero` marketing-weight CTA on toolbar popup  
- **Path(s):** `src/popup/popup.html` (`cx-btn-hero` on Open search), `src/popup/popup.css` (padding 13px, radius 11px, `box-shadow: 0 2px 8px rgba(199, 42, 9, 0.25)`)  
- **Evidence:** Options primaries are flat 36px / radius-sm without glow.  
- **Why:** One product feel — popup should use the same primary weight as Settings.  
- **Suggested fix direction:** Drop hero variant; use shared `cx-btn-primary`.

### P-4 — Section title “Connect with your AI assistant” is promotional vs control-panel tone

- **Severity:** polish  
- **Title:** Settings nav/section headline leans marketing  
- **Path(s):** `src/options/options.html` (`#cx-assistant-h`, nav “Connect assistant”), `src/popup/popup.html` (secondary CTA same phrase)  
- **Evidence:** Consent body itself is strong and factual; the H2/CTA framing is App Store–adjacent compared to “Library”, “Capture”, “Privacy and data”.  
- **Why:** Bar: Settings is not a landing page; section titles describe what the control does.  
- **Suggested fix direction:** Rename to “Assistant Sync” / “Google Drive sync” matching folder name and privacy policy.

### P-5 — Axe gate covers load/happy paths only

- **Severity:** polish  
- **Title:** axe serious/critical=0 on idle pages; Enable / error / managed / empty library states untested  
- **Path(s):** `e2e/a11y.spec.ts`, `docs/release-1.2.0/axe-report.json` (all listed surfaces `violations: []`)  
- **Evidence:** Overlay exercises search/ask/digest/forget menu and narrow drawer; extension pages are single `goto` + audit. No Assistant Sync Enable, Drive error, managed banner lockout, or library-empty popup scenarios.  
- **Why:** Release bar wants serious/critical=0 including interactive privacy flows.  
- **Suggested fix direction:** Add targeted axe scenarios for managed lockout, assistant feedback `is-error`, delete confirm open, popup empty state.

### P-6 — Popup lacks `prefers-reduced-motion` for animated chrome

- **Severity:** polish  
- **Title:** Storage bar width transition / busy refresh spin without reduced-motion guard  
- **Path(s):** `src/popup/popup.css` (`.cx-storage-bar` transition; `.cx-stats-refresh--busy`); compare `src/options/options.css` and `src/content/overlay.shadow.css` which do gate motion  
- **Evidence:** Options/overlay already respect `prefers-reduced-motion`; popup does not for these flourishes.  
- **Why:** A11y motion criterion.  
- **Suggested fix direction:** Mirror overlay’s reduce media query.

### P-7 — Appearance theme picker copy is good but could state Settings stays light

- **Severity:** polish  
- **Title:** Theme applies to panel; Settings/popup stay light without explicit “this page” note  
- **Path(s):** `src/options/options.html` (Appearance: *“How the Cortex panel looks while you browse.”*), `docs/UI_DECISIONS.md` (options light-only intentional)  
- **Evidence:** Sec-desc correctly scopes to the panel; System/Light/Dark cards do not say the options chrome itself will not change. Predictability gap is small because the desc is already panel-scoped.  
- **Why:** Research early observation #7.  
- **Suggested fix direction:** One helper line: “Settings and the toolbar popup stay light.”

### P-8 — Overlay / options one-off `em` font sizes

- **Severity:** polish  
- **Title:** `0.92em` / `0.82em` exceptions without documented rationale in UI  
- **Path(s):** `src/options/options.css` L532; `src/content/overlay.shadow.css` L1410, L2577  
- **Evidence:** Outside named scales; likely for dense meta rows.  
- **Why:** Bar allows documented exceptions only.  
- **Suggested fix direction:** Map to caption token or comment `/* exception: … */` in the design-token doc.

---

## Intentional limits / non-findings

Do **not** treat these as defects (research.md §7 / quality bar):

| Item | Notes |
|------|--------|
| **Blank dwell until measured** | Assistant Sync / UI must not invent minutes. Code comments and engine leave dwell null — correct. |
| **No excerpt before real ≥5-minute read** | Consent copy and Content tab rules correctly state this; missing excerpts are honesty, not empty-state bugs. |
| **Options page light-only** | Documented product decision in `docs/UI_DECISIONS.md`; Appearance theme targets overlay/side panel. Not a defect if copy stays clear (see P-7). |
| **Skeleton / shimmer gradients** | Options stat skeleton and overlay `.cortex-skel-row` are loading affordances with reduced-motion fallbacks in overlay — not Settings marketing hero cards. |
| **People-card name gradient scrub** | `overlay.shadow.css` bottom gradient on `.cortex-person-name` is contrast/legibility over photos, not a Settings hero. |
| **No user-facing em dashes** | Scan of `src/options`, `src/popup`, `src/onboarding`, `src/search`, `src/content`, `src/lib/locales`: U+2014 appears in **code comments** only, not shipping UI sentences. Ellipsis `…` and curly apostrophes appear in UI (allowed by this bar’s em-dash rule). |
| **No emoji status icons in Settings** | Options uses SVG for managed lock, chevrons, radio checks. Popup `↻` is polish (P-1), not Settings emoji spam. |
| **No placeholder / lorem / “Coming soon”** in shipping Settings | Input `placeholder=` attributes are field hints (collection name, example.com), not fake content. |
| **Assistant Sync consent copy quality** | Options consent lists titles, URLs, 5-minute excerpts, searches, LinkedIn, topics, `Cortex Memory` folder, Enable gate; privacy + data-deletion links use `rel="noopener noreferrer"`. OAuth `getAuthToken({ interactive: true })` only from Enable click — matches Identity guidance. |
| **Overlay error shape** | `renderErrorBlock` + `userAction` / settings link pattern is the right recoverable error tone. |
| **Skip link, radio cards ARIA, managed banner, delete type-DELETE** | Options meets much of the settings/a11y bar already. |
| **axe idle clean** | Prior release report shows 0 violations on audited idle surfaces — keep the gate; deepen scenarios (P-5). |
| **Search-shell** | Thin host (`search-shell.html/css/ts`) mounts shared overlay — correct; inherits overlay token/button issues rather than adding a fourth system. |
| **Onboarding reuses options.css** | Aligns welcome with Settings visual system (good); still waits on UD-1 token unification. |

---

## Surface scorecard (summary)

| Surface | One-product tokens | Buttons/focus | Empty/error tone | Privacy/consent UX | Notes |
|---------|--------------------|---------------|------------------|--------------------|-------|
| Options | Own palette (`#c72a09`) | Strong focus-visible; shared only with onboarding | Factual library empty; good alerts | Sync consent strong; indexing consent weak (install) | Best-polished surface |
| Popup | `cortex-theme` (`#a82207`) | Divergent secondary; ack/link focus gaps | Welcome-ish empty | Dismissible disclosure | Most “different product” |
| Overlay / search-shell | `theme.ts` (`#b8250a` / dark) | Separate `cortex-*` | Ask empty good; search “memory” metaphor | Cloud chat relies on Settings opt-in | Dark mode mature; type scale loose |
| Onboarding | options.css | Same as options | N/A (explain + Continue) | Discloses indexing already underway | Needs consent gate (SR-1) |

---

## Report for parent

- **Wrote:** `docs/enterprise-audit/audit-ui.md`
- **Counts:** blocker 0 · store-review risk 2 · user-facing defect 7 · polish 8
- **Top “one product” breakers:** triple accent/type tokens; duplicated divergent buttons; popup hero/gradient/`↻` chrome vs options restraint; Assistant Sync Enable-without-Disable
- **No** `src/`, eval, git, push, or PR changes made

*End of Pass 2 half B UI audit.*
