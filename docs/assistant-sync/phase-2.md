# Assistant Sync phase 2

Drive layout and the delete-all trash path. No options toggle, no alarms, no change to ranking. The retrieval files were not edited.

The toggle stays off. Phase 4 does not ship it until the duplicate test in this phase keeps passing.

## What landed

| Piece | Where | Behavior |
|-------|--------|----------|
| Sheet contract | `sheet.ts` | Seven tabs in order. About text matches the contract, including `schema_version: 3` on the last row. Dates are text. Header row is bold and frozen on every tab, About included. |
| Drive client | `drive-api.ts` | `drive.file` only. Creates the folder and one spreadsheet, writes with `valueInputOption=RAW`, appends new ids, trashes a file. Loaded from the `assistant-sync` chunk. |
| Missing file | `inspectMemory`, `syncIfReady` | A missing or trashed file is reported. A timer sync does not create a replacement. |
| Re-enable | `reenableMemory` | Creates a new folder and file only when the stored one is not ready. |
| Archives | `buildArchiveWorkbook` | Returns nothing unless the toggle is on. Title is `Cortex Memory Archive YYYY-MM`. About says the file is a personal backup and not for assistant queries. Default is off. |
| Trash hook | service worker message `CORTEX_ASSISTANT_SYNC_TRASH` | `forgetAll` still clears local sync rows, then the service worker asks the offscreen document to trash the stored folder. The service worker does not call Google. |
| Seed | `npm run assistant-sync:seed` | Builds `Cortex Memory Seed`, separate from the live `Cortex Memory` file. 90 days, 150 visits on a weekday. Needles: pinecone excerpt, Tesla search, Ada Marin, Tesla company People. |
| Topics | `topic-vectors-int8.json` | int8 with a per label scale. 22,626 bytes of source, 23,026 bytes in `assistant-sync-topics.js`. The 130 KB float file is not imported by any bundle. |

Manifest adds `identity`, an `oauth2` block scoped to `https://www.googleapis.com/auth/drive.file`, and `optional_host_permissions` for `https://www.googleapis.com/*`. That host is not a required permission. The client id is the placeholder `REPLACE_ME.apps.googleusercontent.com`. Paste the Chrome Extension client for unpacked id `fkhaacmaaaheapelljjcmfdmifmfbboa` before auth can succeed. Adding `identity` can prompt existing users to approve the extension again.

## Duplicate test

`tests/assistant-sync-drive.test.ts` covers the hazard: trash the folder, a silent sync does not recreate it, re-enable creates a new folder and file, the same visit id is appended once, and a second append adds zero rows. The old file stays trashed. `forgetAll` still clears the sync database and calls the hook (`tests/assistant-sync.test.ts`).

## Topics after quantization

Precision and recall stay 1 at threshold 0.42 on the same 18 fixture pages, using the decoded int8 vectors. The threshold was not moved.

## Gates

`npm run typecheck` passed. The new Drive tests and the existing capture tests passed. Topic precision passed. `npm run check:budget` passed. Measured sizes: service worker 218,269 of 225,280, offscreen 680,913 of 716,800, `assistant-sync.js` 7,750 of 24,576, `assistant-sync-topics.js` 23,026 of 48,192. Drive and Sheets URLs are in `assistant-sync.js` only. The seed command printed 10,382 Visits rows, 630 Content rows, and 91 Daily rows.

## Unverified

No sheet was created in a real Google account. Auth cannot succeed until the placeholder client id is replaced. Cell warning at 5 million cells is computed and not shown in the UI yet.

`npm test` on Node 20 still fails the same four older tests this phase does not touch.
