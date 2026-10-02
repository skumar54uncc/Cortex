# Pass 3 Track A - privacy notes / collisions

## UI collisions avoided

- Consent controls on onboarding and options reuse existing `.cx-btn` / `.cx-card` / `.cx-group` styles from `options.css`. No design-token unification, button primitive rewrite, or accent hex changes (those belong to the UI chrome track: U-5/U-6/U-7/U-8).
- Popup sticky disclosure and blurb copy edits only; no popup button restyle or storage-bar gradient changes (P-7/P-8 left alone).
- Did not edit `assistant-sync-panel.ts` or Assist Sync Enable/Disable product logic (U-1/U-3 and product gaps).

## Behavioral notes for reviewers

1. Interactive `getAuthToken` remains only on Assist Sync Enable (untouched).
2. First-install history + open-tab priming runs only when welcome **Start indexing** sends `CORTEX_INDEXING_CONSENT_GRANT` with `runFirstInstallBackfill: true`.
3. Options **Allow indexing** grants consent for live indexing only; history import remains the separate Scan history control (which also grants consent as an affirmative action).
4. Upgraded installs that already completed onboarding or first-install backfill receive `INDEXING_CONSENT_KEY` automatically (grandfather).
