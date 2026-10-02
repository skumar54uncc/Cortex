# Cortex — Privacy policy (draft)

**Last updated:** October 2026  

The [HTML version](privacy-policy.html) (for GitHub Pages) includes the Cortex icon and the same content.

**Author:** Solely built by [Shailesh Kumar](https://www.linkedin.com/in/shailesh-entrant/).

**Summary:** Cortex is a **local-first** Chrome extension. It builds a searchable index of **readable page text** from sites you visit. **Indexing and search run on your device** using IndexedDB and optional on-device ML. **Optional cloud chat** (Gemini) sends only what you choose when you enable it in settings—typically your question plus retrieved snippets—not your entire browsing history to a Cortex server (there is none).

## Data collected by Cortex

| Data | Where it stays | Purpose |
|------|----------------|---------|
| Extracted page text (chunked) | Your device (IndexedDB) | Search, Ask, Digest |
| Visit timestamps / URLs / titles | Your device | Recency ranking, digests |
| Settings (blocklist, pause, chat mode, optional API key) | `chrome.storage.local` on your device | Extension behavior |
| Assistant Sync copy (titles, URLs, long-read excerpts, searches, LinkedIn profiles, topics) | Folder `Cortex Memory` in your Google Drive, only if you enable it | So an assistant you connect can answer from that file |

**Cortex does not operate a backend that receives your indexed content.** There is no Cortex account and no Cortex server that stores your browsing. Optional Assistant Sync writes a copy into a folder you own in Google Drive.

## Optional Assistant Sync

Assistant Sync stays off until you press Enable. It uses the Google scope `drive.file`, which covers only files Cortex creates. The copy lives in one folder named Cortex Memory in your Google Drive. You own that file. Delete all indexed data, after you type DELETE, removes the local library and moves that folder to the Drive trash. See [data-deletion.html](data-deletion.html).

## Optional cloud chat (Gemini)

If you turn on **cloud chat** and add a **Google Gemini API key**, prompts are sent **from your browser directly to Google’s API** under Google’s terms—not through Cortex infrastructure. You can disable cloud chat at any time.

## Permissions (Chrome Web Store justification)

- **`tabs` / `<all_urls>` host access:** Needed to read active tab context for indexing and to show the in-page overlay on pages you choose.
- **`storage`:** Saves settings and extension state locally.
- **`history` (if requested):** Used only for optional bulk import features you trigger; not continuous surveillance.
- **`scripting` / `offscreen` / `alarms`:** Required for MV3 lifecycle, embeddings, and periodic maintenance (e.g., storage headroom). The 15 minute Assistant Sync alarm runs only after you enable sync.
- **`identity`:** Google sign-in, used only when you press Enable for Assistant Sync.
- **`https://www.googleapis.com/*` (optional host):** Requested on that same click. Used to create and update the Cortex Memory file.

## Contact

**GitHub Issues:** [github.com/skumar54uncc/Cortex/issues](https://github.com/skumar54uncc/Cortex/issues)

## Public URLs for the Chrome Web Store

After you enable **GitHub Pages** (Settings → Pages → **Deploy from branch** `main`, folder **`/docs`**), use:

**`https://skumar54uncc.github.io/Cortex/privacy-policy.html`**

as the **Privacy policy** URL in the listing. Data deletion:

**`https://skumar54uncc.github.io/Cortex/data-deletion.html`**

The same content lives in this repo as `docs/privacy-policy.html`, `docs/data-deletion.html`, and `docs/PRIVACY_POLICY.md`.
