# Cortex  - Privacy policy

**Last updated:** October 2026  

The [HTML version](privacy-policy.html) (for GitHub Pages) includes the Cortex icon and the same content.

**Author:** Solely built by [Shailesh Kumar](https://www.linkedin.com/in/shailesh-entrant/).

**Summary:** Cortex is a **local-first** Chrome extension. It builds a searchable index of **readable page text** from sites you visit, only after you agree in the product UI. **Indexing and search run on your device** using IndexedDB and optional on-device ML. **Optional Assistant Sync** copies that memory into a folder you own in Google Drive after you press Enable. **Optional cloud chat** (Gemini) sends only what you choose when you enable it in settings: typically your question plus retrieved snippets, not your entire browsing history to a Cortex server (there is none).

**Google APIs Limited Use:** Cortex's use of information received from Google APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Data collected by Cortex

| Data | Where it stays | Purpose |
|------|----------------|---------|
| Extracted page text (chunked) | Your device (IndexedDB) | Search, Ask, Digest |
| Visit timestamps / URLs / titles | Your device | Recency ranking, digests |
| Settings (blocklist, pause, chat mode, optional API key) | `chrome.storage.local` on your device | Extension behavior |
| Assistant Sync copy (titles, URLs, long-read excerpts, searches, LinkedIn profiles, topics) | Folder `Cortex Memory` in your Google Drive, only if you enable it | So an assistant you connect can answer from that file |

**Cortex does not operate a backend that receives your indexed content.** There is no Cortex account and no Cortex server that stores your browsing. Optional Assistant Sync writes a copy into a folder you own in Google Drive.

## When indexing starts

Cortex does **not** begin indexing or history import on install by itself. On first run, the welcome page asks you to **Start indexing** (affirmative consent). Until you agree, or until you press **Allow indexing** / **Scan history** in Settings, no new browsing activity is stored.

After you agree, Cortex may:

- Index readable http(s) pages you open (with privacy skips below).
- Optionally run a one-time scan of up to 500 URLs from the last 30 days of browser history to seed the library (you can also start a history scan anytime from Settings).

**Incognito:** Cortex is set to `incognito: not_allowed`. Incognito windows are never indexed or synced.

Sensitive sites (banking, health, email, login pages), your blocklist, and admin policies are skipped before anything is read or stored.

## Optional Assistant Sync

Assistant Sync stays off until you press Enable. It uses the Google scope `drive.file`, which covers only files Cortex creates. The copy lives in one folder named Cortex Memory in your Google Drive. You own that file. Drive writes run only while sync is enabled. Delete all indexed data, after you type DELETE, removes the local library and moves that folder to the Drive trash. See [data-deletion.html](data-deletion.html).

## Optional cloud chat (Gemini)

If you turn on **cloud chat** and add a **Google Gemini API key**, prompts are sent **from your browser directly to Google's API** under Google's terms, not through Cortex infrastructure. You can disable cloud chat at any time.

## Permissions (Chrome Web Store justification)

- **`tabs` / host access (`http://*/*`, `https://*/*`):** Needed to read active tab context for indexing pages you visit and to show the in-page overlay. Broad hosts are required for the core single purpose (index what you read on any site). Content scripts run at `document_idle` on http(s) pages after privacy checks.
- **`storage`:** Saves settings and extension state locally.
- **`history`:** Used for optional bulk import after you agree on the welcome page or press Scan history in Settings. Not continuous surveillance.
- **`scripting` / `offscreen` / `alarms`:** Required for MV3 lifecycle, embeddings, and periodic maintenance (for example storage headroom). Assistant Sync work runs only while sync is enabled; sync handlers no-op when sync is off.
- **`identity`:** Google sign-in, used only when you press Enable for Assistant Sync (interactive token from that click). Later Sync now / alarm use a silent token.
- **`notifications`:** Optional notice when a first history scan starts and finishes.
- **`https://*/*`:** The same page access used for indexing also lets Cortex create and update the Cortex Memory file after you press Enable. Enable asks only for the Drive file permission.

## Contact

**GitHub Issues:** [github.com/skumar54uncc/Cortex/issues](https://github.com/skumar54uncc/Cortex/issues)

## Public URLs for the Chrome Web Store

After you enable **GitHub Pages** (Settings → Pages → **Deploy from branch** `main`, folder **`/docs`**), use:

**`https://skumar54uncc.github.io/Cortex/privacy-policy.html`**

as the **Privacy policy** URL in the listing. Data deletion:

**`https://skumar54uncc.github.io/Cortex/data-deletion.html`**

The same content lives in this repo as `docs/privacy-policy.html`, `docs/data-deletion.html`, and `docs/PRIVACY_POLICY.md`.
