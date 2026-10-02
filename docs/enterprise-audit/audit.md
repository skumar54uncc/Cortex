# Cortex enterprise audit — Pass 2 consolidated (authoritative)

**Audit date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Commit audited:** `2f0ef75` (`2f0ef7590de34a9244845ba89c2a17c9ed0d525b`) — *Make Assistant Sync sign-in work from the settings page.*  
**Authority:** This file is the single Pass 3 input. Half-audits remain for provenance only: `audit-core-sync.md`, `audit-ui.md`. Policy context: `research.md`.  
**Constraint:** Documentation only in Pass 2. No `src/`, tests, `package.json`, manifest, or eval edits. No push, PR, or git-config changes. No OAuth item id / public key changes.

---

## 1. Scope + method + commit

### Scope

Pass 2 scored packaging / sync / privacy core and UI / product surfaces against `docs/enterprise-audit/research.md` (§§2–4, store-review checklist §6, intentional non-defects §7) and the durable quality bar (one product feel; named type scale; shared buttons; real focus; no placeholder/emoji/gradient marketing in Settings; no user-facing em dashes).

**Surfaces covered**

| Area | Examples |
|------|----------|
| Packaging / permissions | `manifest.json`, `config/oauth-clients.json`, `scripts/oauth-client.cjs`, webpack store env, WAR, CSP, `incognito` |
| Sync / privacy core | service worker, offscreen, Assistant Sync (`assistant-sync/`), local JSON backup, privacy / store / enterprise docs, outbound fetch paths |
| UI surfaces | options, popup, onboarding, overlay / search-shell, tokens (`cortex-theme.css`, `theme.ts`, `options.css`) |
| Release / disclosure | `docs/PRIVACY_POLICY.md`, `privacy-policy.html`, `store-listing.md`, `docs/release-1.2.0/STORE_RELEASE.md`, `PERMISSIONS.md` |

### Method

1. Read-only inspection of paths listed in half-audits; cite file paths and behavioral evidence.
2. Cross-check live disclosures vs code (indexing start, Assist Sync Enable, alarm, history import, Drive writes).
3. Dedupe overlaps between half A (core-sync) and half B (UI); keep richest path lists.
4. Apply **CRITICAL OVERRIDE** (product-owner hard rules) before final severity counts — see §5.
5. Build Pass 3 queue from fixable blockers + store-review risks + user-facing defects + decided product gaps only. Polish deferred unless required to fix a higher-severity item.

### Commit

All findings refer to tree state at **`2f0ef75`**. Pass 3 implements against that baseline unless a later commit is explicitly re-audited.

---

## 2. Severity definitions

| Severity | Meaning |
|----------|---------|
| **blocker** | Prevents a correct store ship or makes a core reviewer / user flow impossible when the release pack is used as written. Fix before store upload (docs/pack or product). |
| **store-review risk** | Likely CWS rejection, escalation, or Limited Use / disclosure failure under current (incl. 2026) policy. May ship technically but fail review or trust. |
| **user-facing defect** | Broken, misleading, or unpredictable UX for a shipping control or claim (settings predictability, a11y non-negotiable, honesty of privacy copy, one-product design drift that users feel). |
| **polish** | Tone, iconography, motion, deeper axe scenarios, doc dual-source drift that does not itself fail review. **Deferred** unless required to land a defect/risk above. |

---

## 3. Findings by severity

**Final counts after CRITICAL OVERRIDE reclassification**

| Severity | Count |
|----------|------:|
| blocker | 1 |
| store-review risk | 8 |
| user-facing defect | 9 |
| polish (deferred) | 13 |
| **Total findings still tracked** | **31** |

*Former core B-1 (empty `release` OAuth client id) is **not** counted as a blocker — moved to §5 Intentional constraints.*

---

### blocker (1)

#### B-1 — Release-pack privacy practices omit Drive sync / identity

- **Severity:** blocker  
- **Title:** `STORE_RELEASE.md` (and related pack) certifications contradict shipped Assistant Sync  
- **Path(s):**
  - `docs/release-1.2.0/STORE_RELEASE.md` (Permission justifications; Privacy practices; Data transmission)
  - `docs/release-1.2.0/PERMISSIONS.md` (lists `identity` under “deliberately does not add” / “No accounts”)
  - Contrast: `manifest.json` (`identity`, `oauth2.scopes: drive.file`), `src/options/assistant-sync-panel.ts`, `src/assistant-sync/drive-api.ts`, `docs/store-listing.md` (accurate)
- **Evidence:** STORE_RELEASE permission table has no `identity` row; host justification ends with “Nothing is sent to any server.” Data transmission: “nothing is sent anywhere by default… exception is optional cloud chat…” — omits optional Drive writes to `Cortex Memory`. Privacy practices “Sent off the device” only mentions Gemini. PERMISSIONS.md denies `identity` while manifest and `tests/manifest.test.ts` require it.
- **Why it matters:** Submitting those answers as written is inaccurate Limited Use / privacy-practices certification (Purple Lithium / Red Nickel). Reviewers comparing form answers to `identity` + Drive network calls will reject or escalate.
- **Pass 3 direction:** Rewrite release-pack privacy practices and permission justifications to match `docs/store-listing.md` + live privacy HTML: Enable-gated Assist Sync, `drive.file` only, `Cortex Memory`, interactive auth only from Enable; keep Gemini as a second optional path. Fix PERMISSIONS.md identity row. Do not weaken code; fix the pack.

---

### store-review risk (8)

#### SR-1 — Indexing / first-install history without affirmative consent

- **Severity:** store-review risk  
- **Title:** History backfill and indexing start before affirmative in-product consent  
- **Path(s):**
  - `src/background/service-worker.ts` (`onInstalled` → `maybeRunFirstInstallBackfill`; open-tab priming)
  - `src/shared/onboarding-constants.ts` (`FIRST_INSTALL_HISTORY_DAYS = 30`, `FIRST_INSTALL_HISTORY_MAX_URLS = 500`)
  - `src/lib/first-install-history-notify.ts`
  - `src/onboarding/onboarding.html` (disclosure after the fact)
  - `src/popup/popup.html` / `src/popup/popup.ts` (dismissible privacy blurb)
  - Claims: `docs/PRIVACY_POLICY.md`, `docs/privacy-policy.html`, `docs/store-listing.md`, `docs/release-1.2.0/STORE_RELEASE.md`
- **Evidence:** Install kicks 30-day / 500-URL history import and live indexing in parallel with onboarding. Onboarding copy is past-tense/ongoing (“Getting ready… saving your recent browsing…”), not an Enable/Agree gate. Docs claim optional / user-triggered import.
- **Why:** CWS User Data FAQ: browsing activity **even when stored only locally** requires prominent disclosure **and** affirmative informed consent **in the Product UI** before collection. Store listing alone is insufficient (research.md §2.6).
- **Pass 3 direction:** Gate first-install history import (and ideally first live indexing) behind explicit onboarding control; align every public sentence with the chosen behavior. Keep sensitive-site / incognito skips.

#### SR-2 — Missing Limited Use affirmative statement

- **Severity:** store-review risk  
- **Title:** No Google APIs Limited Use compliance sentence on privacy surfaces  
- **Path(s):** `docs/privacy-policy.html`, `docs/PRIVACY_POLICY.md` (also absent from README / ENTERPRISE homepage-style docs)
- **Evidence:** Surfaces disclose `drive.file` and Gemini but never state that use of information received from Google APIs adheres to the CWS User Data Policy, including Limited Use.
- **Why:** Required when using restricted scopes / Google user data via `chrome.identity`.
- **Pass 3 direction:** Add one clear affirmative sentence to privacy HTML + MD (keep them byte-consistent). No scope change.

#### SR-3 — Broad install-time hosts + content scripts

- **Severity:** store-review risk  
- **Title:** Install-time `http(s)://*/*` hosts and content script (Purple Potassium scrutiny)  
- **Path(s):** `manifest.json` (`host_permissions`, `content_scripts`); `docs/release-1.2.0/PERMISSIONS.md`, `STORE_RELEASE.md`; `tests/manifest.test.ts`
- **Evidence:** Required hosts `http://*/*`, `https://*/*`; content script on all http(s) at `document_idle`. Install warning: “Read and change all your data on all websites.”
- **Why:** Highest recurring CWS rejection theme for privacy-first indexers without airtight single-purpose + browsing-activity justification in dashboard **and** UI.
- **Pass 3 direction:** Keep hosts if core UX requires them; harden reviewer justifications and in-product disclosure (ties to SR-1). Do **not** move core indexing behind optional hosts unless product explicitly accepts broken default indexing. Not an “enterprise gap” to remove.

#### SR-4 — Privacy policy still “draft”; disclosure gaps vs behavior

- **Severity:** store-review risk  
- **Title:** Privacy MD marked draft; history / alarm / incognito incomplete vs code  
- **Path(s):** `docs/PRIVACY_POLICY.md` (title “(draft)”); `docs/privacy-policy.html`; `docs/data-deletion.html`; options links in `src/options/options.html`
- **Evidence:** MD still says draft. History described as user-triggered; HTML softens first-install. Incognito `not_allowed` not called out in HTML summary. Alarm copy says “15 minute Assistant Sync alarm runs only after you enable” while SW always creates the alarm (handler no-ops if disabled).
- **Why:** Hosted privacy URL is the enterprise/reviewer contract.
- **Pass 3 direction:** Drop “draft”; document automatic first-install scan (or remove it via SR-1); mention incognito never indexed; clarify Drive work runs only while sync is enabled.

#### SR-5 — Maintainer PERMISSIONS.md contradicts shipped `identity`

- **Severity:** store-review risk  
- **Title:** Internal permissions doc denies `identity` while manifest ships it  
- **Path(s):** `docs/release-1.2.0/PERMISSIONS.md`; `manifest.json`; `tests/manifest.test.ts`
- **Evidence:** “Permissions this release deliberately does not add” includes identity / “No accounts.” Manifest and tests require the opposite.
- **Why:** Operators pasting PERMISSIONS.md into CWS will omit or mis-justify `identity`.
- **Pass 3 direction:** Replace that row with store-listing justification (Enable-only interactive auth; silent token thereafter). Closely related to B-1 pack rewrite.

#### SR-6 — Popup privacy blurb omits Assistant Sync / Drive

- **Severity:** store-review risk  
- **Title:** Primary privacy blurb silent on optional Drive sync  
- **Path(s):** `src/popup/popup.html` (`#cx-privacy-blurb`); `src/popup/popup.ts` (`cortex_popup_privacy_ack_v1`); contrast `src/options/options.html` `#cx-assistant-consent`
- **Evidence:** Blurb covers on-device index + optional Gemini; no Assist Sync / `Cortex Memory` / `drive.file`.
- **Why:** Prominent disclosure must cover optional off-device transfers in the build that ships sync.
- **Pass 3 direction:** One factual sentence on Assist Sync (off until Enable; user’s folder; `drive.file`). Non-marketing tone.

#### SR-7 — Single-purpose stretch if listing omits sync narrative

- **Severity:** store-review risk  
- **Title:** Local memory + Drive sync + Gemini must stay one purpose in listing  
- **Path(s):** `docs/store-listing.md` (good); `docs/release-1.2.0/STORE_RELEASE.md` detailed description (Drive largely absent); `manifest.json` name/description
- **Evidence:** store-listing frames Assist Sync as copy of the same memory; STORE_RELEASE detailed description emphasizes on-device only.
- **Why:** Red Magnesium risk if reviewers see three products without a tight “one memory” story.
- **Pass 3 direction:** Prefer `docs/store-listing.md` narrative for live CWS listing; Assist Sync and Gemini as features of private memory.

#### SR-8 — Persistent indexing disclosure easy to lose on popup

- **Severity:** store-review risk  
- **Title:** Popup privacy blurb is one-shot dismissible; core browsing-activity disclosure not sticky  
- **Path(s):** `src/popup/popup.html` (`#cx-privacy-blurb`), `src/popup/popup.ts` (`POPUP_PRIVACY_ACK_KEY`)
- **Evidence:** After “Got it, do not show again”, popup no longer states that indexing captures browsing activity on-device. Options About / Assist Sync consent remain, but toolbar popup is the high-frequency surface.
- **Why:** 2026 disclosure rules expect browsing activity to stay prominently described in-product.
- **Pass 3 direction:** Keep a short always-visible status/disclosure line (or non-hideable “What’s indexed” link); reserve dismiss for the long blurb only.

---

### user-facing defect (9)

#### U-1 — Assistant Sync has Enable but no Disable

- **Severity:** user-facing defect  
- **Title:** No way to turn sync off without Delete all  
- **Path(s):**
  - `src/options/options.html` (`#cx-assistant-enable`, `#cx-assistant-now`)
  - `src/options/assistant-sync-panel.ts` (Enable + Sync now only)
  - `src/background/service-worker.ts` / `src/assistant-sync/runtime.ts` (actions: `"alarm" | "now" | "enable"`)
  - `src/assistant-sync/sync-engine.ts`, `src/assistant-sync/db.ts`
- **Evidence:** Status can show On; UI never sets `syncEnabled` back to false short of wipe / Forget all / Drive trash.
- **Why:** Privacy-critical opt-in must be clearly reversible.
- **Pass 3 direction:** Add Disable (`syncEnabled: false`, stop Drive work path, leave Drive files unless user chooses trash); swap Enable label/state when on; gate Sync now when off.

#### U-2 — Privacy / store copy says history import is user-started; code auto-runs

- **Severity:** user-facing defect  
- **Title:** Documented “optional import you start” ≠ automatic first-install scan  
- **Path(s):** Same cluster as SR-1 (`maybeRunFirstInstallBackfill` vs privacy/store-listing claims); Settings also exposes manual `CORTEX_HISTORY_IMPORT_START`
- **Evidence:** Notifications/onboarding acknowledge in-progress scan; docs describe only the manual story.
- **Why:** Users who trust “you start yourself” discover a 30-day history fetch already ran.
- **Pass 3 direction:** Same product gate as SR-1 — change gate or change every public sentence (prefer gate).

#### U-3 — “Sync now” available while sync is Off

- **Severity:** user-facing defect  
- **Title:** Sync now not gated on enabled state; failure messaging generic  
- **Path(s):** `src/options/assistant-sync-panel.ts`; `src/background/service-worker.ts` (`forwardAssistantSync("now")`); `src/assistant-sync/sync-engine.ts` (`disabled` if `!syncEnabled`)
- **Evidence:** Button always clickable; engine no-ops; panel maps to generic “Sync did not finish” rather than “Enable first”; silent token path can confuse before Enable.
- **Why:** Controls that cannot succeed should be disabled or explain the prerequisite.
- **Pass 3 direction:** Disable Sync now until `syncEnabled`; distinct calm copy if fired early. Land with U-1.

#### U-4 — Popup “Live indexing uses no network” is easy to over-read

- **Severity:** user-facing defect  
- **Title:** Absolute “no network” indexing claim vs history fetch / PDF fetch / optional sync  
- **Path(s):** `src/popup/popup.html`; `src/lib/history-import.ts`; `src/offscreen/pdf-fetch.ts`; `src/assistant-sync/drive-api.ts`
- **Evidence:** History import and PDF indexing fetch the page URL; Assist Sync uses Google HTTPS when enabled.
- **Why:** Privacy-conscious users treat the sentence as a hard guarantee; deceptive-metadata risk with Drive/Gemini.
- **Pass 3 direction:** Narrow wording: embeddings/index storage stay on device; optional network only for history/PDF URL fetch and user-enabled Drive/Gemini. Coordinate with SR-6.

#### U-5 — Triple design-token sources (accent + surfaces drift)

- **Severity:** user-facing defect  
- **Title:** Dual/triple token systems: options CSS vs cortex-theme.css vs theme.ts  
- **Path(s):**
  - `src/options/options.css` (`--accent: #c72a09`; own `--font-size-*`; does not import `cortex-theme.css`)
  - `src/styles/cortex-theme.css` (`--cx-accent: #a82207`; `--cx-ts-*`; used by popup)
  - `src/shared/theme.ts` (overlay light `#b8250a`, dark `#ef7554`)
  - `docs/UI_DECISIONS.md`
- **Evidence:** Three shipping accents; options `#fafaf8` vs popup/overlay warm beige `#e4e2dd`; differently named type tokens.
- **Why:** Quality bar requires one documented token set (or explicit mapped split). Silent hex drift breaks “one product.”
- **Pass 3 direction:** Single generator or documented bridge; options consume same accent/surface tokens as popup light theme; dark tokens may stay overlay-only if Settings remain light.

#### U-6 — Button primitives redefined three ways

- **Severity:** user-facing defect  
- **Title:** `.cx-btn*` duplicated in options and popup; overlay uses separate `cortex-*` controls  
- **Path(s):** `src/options/options.css` (`.cx-btn`); `src/popup/popup.css` (`.cx-btn`); `src/content/overlay.shadow.css` (`.cortex-ask-send`, `.cortex-icon-btn`, …)
- **Evidence:** Focus ring 3px vs 2px; secondary neutral vs accent-colored; radius 4px vs 10–11px; overlay send is bespoke.
- **Why:** Same labels do not mean the same control across popup → Settings → panel.
- **Pass 3 direction:** One shared button stylesheet (or module) for options/popup/onboarding; overlay maps to same variants inside shadow root.

#### U-7 — Type scale not shared; many one-off sizes

- **Severity:** user-facing defect  
- **Title:** Named type scales diverge; overlay/popup use ad-hoc px/`em` sizes  
- **Path(s):** `src/options/options.css`; `src/styles/cortex-theme.css`; `src/content/overlay.shadow.css`; `src/popup/popup.css`
- **Evidence:** Options has `0.92em` / `10px` outside named scale; popup metrics `15px` vs theme metric `22px`; overlay does not consume `--cx-ts-*`.
- **Why:** Bar: named steps only; undocumented one-offs are the main “vibe-coded” tell.
- **Pass 3 direction:** Collapse to one scale (caption/small/body/title/display/metric); replace raw sizes; document rare exceptions. Land with U-5.

#### U-8 — Popup interactive controls missing focus-visible treatment

- **Severity:** user-facing defect  
- **Title:** Privacy ack and text-link button lack `:focus-visible` styles  
- **Path(s):** `src/popup/popup.css` (`.cx-privacy-ack`, `.cx-btn-link`; focus-visible only on `.cx-btn`, `.cx-save`, `.cx-stats-refresh`)
- **Evidence:** Hover only on ack/link; keyboard users get UA default or no ring.
- **Why:** Visible `:focus-visible` on every interactive control is non-negotiable.
- **Pass 3 direction:** Share the same focus ring token as `.cx-btn:focus-visible` on ack + link buttons. Can ship with U-6 shared buttons.

#### U-9 — Empty-state language inconsistent across surfaces

- **Severity:** user-facing defect  
- **Title:** Empty / zero-data copy does not share one pattern language  
- **Path(s):** Options `options.html` (“No visits logged yet.”); popup `popup.html` (“Welcome. Browse…”); overlay search (“No matching memory”); overlay ask (“What would you like to know?”); overlay digest (“Nothing indexed for …”)
- **Evidence:** Mix of welcome marketing, factual, and “memory” metaphor; actions differ.
- **Why:** Bar asks for the same empty pattern language across popup, options Library, overlay Ask, search-no-hits.
- **Pass 3 direction:** Shared copy module: truthful lead + one next step; keep Ask empty factual; align “library/pages” vs “memory” wording with Settings.

---

### polish (13) — deferred

Do **not** schedule these in Pass 3 unless a higher-severity fix requires the same touch.

| ID | Title | Path(s) (short) |
|----|-------|-----------------|
| P-1 | `agent-debug-log` ships disabled localhost ingest URL | `src/lib/agent-debug-log.ts`, SW, offscreen |
| P-2 | Options Assist Sync consent omits naming `drive.file` | `src/options/options.html` `#cx-assistant-consent` |
| P-3 | Assist Sync alarm registered even when sync is off | `src/background/service-worker.ts` |
| P-4 | YouTube caption fetch uses `credentials: "include"` | `src/content/youtube-capture.ts` |
| P-5 | Dual listing docs drift (`store-listing.md` vs `STORE_RELEASE.md`) | docs (partially addressed by B-1 / SR-7) |
| P-6 | Popup refresh uses text glyph `↻` | `src/popup/popup.html` |
| P-7 | Popup storage bar accent→orange marketing gradient | `src/popup/popup.css` |
| P-8 | Popup primary uses hero shadow / larger CTA | `src/popup/popup.css` `.cx-btn-hero` |
| P-9 | Section title “Connect with your AI assistant” promotional | `src/options/options.html`, popup CTA |
| P-10 | Axe gate covers load/happy paths only | `e2e/a11y.spec.ts`, axe-report |
| P-11 | Popup lacks `prefers-reduced-motion` for animated chrome | `src/popup/popup.css` |
| P-12 | Appearance copy could state Settings stays light | `src/options/options.html`, `UI_DECISIONS.md` |
| P-13 | Overlay / options one-off `em` font sizes | options.css, overlay.shadow.css |

*P-5 content may be fixed as a side effect of B-1 / SR-7; do not open a separate polish ticket.*

---

## 4. Intentional limits / non-findings

Do **not** treat these as enterprise gaps or “fix” them by inventing data, widening OAuth, adding a backend, or breaking core indexing.

| Topic | Status | Paths / notes |
|-------|--------|----------------|
| Excerpts only after real ≥5-minute read | Intentional | `src/assistant-sync/excerpt.ts` (`buildExcerpt`); options consent; blank when dwell missing |
| Dwell blank until measured | Intentional | `captureVisitFromChrome` passes `dwellMinutes: null`; never invent `0` |
| No Cortex server; optional Drive sync user-gated | Intentional | Sync default off; Enable → interactive token; alarm/now silent |
| OAuth scope `drive.file` only | Intentional / good | `manifest.json`; `DRIVE_FILE_SCOPE`; `tests/manifest.test.ts` |
| Interactive `getAuthToken` only from Enable click | Intentional / good | `assistant-sync-panel.ts` `driveTokenFromClick`; SW `silentDriveToken` for alarm/now/trash |
| Google fetches stay in assistant-sync chunk (offscreen) | Intentional / good | offscreen dynamic import; `FetchDriveApi` under `src/assistant-sync/` |
| Folder name `Cortex Memory` | Intentional | `createMemoryFile` / `reenableMemory` |
| Do not change OAuth item id or public `key` | Constraint | Published id `happibddmmagkgneicjkndapcpmhdbfn`; unpacked `fkhaacmaaaheapelljjcmfdmifmfbboa` |
| `incognito: "not_allowed"` | Intentional privacy posture | `manifest.json`; tests pin it |
| Offscreen cannot use `chrome.storage`; SW passes data | Intentional architecture | |
| Local JSON/Markdown backup only (disk download) | Intentional | `src/lib/export/backup*.ts` — Assist Sync is the Drive path (see also Pass 3 product gap: separate Drive JSON backup file) |
| Remote ML / CDN closed | Intentional / good | `transformers-env.ts` `allowRemoteModels` false; bundled wasm |
| WAR minimized | Intentional / good | icons+fonts only, `use_dynamic_url: true` |
| `agent-debug-log` disabled | Non-finding for live telemetry | Flag false; polish P-1 only for dead URL |
| Out-of-scope failing tests | Note only — do not “fix” | `tests/pdf.test.ts` Promise.withResolvers; `tests/embed-parity.test.ts` cosine threshold; `tests/chat-engine-abort.test.ts` token count |
| Managed enterprise policy schema | Strength | `managed_schema.json`, `docs/ENTERPRISE.md` |
| Permissions actually used | Non-finding | All declared permissions have call sites |
| Options page light-only | Intentional | `docs/UI_DECISIONS.md`; Appearance targets overlay/panel |
| Skeleton / people-card gradients | Non-findings | Loading / legibility, not Settings marketing heroes |
| No user-facing em dashes | Non-finding | U+2014 in comments only |
| No emoji status icons in Settings | Non-finding | SVG controls; popup `↻` is polish only |
| No placeholder / lorem / “Coming soon” in Settings | Non-finding | Input placeholders are field hints |
| Assist Sync consent copy quality (data types, Enable gate) | Strength | Options consent + privacy/data-deletion links |
| Overlay recoverable error shape | Strength | `renderErrorBlock` + `userAction` |
| Skip link, radio cards ARIA, managed banner, type-DELETE | Strength | Options a11y baseline |
| axe idle clean | Strength | Deepen scenarios later (P-10); keep gate |
| Search-shell mounts shared overlay | Intentional | Not a fourth design system |
| Onboarding reuses options.css | Strength | Aligns welcome with Settings |
| Broad hosts as core indexing design | Intentional design (see SR-3) | Justify; do not remove as a “gap” |

### Architecture snapshot (verified)

```
Enable click (options)
  → chrome.identity.getAuthToken({ interactive: true })
  → CORTEX_ASSISTANT_SYNC { action: "enable", token }
  → SW ensureOffscreen + CORTEX_ASSISTANT_SYNC_WORK
  → offscreen lazy-loads assistant-sync chunk → FetchDriveApi → Drive/Sheets HTTPS
  → SW persists returned ids to chrome.storage.local

Alarm / Sync now
  → SW silent getAuthToken({ interactive: false })
  → same offscreen work path

Backup
  → options CORTEX_EXPORT → local JSON or Markdown zip download (no Drive today)
```

CSP: `script-src 'self' 'wasm-unsafe-eval'` on extension pages. No remote script loading observed in packaging config.

---

## 5. CRITICAL OVERRIDE — intentional constraints (do not fix in Pass 3)

Product-owner hard rules. **Reclassified out of the fix queue.** Do not list these as Pass 3 work items.

### C-1 — `config/oauth-clients.json` `release` MUST stay empty

- **Former label:** core-sync **B-1** (blocker) — **reclassified; do not fix.**
- **Path(s):** `config/oauth-clients.json` (`"release": ""`); `scripts/oauth-client.cjs` (`resolveOAuthClientId` throws if release empty); `webpack.config.js` (`--env store` uses release); `manifest.json` (dev client baked in source)
- **Required behavior:** `release` stays empty. `npm run build:store` **MUST still refuse** (throw) when the release client id is empty. That refusal is the safety latch, not a bug.
- **Reason:** Store OAuth binding is an operator/secrets step outside this audit’s engineering pass. Filling `release` here would either invent a client id or push maintainers to change item id / public key — both forbidden. Keep `build:store` as the only path that would write a real release client into `dist/manifest.json` **after** an authorized human supplies the existing CWS-bound client id. Do **not** mint a new client or change `manifest.json` `"key"` / published id `happibddmmagkgneicjkndapcpmhdbfn`.

### C-2 — No backend, account, analytics, or new dependency by default

- Do **not** add a Cortex backend, user account system, analytics/telemetry SDK, or any new npm dependency in Pass 3 **unless** a finding above explicitly names that dependency **and** its license as required to fix that finding.
- No finding in this audit names a required new dependency. Ship with existing stack.

### C-3 — Do not modify search / ranking core

Do **not** modify these files in Pass 3 (or under the guise of audit fixes):

- `src/lib/search-engine.ts`
- `src/lib/ranking.ts`
- `src/lib/query-relevance.ts`
- `src/lib/query-parse.ts`
- `src/lib/similarity.ts`

Search quality / ranking is out of scope for this enterprise audit pass.

### Also hard constraints (from research / product)

- No OAuth item id or public `key` change.
- No inventing dwell minutes or excerpts to “fill” sheets.
- Do not “fix” out-of-scope Node 20 test failures listed in §4 by inventing behavior.

---

## 6. Pass 3 implementation queue

Ordered list of **only** (a) fixable blockers, (b) store-review risks, (c) user-facing defects, plus **decided product gaps**. Polish deferred (§3 polish table) unless required to land an item below.

### A — Blocker

1. **B-1** — Rewrite `docs/release-1.2.0/STORE_RELEASE.md` + `PERMISSIONS.md` privacy/permission answers to match shipped Assist Sync + `identity` + `drive.file` (align with `docs/store-listing.md`).

### B — Store-review risks

2. **SR-1 + U-2** — Affirmative in-product consent before first-install history backfill / live indexing; rewrite all “you start yourself” claims to match.
3. **SR-2** — Add Limited Use Google APIs affirmative sentence to `privacy-policy.html` + `PRIVACY_POLICY.md` (byte-consistent).
4. **SR-4** — Drop “draft”; document history/incognito/alarm accurately vs code (coordinate with item 2).
5. **SR-5** — Fix PERMISSIONS.md identity row (may fold into item 1).
6. **SR-6 + U-4** — Popup privacy blurb: Assist Sync sentence + narrowed “no network” wording.
7. **SR-8** — Sticky short browsing-activity disclosure on popup (long blurb may still dismiss).
8. **SR-7** — CWS listing / STORE_RELEASE detailed description: one-memory narrative including Assist Sync + Gemini as features.
9. **SR-3** — Harden host/content-script justifications in release pack and in-product disclosure; **keep** broad hosts for core indexing.

### C — User-facing defects

10. **U-1 + U-3** — Assistant Sync Disable control; gate Sync now on `syncEnabled`; clear status copy.
11. **U-5 + U-7** — Unify design tokens and named type scale across options / popup / overlay (documented bridge OK).
12. **U-6 + U-8** — Shared button primitives + focus-visible on every interactive popup control.
13. **U-9** — Shared empty-state copy pattern across popup, options Library, overlay Ask / search / digest.

### D — Decided product gaps (already owned; stay on schema_version 3)

14. **People/Companies backfill on next sync** — On next sync, copy LinkedIn people/companies already stored in Cortex onto People/Companies tabs when the profile URL was visited inside the retention window.
15. **Index-time LinkedIn fields + delayed sync** — When a page is indexed, send parsed LinkedIn fields with the visit so new profiles become People/Companies rows; schedule one sync ~2 minutes later; keep the 15-minute alarm as backstop; do **not** call Google on every page.
16. **Questions section on About tab** — Add Questions section to About tab of the live sheet; map question shapes to Visits, Content, Searches, People, Companies, Daily; stay on **schema_version 3**.
17. **Drive JSON backup as separate file** — Drive copy of JSON backup is a separate file in the `Cortex Memory` folder; About tab tells the assistant not to read it; the live sheet stays the only query file.

### Explicitly out of Pass 3 queue

- All polish items P-1…P-13 (unless a queued item above forces the same file touch).
- C-1 empty `release` OAuth / `build:store` refuse behavior.
- C-2 new backend / account / analytics / unnamed dependency.
- C-3 search-engine / ranking / query-* / similarity edits.
- OAuth item id / public key changes.
- Inventing dwell/excerpts; “fixing” out-of-scope test failures; removing broad hosts as a faux enterprise gap.

---

## 7. Provenance

| Artifact | Role |
|----------|------|
| `docs/enterprise-audit/audit.md` | **Authoritative** Pass 2 → Pass 3 handoff (this file) |
| `docs/enterprise-audit/audit-core-sync.md` | Half A source (kept) |
| `docs/enterprise-audit/audit-ui.md` | Half B source (kept) |
| `docs/enterprise-audit/research.md` | Pass 1 policy + quality bar |
| `research-chrome-policy.md`, `research-quality-bar.md` | Intermediate notes (kept) |

---

## Report summary

| Metric | Value |
|--------|-------|
| Path | `docs/enterprise-audit/audit.md` |
| Commit | `2f0ef75` |
| Blockers (after reclass) | **1** (STORE_RELEASE / identity disclosure; former OAuth-empty B-1 → constraint) |
| Store-review risks | **8** |
| User-facing defects | **9** |
| Polish (deferred) | **13** |
| Pass 3 queue length | **17** items (1 blocker + 8 SR + clustered UFDs as 4 work items + 4 product gaps) |
| Pass 3 queue themes | Release-pack honesty → consent + Limited Use + sticky disclosure → Assist Sync Disable → design-system unify → People/Companies sync + Questions + Drive JSON backup file |

*End of Pass 2 consolidated audit. Half-audits retained. No `src/`, tests, manifest, package.json, or eval files modified. No push, PR, or git config changes.*
