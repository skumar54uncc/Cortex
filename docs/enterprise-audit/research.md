# Cortex enterprise audit — Pass 1 research

**Research date:** 2026-10-02 (America/New_York)  
**Purpose:** Durable Pass 1 research for the Cortex enterprise audit. This document consolidates Chrome Web Store / MV3 policy findings and the durable extension quality bar so Pass 2 can rely on it alone.  
**Constraint:** Documentation-only. **No code changes in this pass.** Do not edit `src/`, tests, `package.json`, manifest, or eval files. Do not change OAuth item id or public key. Do not push or open a PR.

Intermediate notes kept for traceability (do not delete):

- `docs/enterprise-audit/research-chrome-policy.md`
- `docs/enterprise-audit/research-quality-bar.md`

---

## 1. Product facts

Given facts (not invented); use these as ground truth for Pass 2.

| Fact | Detail |
|------|--------|
| Platform | Privacy-first **Manifest V3** Chrome extension |
| Library | Stays **on device** (IndexedDB / local storage) |
| Backend | **No Cortex server**; **no telemetry** |
| Optional Assistant Sync | Copies memory into the user’s own Google Drive folder **`Cortex Memory`**, only after the user presses **Enable** |
| Auth | `chrome.identity.getAuthToken` with OAuth scope **`drive.file` only** |
| Unpacked extension id | `fkhaacmaaaheapelljjcmfdmifmfbboa` |
| Published CWS id | `happibddmmagkgneicjkndapcpmhdbfn` |
| OAuth / key | **Do not change** OAuth item id or public key in `manifest.json` |

Observed from current `manifest.json` (read-only context for research):

- `"incognito": "not_allowed"`
- Required `host_permissions`: `http://*/*` + `https://*/*`
- Content scripts on all http(s)
- Permissions include `tabs`, `history`, `identity`, `scripting`, `offscreen`, among others
- `oauth2.scopes` = `drive.file` only

Intentional product limits (not defects — see §8):

- Content excerpts only after a real **≥5-minute** read
- Dwell left blank until measured — never invent data to “fill” empty cells

---

## 2. Chrome Web Store / MV3 policy findings

Sources are full URLs; mirrored in §9.

### 2.1 Single purpose

> An extension must have a **single purpose that is narrow and easy to understand**. Do not require users to accept bundles of unrelated functionality. If two pieces are clearly separate, they should be separate extensions.

- Source: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines
- Troubleshooting maps violations to **Red Magnesium / Red Copper / Red Lithium / Red Argon**. Common rejects: two+ unrelated purposes; unrelated action-icon features; search/NTP overrides; ad injection as a distinct purpose.
- Source: https://developer.chrome.com/docs/webstore/troubleshooting
- Dashboard: Privacy practices **single purpose description** must clearly communicate that focus for reviewers.
- Source: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

### 2.2 Permission justifications & minimum permissions

> Request access to the **narrowest permissions necessary** to implement your Product's features. If more than one permission could implement a feature, request those with the **least access**. Don't “future proof” with unused permissions.

- Source: https://developer.chrome.com/docs/webstore/program-policies/permissions
- Every permission from the manifest needs a **specific justification**; unused permissions should be removed before upload. Broader-than-necessary permissions may cause rejection (**Purple Potassium**).
- Sources: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy , https://developer.chrome.com/docs/webstore/troubleshooting
- Minimum-permission rules apply to **both required and optional** permissions; list permissions and reasons in the listing or an in-extension about page.
- Source: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq

### 2.3 Optional host permissions & optional API permissions

- Prefer **`optional_permissions` / `optional_host_permissions`** when a feature is not essential to core install-time functionality, so users grant access when enabling that feature.
- `chrome.permissions.request` must run from a **user gesture**; hosts can be requested as subsets of declared optional patterns (e.g. declare `https://*/*`, request a specific origin).
- Sources:
  - https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
  - https://developer.chrome.com/docs/extensions/reference/api/permissions
  - https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy

### 2.4 OAuth2 / `chrome.identity` / limited scopes (`drive.file`)

**Chrome Identity**

- Declare `"identity"` and an `"oauth2"` block with `client_id` + `scopes`.
- `getAuthToken({ interactive: true })` may prompt for Chrome sign-in / scope approval.
- **Do not** call interactive `getAuthToken` when the app is first launched; initiate from UI that explains what authorization is for.
- Source: https://developer.chrome.com/docs/extensions/reference/api/identity

**OAuth tutorial (MV3)**

- Keep a **stable extension ID** via dashboard public key / `"key"` (and Chrome Extension OAuth client **Item ID** matching that ID).
- Register OAuth client type **Chrome Extension** with the item ID; put client id + scopes in manifest.
- Source: https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
- **Constraint:** Do **not** recommend changing OAuth item id or public key. Published id `happibddmmagkgneicjkndapcpmhdbfn` and unpacked id `fkhaacmaaaheapelljjcmfdmifmfbboa` must stay consistent with existing Google Cloud OAuth client binding.

**Drive scope**

- `https://www.googleapis.com/auth/drive.file` — create/modify files the app creates or that the user opens/shares with the app (per-file / narrow access). Prefer non-sensitive scopes over full `drive`.
- Source: https://developers.google.com/drive/api/guides/api-specific-auth

**MV3 remote-server allowance**

- MV3 policy still allows communicating with remote servers for purposes such as **“Syncing user account data with a remote server”**, provided extension **logic** remains in-package and Limited Use / Privacy Policy apply.
- Source: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

### 2.5 Incognito behavior

- Manifest `"incognito"`: `"spanning"` (default), `"split"`, or `"not_allowed"`.
- Privacy guidance: do not persist browsing history from incognito windows; honor the “leave no tracks” promise. Settings may still be stored.
- Sources:
  - https://developer.chrome.com/docs/extensions/reference/manifest/incognito
  - https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy

### 2.6 Data use / privacy disclosures / Limited Use / remote code

**Privacy policy & disclosure**

- If the Product handles any user data → accurate privacy policy in the **designated dashboard field**.
- Disclose collection, use, sharing, and parties shared with.
- **Prior to installation / collection:** prominent disclosure + affirmative informed consent; after install, **disclose data-practice changes**.
- Sources:
  - https://developer.chrome.com/docs/webstore/program-policies/privacy
  - https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements

**Critical FAQ (local data still counts)**

> Extensions must disclose how they handle user data **even when data is only processed or stored locally** and is not transmitted to external servers.

- Prominent disclosure + consent must occur **in the Product UI**; store description alone does **not** satisfy the prominent-disclosure requirement.
- Clipping/scraping page content and collecting web browsing activity are explicit “handle user data” examples.
- Source: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq (Q2–Q3, Q10, Q13–Q14)

**Limited Use**

- Collect/use/transmit only data **necessary for the disclosed single purpose** (incl. related ops).
- **Web browsing activity** only to the extent required for a **user-facing feature** described prominently on the CWS page **and** in the Product UI.
- Restricted transfers; no sale for ads / brokers; humans reading user data restricted.
- Homepage / privacy policy must include an affirmative statement that use of information from Google APIs adheres to the CWS User Data Policy including Limited Use.
- Source: https://developer.chrome.com/docs/webstore/program-policies/limited-use

**2026 policy updates** (enforcement already active as of this research date)

Published 2026-07-01; **enforcement began 2026-08-01**:

- Limited Use tightened: data must be **strictly necessary** to the disclosed single purpose.
- Disclosure: **all** data collection prominently disclosed (even if related to single purpose); **proactively disclose** post-install practice changes.
- Source: https://developer.chrome.com/blog/cws-policy-updates-2026

**Remote code (MV3) — Blue Argon**

- Full functionality must be discernible from submitted code; external resources **must not contain logic**.
- Violations: remote `<script>`, `eval` of remote strings, interpreters for remote “data” commands.
- Allowed examples include syncing account data, remote config **without** shipping logic, non-logic assets.
- Dashboard: declare remote code use honestly; MV3 cannot load/execute remotely hosted files. Bundled deps that fetch remote code still count.
- Sources:
  - https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
  - https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
  - https://developer.chrome.com/docs/webstore/troubleshooting
  - https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

### 2.7 What reviewers commonly reject (MV3-relevant)

From https://developer.chrome.com/docs/webstore/troubleshooting (last updated 2026-07-20 on fetch):

| ID | Theme | Why it matters for Cortex |
|----|--------|---------------------------|
| **Blue Argon** | Remotely hosted / executed code | Bundled ML/libs, build artifacts, any eval of remote strings |
| **Purple Potassium** | Excessive / unused permissions | Broad hosts, `history`, `tabs`, `scripting` need tight justifications |
| **Purple Lithium / Nickel / Copper / Magnesium** | Privacy policy, prominent disclosure, secure transmission, browsing-activity rules | Local index + optional Drive/Gemini |
| **Red Magnesium et al.** | Single purpose | Local memory vs Drive vs chat narrative |
| **Yellow Magnesium** | Functionality not working | Reviewer cannot complete Enable/sync or search flows |
| **Yellow Zinc** | Insufficient metadata | Screenshots/description must explain indexing consent & optional sync |
| **Red Titanium** | Obfuscation | Minify OK; conceal/packers not OK |
| **Red Nickel/Potassium/Silicon** | Deceptive metadata | “Private / no server” claims must match behavior (Drive/Gemini still leave device when enabled) |

Also relevant: review process emphasizes that broad host permissions and sensitive capabilities get closer scrutiny (use troubleshooting + permissions docs as primary cites).

### 2.8 Synthesis — privacy-first + optional Drive sync model

| Design choice | Policy fit | Watch-outs |
|---------------|------------|------------|
| On-device library, no Cortex server | Aligns with Limited Use / privacy narrative | Local processing **must still be disclosed**; UI consent before indexing |
| `incognito: not_allowed` | Honors private browsing promise for an indexer | State clearly in privacy materials |
| Optional Assist Sync after **Enable** | Matches Identity “explain then interactive auth” + optional-feature consent | Keep sync off by default; no silent Drive writes |
| Scope **`drive.file` only** | Narrow / non-full-Drive; files app creates | Stay within app-created `Cortex Memory` tree; don’t creep scopes |
| User’s Drive as sync target | Allowed “sync user account data” style remote use under MV3 | Disclose Google as party; Limited Use Google APIs statement |
| Stable OAuth item id + manifest `key` | Required for Chrome Extension OAuth client | **Do not change** item id or public key |
| Broad `host_permissions` + content scripts | May be argued as necessary for “index what you read” | Highest rejection risk area; justifications + prominent browsing-activity disclosure mandatory; consider optional hosts only if UX still delivers core purpose |
| Optional Gemini via user API key | Third-party transfer; not Cortex telemetry | Disclose in UI before first send; dashboard data types must match |

---

## 3. Implications for Cortex specifically

- Frame **one** purpose: *private, on-device searchable memory of what the user has read* (index + Ask/search UI).
- Treat **optional Assistant Sync (Drive)** and **optional cloud chat (Gemini)** as *features of that same purpose* (export/sync of the same memory; Q&A against retrieved snippets)—not as separate products (e.g. “Drive file manager” or “general Gemini client”).
- Listing, screenshots, and in-product copy must not imply unrelated tool bundles.
- Risk if reviewers read “local library + Drive backup + Gemini chat” as multiple purposes without a tight narrative.

**Permissions**

- Prepare **feature-tied** justifications for each of: `tabs`, `offscreen`, `alarms`, `scripting`, `storage`, `history`, `notifications`, `sidePanel`, `contextMenus`, `identity`, and broad hosts.
- Especially sensitive: **`history`** (must map to user-triggered bulk import only, not continuous surveillance) and **broad host / content-script access** (must map to indexing + overlays on pages the user visits).
- Vague phrases like “required for functionality” are review-hostile; name the UI surface and data flow.
- Do not leave declared-but-unused permissions in the package.
- Core product (index pages you browse) may still need broad host/content-script access—but reviewers scrutinize **install-time** `<all_urls>`-style grants heavily.
- Optional features (Drive sync, Gemini) align with **runtime consent** patterns; Drive OAuth already gates on Enable. Moving non-core permissions to optional (where product UX allows) reduces Purple Potassium risk—any such change is a later engineering decision, not part of this research pass.

**OAuth / Drive / identity**

- **`drive.file` only** is the right least-privilege story: Cortex creates the `Cortex Memory` folder/file; it should not request full Drive.
- Interactive auth **only after Enable** matches Chrome Identity UX guidance and strengthens consent narrative.
- Destination is **the user’s Drive**, not a Cortex backend—still “handles user data” (login + cloud write) and must be disclosed; Limited Use transfer rules treat necessary third-party transfer for the single purpose as allowed when disclosed.
- Affirmative Limited Use statement for Google APIs must appear on the project site / privacy policy.

**Incognito**

- Current `"incognito": "not_allowed"` is a **strong privacy posture** for a browsing-activity indexer: private windows are never indexed or synced.
- Call this out in store privacy disclosures and reviewer justifications.
- If product ever allowed incognito, would need split/spanning analysis and explicit non-persistence—higher review risk.

**Data use / Limited Use / remote code**

- **Local indexing is still “handling user data”** → privacy policy + dashboard certifications + **in-product** prominent disclosure/consent before indexing begins (first-run UX), not only a hosted privacy URL.
- Web browsing activity is the product’s core input → must be **prominently** described in listing *and* UI as the user-facing feature (search/Ask over what you read).
- Optional Drive sync: disclose folder name, `drive.file` limits, Enable gate, user ownership, deletion path; HTTPS to Google APIs satisfies secure transmission for that path.
- Optional Gemini: disclose that prompts leave the device to Google’s API under the user’s key/terms; not Cortex telemetry—still third-party transfer for Limited Use.
- No Cortex backend is a strength; still certify Limited Use and avoid claiming “no data handling.”
- Ensure packaged build has **no RHC** (scan compiled bundle for remote script loads / eval of fetched code). API JSON responses used as data are fine; executing them is not.
- Include Google APIs Limited Use compliance sentence on privacy/homepage.

---

## 4. Durable extension quality bar

A durable MV3 extension that enterprises and privacy-conscious individuals will trust does not look like a weekend prototype with marketing headlines in Settings. It looks like Linear / Raycast / Anthropic Console: restraint, one design system, predictable controls, honest failure, and automated proof that store/privacy claims match the code.

Chrome Web Store best practices already require accurate privacy disclosures, MV3, and a UX that respects privacy (https://developer.chrome.com/docs/webstore/best-practices). Enterprise buyers additionally expect managed policy clarity, WCAG-aligned UI, and a release checklist that is repeatable—not tribal knowledge.

### 4.1 Design system

**Single source of truth**

| Criterion | Pass condition |
|-----------|----------------|
| Token ownership | One documented token set (or a clear split: “extension pages” vs “overlay shadow”) with names that match across CSS and TS. No silent drift of accent hex, type scale, or semantic colors. |
| Type scale | Named steps only (e.g. caption / small / body / title / display / metric). No one-off `font-size: 15px` / `0.92em` outside the scale without a documented exception. |
| Spacing / radius | A small scale (4/8/12/16/24…) used consistently; cards and panels share the same radius and border treatment. |
| Buttons | Shared variants: primary, secondary, ghost, danger; sizes sm/md; disabled, loading, focus-visible states defined once. |
| Form controls | Native or ARIA-correct custom toggles/radios with the same focus ring and error association pattern on every surface. |
| Semantic color | Success / warning / danger / focus tokens used for status—not ad-hoc orange gradients for “energy.” |
| Iconography | SVG (or one icon set) with `aria-hidden` when decorative; no emoji as UI icons in Settings / status rows. |

**Focus and interactive states (non-negotiable)**

- Visible `:focus-visible` on every interactive control; never remove outlines without a replacement ring that meets contrast.
- Hover / active / disabled are distinct; disabled controls are not only color-coded.
- Custom controls (toggles, radio cards) expose correct `role` / `aria-checked` / `aria-labelledby` and are operable with Space/Enter.

**Tone of UI chrome**

Enterprise Settings is not a landing page:

- No marketing headlines (“Unlock your second brain”).
- No gradient “hero” cards in Settings.
- No placeholder / lorem / “Coming soon ✨” copy in shipping UI.
- Section titles describe what the control does; helper text is factual and short.

Cortex’s options page already aims at Linear/Raycast restraint (`docs/UI_DECISIONS.md`); the bar is to keep every surface at that standard, including popup and overlay empty states.

### 4.2 Accessibility

Primary references:

- https://developer.chrome.com/docs/extensions/how-to/ui/a11y
- https://www.w3.org/TR/WCAG22/ (WCAG 2.2 Level AA — practical floor for enterprise buyers)

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

**Custom control rule:** Prefer native HTML controls. When custom (radio cards, toggles), implement WAI-ARIA roles/states from the start.

### 4.3 Honest empty and error states

**Empty states**

| Rule | Pass condition |
|------|----------------|
| Truthful | Empty means empty: “No visits logged yet.” / “Nothing relevant in your library.” — not fabricated sample rows. |
| Intentional blanks | Assistant Sync: missing dwell stays blank; no excerpt until measured ≥5 minutes. UI and Drive sheet must not invent values. |
| Actionable | Empty copy says what to do next in one sentence (browse, enable, import)—not a campaign slogan. |
| Visual | Brand mark or simple SVG OK; emoji icons and rainbow gradient cards are out. |
| Consistency | Same empty pattern language across popup, options Library, overlay Ask, search-no-hits. |

**Error states**

| Rule | Pass condition |
|------|----------------|
| User language | State what failed and what to try; avoid raw stack traces / opaque codes as the only message. |
| Recoverable path | Retry, open Settings, or Sync now when relevant (`renderErrorBlock` + `userAction` pattern in overlay is the right shape). |
| Live regions | Errors that appear after an action are announced (`role="alert"` or polite status as appropriate). |
| Network / identity | OAuth cancel, token revoke, Drive 403/429, offline: each has a distinct, calm message. |
| No blame theater | Do not imply the user’s library is “broken” when the intentional 5-minute rule withheld an excerpt. |

**Anti-patterns (fail the bar)**

- Placeholder copy shipped to production.
- Emoji as status icons in Settings.
- Gradient marketing cards in options.
- Inventing dwell minutes or excerpts to avoid “empty-looking” Drive rows.
- Silent failure (button does nothing; no status line).

### 4.4 Predictable settings UX

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

### 4.5 Release checklist expectations

A durable release is a checklist, not a vibe. Minimum enterprise MV3 pack:

**Build & integrity**

- [ ] Clean CI: typecheck, unit tests, build, bundle budgets, `npm audit --omit=dev`, SBOM attached.
- [ ] Packed zip matches what reviewers will see (no source maps in store zip; `manifest.json` at root).
- [ ] Version bump aligned across manifest, About UI, and release notes.

**Functional / privacy**

- [ ] Privacy policy URL live and **byte-level consistent** with in-extension claims and CWS Privacy practices form.
- [ ] Permission justifications match actual use (`identity` only for Assistant Sync Enable; alarms for sync only after Enable; no undeclared hosts).
- [ ] OAuth scope remains `https://www.googleapis.com/auth/drive.file` only.
- [ ] Incognito policy unchanged (`not_allowed` if that is the product rule).
- [ ] No remote code (MV3 requirement); CSP `script-src 'self' 'wasm-unsafe-eval'`.
- [ ] Manual: Enable → Drive folder created → Sync now → Disable / Delete all moves folder to trash as documented.

**UX / a11y gates**

- [ ] axe serious/critical = 0 on overlay (light+dark), options, popup, onboarding, search-shell.
- [ ] Focus trap + Escape restore still green.
- [ ] Theme contrast unit test green.
- [ ] Spot-check 200% zoom on options + overlay.
- [ ] Empty/error copy review: no placeholders, no emoji status icons, no marketing heroes in Settings.

**Regression / eval**

- [ ] Playwright E2E suite green on the packaged build.
- [ ] Known out-of-scope failing tests documented (do not “fix” by inventing data): e.g. `tests/pdf.test.ts` Promise.withResolvers; `tests/embed-parity.test.ts` cosine threshold; `tests/chat-engine-abort.test.ts` token count — track separately; do not block honesty of dwell/excerpt behavior.
- [ ] Assistant Sync unit tests still assert blank dwell / no excerpt without ≥5 minutes.

**Store listing**

- [ ] Single purpose, screenshots, and “What’s new” match shipped features.
- [ ] Privacy practices form ticks match reality (history, website content, PII for People/LinkedIn if still stored locally).
- [ ] No claim of telemetry if none exists—and no debug ingest left in production paths.

### 4.6 Tests that match privacy-policy claims

Privacy text is a contract. Tests should pin the contract so refactors cannot quietly widen collection or invent data.

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

**Copy consistency** — automated or checklist compare:

- `docs/PRIVACY_POLICY.md` ↔ `docs/privacy-policy.html` ↔ options Assistant Sync consent ↔ CWS privacy form answers in `docs/release-1.2.0/STORE_RELEASE.md`.

Drift between these is an enterprise defect even if code is correct.

### 4.7 Early observations (Pass 1 only — not a full audit)

Grounded in skim of commit `2f0ef75`; full severity triage is Pass 2.

**Strengths already visible**

- Options page: skip link, section nav, managed banner, radio cards with ARIA, honest Assistant Sync consent (5-minute excerpts called out), status `dl`, destructive delete confirm.
- Overlay: dialog roles, focus trap E2E, structured `renderErrorBlock`, chat empty state with factual hint (not emoji spam).
- Theme contrast unit tests + axe gate across overlay and extension pages.
- Manifest tests pin `drive.file`; assistant-sync tests explicitly refuse invented excerpts when dwell is blank.
- Enterprise managed policy + docs (`docs/ENTERPRISE.md`) are unusually mature for a solo MV3 product.

**Gaps / inconsistencies to verify in Pass 2**

1. **Dual token systems** — `src/styles/cortex-theme.css` (extension pages; accent `#a82207`) vs `src/shared/theme.ts` (overlay; light accent `#b8250a`). Type scales also differ (`--cx-ts-*` vs options `--font-size-*`). Enterprise bar wants one documented mapping or a single generator.
2. **Button / CSS duplication** — `.cx-btn*` redefined in `options.css` and `popup.css`; overlay uses separate `cortex-*` classes in `overlay.shadow.css`. Risk of divergent focus/disabled treatment.
3. **Decorative gradients** — `linear-gradient` remains in popup progress, options (stat skeleton area), and overlay chrome. Confirm none read as “marketing hero cards” in Settings; popup accent gradient may feel less restrained than options.
4. **Popup refresh control** — uses a text “↻” glyph as the visible icon (`popup.html`); enterprise bar prefers SVG + accessible name only (name exists; glyph tone is slightly informal).
5. **Axe coverage depth** — pages are audited on load; Assistant Sync Enable / error / managed-policy states and overlay “no results” / Drive failure paths may need dedicated scenarios.
6. **Privacy claim vs debug ingest** — `src/lib/agent-debug-log.ts` contains a `fetch` to a localhost ingest URL. Confirm it cannot run in production builds; otherwise it conflicts with “no telemetry” messaging even if local-only.
7. **Settings vs overlay theme** — options stay light-only while overlay supports light/dark/system (`docs/UI_DECISIONS.md`). Document as intentional or align for predictability.
8. **Release checklist location** — strong material lives in `docs/release-1.2.0/*` and CI, but a single evergreen `docs/enterprise-audit/` release checklist (Pass 2 deliverable territory) would make the bar enforceable every ship.

---

## 5. Cortex surface map

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

## 6. Store-review risk checklist

Actionable bullets for Pass 2 and store submission prep:

1. **Broad install-time host + content-script access** framed as excessive (Purple Potassium) without airtight single-purpose + browsing-activity justification.
2. **Missing in-product prominent disclosure/consent** before local indexing (FAQ: CWS description alone is insufficient).
3. **Web browsing activity** not described prominently enough in listing *and* UI as the user-facing feature.
4. **Single-purpose stretch**: local memory + Drive sync + Gemini chat read as unrelated purposes.
5. **`history` permission** appears unused or continuous rather than user-triggered import.
6. **Permission justifications** too generic for any of `tabs` / `scripting` / `offscreen` / `alarms` / `notifications` / `identity`.
7. **Privacy policy / dashboard certifications** inconsistent with actual optional Drive or Gemini transfers.
8. **Limited Use Google APIs affirmative statement** missing from homepage/privacy.
9. **Interactive OAuth** without clear Enable UI context (or auth on startup).
10. **Scope creep** beyond `drive.file` or writing outside app-created files.
11. **Blue Argon**: remote script / eval / dependency RHC in packaged build.
12. **“No data leaves device” marketing** that contradicts optional Drive/Gemini when enabled (deceptive metadata).
13. **Post-install data-practice changes** (2026 disclosure rules) not surfaced in-product if sync/chat behavior changes.
14. **Reviewer cannot exercise core flows** (Yellow Magnesium): first-run, search, Enable sync with test account.
15. **Changing OAuth item id / manifest key** (explicitly out of scope) would break Chrome Extension OAuth client binding to published id `happibddmmagkgneicjkndapcpmhdbfn`.

---

## 7. Intentional non-defects

Do **not** “fix” these in Pass 2 or later engineering work under the guise of polish:

- **Excerpts after 5-minute read** — Content excerpts appear only after a real ≥5-minute read. Missing excerpts before that threshold are intentional honesty, not a bug.
- **Blank dwell until measured** — Dwell stays blank (null) until measured. UI and Drive sheet must not invent `0` or guessed minutes to avoid empty-looking rows.
- **Out-of-scope Node 20 test failures** — Track separately; do not paper over with invented behavior:
  - `tests/pdf.test.ts` — Promise.withResolvers
  - `tests/embed-parity.test.ts` — cosine threshold
  - `tests/chat-engine-abort.test.ts` — token count

---

## 8. Pass 2 handoff

Pass 2 should:

1. Score Cortex against §§4.1–4.6 surface-by-surface using the surface map in §5.
2. Cross-check store-review risks in §6 against live listing, privacy policy, and in-product consent.
3. Cite file paths and copy snippets; produce a gap list with severity.
4. Prefer concrete diffs-of-expectation (“options accent token ≠ overlay accent token”) over taste commentary.
5. **Not** edit `src/`, tests, `package.json`, manifest, or eval files in the research/audit documentation pass unless a later engineering task explicitly authorizes it.
6. Rely on **this file alone** (`docs/enterprise-audit/research.md`); intermediate notes remain for provenance only.

---

## 9. Sources / citations

### Chrome Web Store / MV3 / Drive (policy research)

1. https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines
2. https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
3. https://developer.chrome.com/docs/webstore/program-policies
4. https://developer.chrome.com/docs/webstore/troubleshooting
5. https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
6. https://developer.chrome.com/docs/webstore/program-policies/permissions
7. https://developer.chrome.com/docs/webstore/program-policies/limited-use
8. https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
9. https://developer.chrome.com/docs/webstore/program-policies/privacy
10. https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
11. https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
12. https://developer.chrome.com/blog/cws-policy-updates-2026
13. https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
14. https://developer.chrome.com/docs/extensions/reference/api/permissions
15. https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy
16. https://developer.chrome.com/docs/extensions/reference/api/identity
17. https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
18. https://developer.chrome.com/docs/extensions/reference/manifest/incognito
19. https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
20. https://developers.google.com/drive/api/guides/api-specific-auth
21. https://developer.chrome.com/docs/webstore/best-practices

### Accessibility / quality bar

22. https://developer.chrome.com/docs/extensions/how-to/ui/a11y
23. https://www.w3.org/TR/WCAG22/

### Intermediate Pass 1 notes (kept; do not delete)

- `docs/enterprise-audit/research-chrome-policy.md`
- `docs/enterprise-audit/research-quality-bar.md`

---

*End of Pass 1 consolidated research. No `src/`, tests, `package.json`, manifest, or eval files were modified.*
