# Pass 3 Track A - privacy / consent / docs (done)

**Date:** 2026-10-02 (America/New_York)  
**Repo:** `/workspace/cortex-work/Cortex`  
**Scope:** FIXABLE blockers + store-review risks (privacy, consent, docs). No push/PR/git-config. No eval edits. No search-engine/ranking edits. OAuth release client left empty. No new dependencies.

## Audit items fixed

| ID | How |
|----|-----|
| **B-1** | Rewrote `docs/release-1.2.0/STORE_RELEASE.md` permission justifications, privacy practices, data transmission, and detailed description to match shipped Assistant Sync (`identity`, `drive.file`, Enable-gated, Cortex Memory) + Gemini as second optional path. Aligned with `docs/store-listing.md`. |
| **SR-5** | Replaced PERMISSIONS.md “deliberately does not add / identity / No accounts” with a real `identity` row (Enable-only interactive auth; silent token thereafter; `drive.file` only). Full Drive scope listed under deliberate non-adds. |
| **SR-1 + U-2** | Affirmative in-product consent before collection: new `INDEXING_CONSENT_KEY`; install no longer auto-runs history/open-tab backfill; `shouldSkipIndexing` skips with `no_indexing_consent` until granted; welcome page **Start indexing** grants consent and runs one-time backfill; Settings **Allow indexing** / **Scan history** also grant consent (Scan history does not auto-run first-install backfill). Existing profiles grandfathered via prior backfill/onboarding keys on update/startup. Public docs no longer claim “you start yourself” while code auto-ran. |
| **SR-2** | Added Google APIs Limited Use affirmative sentence to `docs/privacy-policy.html` and `docs/PRIVACY_POLICY.md`. |
| **SR-4** | Dropped “(draft)” from privacy MD; documented consent-gated history, `incognito: not_allowed`, and Drive work only while sync enabled (alarm handlers no-op when off). |
| **SR-3** | Hardened host/content-script justifications in STORE_RELEASE + PERMISSIONS + store-listing + privacy pages (single-purpose indexing; keep broad hosts). In-product disclosure via onboarding consent + sticky popup line. |
| **SR-6 + U-4** | Popup long blurb now mentions Assistant Sync / Cortex Memory / `drive.file`, and narrows network wording (index/embeddings on device; network for history/PDF URL fetch and user-enabled Drive/Gemini). |
| **SR-8** | Added always-visible `#cx-privacy-sticky` browsing-activity line; long blurb remains dismissible via existing ack key. When consent missing, sticky points to welcome page. |
| **SR-7** | STORE_RELEASE detailed description + store-listing single-purpose/full description use one-memory narrative (Assist Sync + Gemini as features). |

## Deferred (out of this track / owned elsewhere)

| Item | Reason |
|------|--------|
| **U-1 + U-3** (Assist Sync Disable / gate Sync now) | Owned by Assistant Sync product-gap track. |
| **U-5…U-9** (tokens, buttons, type scale, empty copy) | Owned by UI chrome track. |
| **P-1…P-13** polish | Explicitly deferred by audit unless forced; not required to land Track A. |
| **C-1** empty `release` OAuth | Intentional constraint; untouched. `build:store` must still refuse. |
| **Product gaps 14–17** | Owned by Assist Sync product-gap track. |

## Collision note

See `pass3-privacy-notes.md` (consent UI on options/onboarding/popup used existing button classes; no design-token restyle).

## Tests run

- `npx vitest run tests/copy-guard.test.ts src/popup/popup.test.ts tests/manifest.test.ts tests/assistant-sync-options.test.ts tests/history-import.test.ts` → **5 files / 16 tests passed**
- `npx tsc --noEmit`: no errors in Track A files (pre-existing assistant-sync DriveApi / offscreen kind errors remain elsewhere)
- `npm run build:store` → still refuses with empty release OAuth client id (C-1 intact)
- Confirmed `config/oauth-clients.json` `"release": ""` unchanged
- Coexistence: Assist Sync Disable control from the other track is present in `options.html`; indexing consent group sits above Indexing and retention without conflict
