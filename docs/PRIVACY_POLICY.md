# Cortex — Privacy policy (draft)

**Last updated:** April 2026  

The [HTML version](privacy-policy.html) (for GitHub Pages) includes the Cortex icon and the same content.

**Author:** Solely built by [Shailesh Kumar](https://www.linkedin.com/in/shailesh-entrant/).

**Summary:** Cortex is a **local-first** Chrome extension. It builds a searchable index of **readable page text** from sites you visit. **Indexing and search run on your device** using IndexedDB and optional on-device ML. **Optional cloud chat** (Gemini) sends only what you choose when you enable it in settings—typically your question plus retrieved snippets—not your entire browsing history to a Cortex server (there is none).

## Data collected by Cortex

| Data | Where it stays | Purpose |
|------|----------------|---------|
| Extracted page text (chunked) | Your device (IndexedDB) | Search, Ask, Digest |
| Visit timestamps / URLs / titles | Your device | Recency ranking, digests |
| Settings (blocklist, pause, chat mode, optional API key) | `chrome.storage.local` on your device | Extension behavior |

**Cortex does not operate a backend that receives your indexed content.** There is no Cortex account and no Cortex-hosted sync.

## Optional cloud chat (Gemini)

If you turn on **cloud chat** and add a **Google Gemini API key**, prompts are sent **from your browser directly to Google’s API** under Google’s terms—not through Cortex infrastructure. You can disable cloud chat at any time.

## Permissions (Chrome Web Store justification)

- **`tabs` / `<all_urls>` host access:** Needed to read active tab context for indexing and to show the in-page overlay on pages you choose.
- **`storage`:** Saves settings and extension state locally.
- **`history` (if requested):** Used only for optional bulk import features you trigger; not continuous surveillance.
- **`scripting` / `offscreen` / `alarms`:** Required for MV3 lifecycle, embeddings, and periodic maintenance (e.g., storage headroom).

## Contact

**GitHub Issues:** [github.com/skumar54uncc/Cortex/issues](https://github.com/skumar54uncc/Cortex/issues)

## Public URLs for the Chrome Web Store

After you enable **GitHub Pages** (Settings → Pages → **Deploy from branch** `main`, folder **`/docs`**), use:

**`https://skumar54uncc.github.io/Cortex/privacy-policy.html`**

as the **Privacy policy** URL in the listing. The same content lives in this repo as `docs/privacy-policy.html` and `docs/PRIVACY_POLICY.md`.
