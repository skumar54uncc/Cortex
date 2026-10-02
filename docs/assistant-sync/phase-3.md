# Assistant Sync phase 3

Sync engine. No options toggle, no change to ranking. The retrieval files were not edited. Eval files were not edited.

Sync stays off until an explicit enable. A timer never creates a Drive file.

## OAuth client id

Dev client, bound to unpacked id `fkhaacmaaaheapelljjcmfdmifmfbboa`:

`1001602130427-c4skn7nc1rglp56h5egnchv2khlafk5v.apps.googleusercontent.com`

`config/oauth-clients.json` is the source of truth.

| Key | Who uses it | Command |
|-----|-------------|---------|
| `dev` | Unpacked extension | `npm run build`, `npm run watch` |
| `release` | Chrome Web Store item | `npm run build:store` |

Put the Web Store OAuth client id in `config/oauth-clients.json` under `"release"` at publish time. `npm run build:store` writes that id into `dist/manifest.json`. The command exits before compile while `release` is empty. Do not hand-edit the client id in either manifest.

`npm run build` wrote the dev client into `dist/manifest.json`. Scope remains `drive.file` only. `https://www.googleapis.com/*` stays an optional host permission.

## What landed

| Piece | Where | Behavior |
|-------|--------|----------|
| Alarm | `cortex-assistant-sync`, every 15 minutes | Runs only while sync is on. Asks the offscreen document to sync. |
| Sync now | message `CORTEX_ASSISTANT_SYNC` action `now` | Same pass as the alarm, and it clears a 10-failure stop. |
| Enable | action `enable` | Requests the Google host permission, opens the Google sign-in, creates the folder if needed, backfills, then syncs. |
| Status | action `status` | Returns `syncEnabled`, `lastError`, and backfill `done` / `total` / `phase` for the phase 4 screen. |
| Append | `spreadsheets.values.append`, batches of 200 | Pending rows live in IndexedDB. A synced id is skipped, including after a restart. |
| Crash window | read column A before append | If Chrome dies after Google accepts the row and before the local key is saved, the next pass sees the id and does not append it again. |
| Backoff | 429 and 5xx | Delay starts at about 0.5s and doubles, capped at 60s, with jitter. After 10 consecutive failures the plain error is "Sync paused after 10 failed attempts. Cortex will try again on the next 15 minute check." Further retries wait for the next alarm or Sync now. |
| Retention | `deleteDimension` | Default 90 days, clamped to 7–365. Rows with a local date before the cutoff are removed, then About is rewritten. |
| Archives | off | An archive spreadsheet is created only when `archivesEnabled` is true. |
| Backfill | on enable | Visit log rows inside the retention window. Dwell, scroll, how_found, and section are blank. No excerpts. Progress is `done` / `total`. |
| Missing file | `inspectMemory` | Reported. The alarm does not create a replacement. Enable is the path that creates. |
| Live visits | after each indexed page, only while sync is on | Stored for the next alarm. Dwell is blank because the extension does not measure it yet. |

Google fetches run in the `assistant-sync` chunk. The service worker sends a message and does not call Drive or Sheets. The token is obtained with `chrome.identity.getAuthToken` in the service worker so the sign-in popup stays tied to the enable action.

## Gates

`npm run typecheck` passed. New engine tests and the existing Assistant Sync tests passed (40 in those files). `npm run check:budget` passed.

| File | Size | Budget |
|------|------|--------|
| service-worker.js | 220,384 | 225,280 |
| offscreen.js | 688,578 | 716,800 |
| assistant-sync.js | 35,930 | 49,152 |
| assistant-sync-topics.js | 23,026 | 49,152 |
| assistant-sync-capture.js | 3,585 | 16,384 |

Drive and Sheets URLs are in `assistant-sync.js` only. `npm run build:store` exits with the empty-release error.

## Smoke test

Use a separate Chrome profile. The build to load is `dist/` from `npm run build`. On `chrome://extensions`, turn on Developer mode, Load unpacked, and choose the `dist` folder. The id should be `fkhaacmaaaheapelljjcmfdmifmfbboa`.

There is no sync toggle on the options page yet. The stub is the options-page console. Phase 4 will send the same messages from buttons. Open `chrome-extension://fkhaacmaaaheapelljjcmfdmifmfbboa/options.html`, open DevTools, and use the console there.

1. Enable. Paste:

```javascript
chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable" }, console.log)
```

Chrome may ask for permission to reach `googleapis.com`. Then the Google account chooser. Then the consent screen. Expect the app name **Cortex**. Expect this permission line:

`See, edit, create, and delete only the specific Google Drive files you use with this app`

That is the `drive.file` line. If the project is still in Testing, Google may also say the app is not verified. Continue only with an account that is a test user on that consent screen. A successful reply looks like `{ ok: true, status: "ready", created: true }`.

If the permission prompt never appears, stop. `chrome.permissions.request` needs a user gesture, and a console paste does not always count. That step waits for the phase 4 Enable button, which will send this same message from a click.

2. In Drive, open the folder **Cortex Memory** and the spreadsheet **Cortex Memory**. Tabs, in order: About, Visits, Content, Searches, People, Companies, Daily. About ends with `schema_version: 3`. Dates are text (`2026-10-02`), not serials. A fresh profile has headers and an About tab until something is indexed. Backfill copies only the visit log already in that profile, inside 90 days.

3. Browse a few normal pages and let Cortex index them. Within 15 minutes the alarm appends new Visits rows. To check sooner, paste:

```javascript
chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "now" }, console.log)
```

Dwell cells are blank. Run Sync now a second time and confirm the same id is not added again.

4. Progress and errors, for the phase 4 screen:

```javascript
chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "status" }, console.log)
```

5. Quit Chrome from the menu while a sync is in flight, reopen, and run Sync now. Each visit id appears once.

6. On the options page, choose **Delete all indexed data**, type `DELETE`, and confirm. The Cortex Memory folder moves to trash. Run the enable command again. A new folder and spreadsheet appear, and each current id is appended once. Sync now after that does not add a second copy.

The options page still has no Sync now button, retention control, archive toggle, or consent screen of our own. Those land in phase 4 and should call `enable`, `now`, and `status`.

## Unverified

No sheet was created in a real Google account from this machine. The consent screen, the 15 minute alarm, and a mid-sync quit are for the profile test above.
