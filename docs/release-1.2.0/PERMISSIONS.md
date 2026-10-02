# Manifest permissions and their justification (release 1.2.0)

Every entry in `manifest.json` `permissions`, `host_permissions` and `web_accessible_resources` is listed here with the feature that needs it and the install warning it triggers. New permissions added in this release are marked **new**. Prefer permissions that do not add an install warning.

## permissions

| Permission | Why Cortex needs it | Install warning | Status |
|------------|--------------------|-----------------|--------|
| `tabs` | Read the active tab URL and title to route the toolbar click (overlay on http(s), side panel on chrome://) and to skip incognito or restricted tabs. | "Read your browsing history" (combined with host permissions) | existing |
| `scripting` | Inject `overlay.js` on demand when the user opens Cortex, and re-inject `content.js` after install into already open tabs. Since 1.2.0 the overlay is no longer part of the always-on content script. | none beyond host permissions | existing |
| `offscreen` | Host the on-device embedding model (WASM) and search/chat runners outside the service worker so long jobs are not killed by MV3 suspension. Also runs Assistant Sync Drive/Sheets HTTPS after Enable (lazy-loaded chunk). | none | existing |
| `alarms` | Periodic storage eviction, stats snapshot, daily retention cleanup, and (when Assistant Sync is enabled) the Assist Sync poll. Sync handlers no-op while sync is off. | none | existing |
| `storage` | User settings in `chrome.storage.local`; (1.2.0) enterprise policy in `chrome.storage.managed`. | none | existing |
| `history` | Optional history backfill after the user agrees on the welcome page (Start indexing) or presses Scan history in Settings. Not continuous surveillance. | "Read your browsing history" | existing |
| `notifications` | One notification when the first-install history scan starts and finishes (after consent). | "Display notifications" | existing |
| `sidePanel` | Cortex UI on pages where content scripts cannot run (`chrome://newtab`, the Web Store). | none | existing |
| `contextMenus` | "Save to Cortex" on selected text (highlights, Phase 5.3) and "Add page to collection" (Phase 5.4). Items are removed when the user turns those features off. | none | **new** |
| `identity` | Google sign-in for optional Assistant Sync. Interactive `getAuthToken` runs only when the user presses Enable in Settings (the click explains the Drive folder). Alarm and Sync now use a silent token afterward. Scope is `drive.file` only. | none (OAuth consent is separate) | existing |

## host_permissions

| Pattern | Why | Warning |
|---------|-----|---------|
| `http://*/*`, `https://*/*` | Content script for page extraction on every site the user reads (core single purpose: private memory of what you read), and fetching page HTML during consented history import. Sensitive domains, blocklist, allowlist and incognito gates apply before anything is stored. The same page access is used after Enable to create/update the app-created Cortex Memory file in the user's Drive. | "Read and change all your data on all websites" |

No new host permission in 1.2.0. Two additional uses of the existing one, both behind the full privacy gate:

- **PDFs (Phase 5.9).** Content scripts do not run in Chrome's PDF viewer, so the service worker sees a PDF tab through `tabs.onUpdated` (the tab URL is readable through the existing `tabs` and host permissions). After the gate passes, the offscreen document fetches that same URL once with `credentials: "omit"` and `redirect: "error"`, 30 MB cap. PDFs behind a login are therefore not indexed; this is deliberate (no cookies are replayed).
- **Tab URL on PDF tabs** is the only tab data read; nothing is injected into the viewer.

**Reviewer note (single purpose):** Broad install-time hosts are required for indexing pages the user visits on any site. They are not a separate "read all websites" product. Assistant Sync and optional Gemini are features of the same private memory (export/sync and Q&A over retrieved snippets).

## web_accessible_resources

1.0.1 exposed `icons/*.png`, `fonts/*.woff2` and `models/**/*` to `<all_urls>`. Any page could probe `chrome-extension://<id>/models/...` and detect Cortex.

1.2.0 exposes only what the injected overlay loads, on http(s) pages only, with `use_dynamic_url: true` so the URL changes per session and cannot be used as a stable fingerprint:

| Resource | Used by |
|----------|---------|
| `icons/icon-48.png` | Overlay header brand icon |
| `fonts/*.woff2` | Overlay typography (Plus Jakarta Sans) |

Model weights (`models/`) and the ONNX Runtime binary (`wasm/`) are loaded only by the offscreen document, which is an extension page and needs no web accessibility.

Guarded by `tests/manifest.test.ts`.

## Managed storage (Phase 4.1)

`"storage": { "managed_schema": "managed_schema.json" }` declares the enterprise policy keys. It uses the existing `storage` permission and adds no install warning. The extension can only read `chrome.storage.managed`; values come from Chrome management (Admin console, GPO, policy files). See `docs/ENTERPRISE.md`.

## Permissions this release deliberately does not add

| Candidate | Decision |
|-----------|----------|
| `downloads` | Not needed. Export files (Phase 5.10) are saved from the options page through a temporary `blob:` link with the `download` attribute. The `downloads` permission would add a "Manage your downloads" warning. |
| `webNavigation` | Not needed; SPA navigation is detected in the content script. |
| `declarativeNetRequest` | Not needed. |
| Full Google Drive scope (`drive`) | Not needed. Assistant Sync uses `drive.file` only (app-created `Cortex Memory` folder). |

## Manifest keys without a permission

| Key | Why | Warning |
|-----|-----|---------|
| `omnibox: { keyword: "cx" }` (**new**, Phase 5.2) | Typing `cx` and a query in the address bar searches the local library; suggestions come from IndexedDB only. Turning the feature off in settings makes it return no suggestions. | none |
| `oauth2` + `identity` | Chrome Extension OAuth client; scope `https://www.googleapis.com/auth/drive.file` only. Interactive auth only from Enable. | OAuth consent screen |
| `incognito: "not_allowed"` | Incognito windows are never indexed or synced. | none |
