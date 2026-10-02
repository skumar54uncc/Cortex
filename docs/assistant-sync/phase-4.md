# Assistant Sync phase 4

Options UI, consent, and the store pages. No change to ranking. The retrieval files were not edited.

Phase 3 is committed. This phase is not. The Google account smoke test is ready for a separate Chrome profile. It was not run here.

## Options

Settings has an Assistant Sync section. The consent text sits above Enable. It names what is copied (page titles, URLs, excerpts after a 5 minute read, searches, LinkedIn profiles, topics), the folder Cortex Memory in the user's Google Drive, and that a connected assistant can receive the relevant rows.

Enable is the user gesture. In that same click the options page requests `https://www.googleapis.com/*` and calls `chrome.identity.getAuthToken({ interactive: true })`. Both calls start before the first await, so the click is still the gesture. The token is sent with `CORTEX_ASSISTANT_SYNC` action `enable`. The service worker does not open a second sign-in popup. Sync now sends action `now` and uses the silent token. The 15 minute alarm uses that same silent path.

Status shows sync on or off, the last successful sync time, the last error in plain language, and backfill as done/total plus the phase. Retention is a number from 7 to 365, default 90. The archive switch defaults to off. Its note says archives are personal backups and assistants do not read them. Those two settings are stored locally and applied on the next sync pass.

Delete all indexed data still requires DELETE. The existing hook moves the Cortex Memory folder to the Drive trash. The section text says so.

Five short guides (Muse, Grok, ChatGPT, Claude, and a generic assistant) each say to connect Google Drive, open the Cortex Memory sheet, read About first, and check Content before the assistant uses its own knowledge. Each is under 150 words.

## Budgets

The options behavior is `assistant-sync-options.js`, 2,814 of 16,384 bytes. `options.js` is 26,045 of 40,960. The service worker is 220,491 of 225,280. That is 107 bytes over the phase 3 size, for passing the click token through. Google fetch remains in `assistant-sync.js` only.

`npm run typecheck` passed. The options click test passed: permission, interactive token, then the enable message carrying that token. `npm run check:budget` passed.

## Legal and listing

Hosted from `docs/` once GitHub Pages deploys this branch:

| Page | File | URL |
|------|------|-----|
| Privacy policy | `docs/privacy-policy.html` | https://skumar54uncc.github.io/Cortex/privacy-policy.html |
| Data deletion | `docs/data-deletion.html` | https://skumar54uncc.github.io/Cortex/data-deletion.html |
| Listing draft | `docs/store-listing.md` | Not a public page. Copy it into the store console. |

The policy states the `drive.file` scope, the single Cortex Memory folder, that the user owns the file, and that delete-all moves the folder to the Drive trash. The listing draft has the title, the 104 character short description, the full description, category Productivity, permission justifications, and the single purpose statement.

## Smoke test

Use a fresh Chrome profile. Load unpacked `dist/` from `npm run build`. The id should be `fkhaacmaaaheapelljjcmfdmifmfbboa`. Open the extension's Settings page.

1. Read the Assistant Sync consent. Press Enable. Allow the `googleapis.com` permission if Chrome asks. On the Google screen, expect the app name Cortex and this line: `See, edit, create, and delete only the specific Google Drive files you use with this app`. If the project is in Testing, continue only with a test user. Status should show Sync on.

2. In Drive, open the folder Cortex Memory and the spreadsheet Cortex Memory. Seven tabs, in order: About, Visits, Content, Searches, People, Companies, Daily. About ends with `schema_version: 3`. Dates are text.

3. Browse a few normal pages. Within 15 minutes, or after Sync now, new rows appear on Visits. Dwell is blank. Sync now a second time does not duplicate an id.

4. Quit Chrome from the menu during a sync, reopen, and press Sync now. Each visit id appears once.

5. Privacy and data, Delete all indexed data, type DELETE, confirm. The folder is in the Drive trash. Press Enable again. A new folder appears and each current id is appended once.

The sign-in, the consent screen, and the Drive checks are the part that needs your test-user account. Nothing in this phase was committed.
