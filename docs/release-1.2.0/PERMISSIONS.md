# Manifest permissions and their justification (release 1.2.0)

Every entry in `manifest.json` `permissions`, `host_permissions` and `web_accessible_resources` is listed here with the feature that needs it and the install warning it triggers. New permissions added in this release are marked **new**. Prefer permissions that do not add an install warning.

## permissions

| Permission | Why Cortex needs it | Install warning | Status |
|------------|--------------------|-----------------|--------|
| `tabs` | Read the active tab URL and title to route the toolbar click (overlay on http(s), side panel on chrome://) and to skip incognito or restricted tabs. | "Read your browsing history" (combined with host permissions) | existing |
| `scripting` | Inject `overlay.js` on demand when the user opens Cortex, and re-inject `content.js` after install into already open tabs. Since 1.2.0 the overlay is no longer part of the always-on content script. | none beyond host permissions | existing |
| `offscreen` | Host the on-device embedding model (WASM) and search/chat runners outside the service worker so long jobs are not killed by MV3 suspension. | none | existing |
| `alarms` | Periodic storage eviction, stats snapshot, and (1.2.0) daily retention cleanup. | none | existing |
| `storage` | User settings in `chrome.storage.local`; (1.2.0) enterprise policy in `chrome.storage.managed`. | none | existing |
| `history` | Optional history backfill during onboarding (user opt-in). | "Read your browsing history" | existing |
| `notifications` | One notification when the first-install history scan starts and finishes. | "Display notifications" | existing |
| `sidePanel` | Cortex UI on pages where content scripts cannot run (`chrome://newtab`, the Web Store). | none | existing |

## host_permissions

| Pattern | Why | Warning |
|---------|-----|---------|
| `http://*/*`, `https://*/*` | Content script for page extraction on every site the user reads, and fetching page HTML during history import. Sensitive domains, blocklist, allowlist and incognito gates apply before anything is stored. | "Read and change all your data on all websites" |

## web_accessible_resources

1.0.1 exposed `icons/*.png`, `fonts/*.woff2` and `models/**/*` to `<all_urls>`. Any page could probe `chrome-extension://<id>/models/...` and detect Cortex.

1.2.0 exposes only what the injected overlay loads, on http(s) pages only, with `use_dynamic_url: true` so the URL changes per session and cannot be used as a stable fingerprint:

| Resource | Used by |
|----------|---------|
| `icons/icon-48.png` | Overlay header brand icon |
| `fonts/*.woff2` | Overlay typography (Plus Jakarta Sans) |

Model weights (`models/`) and the ONNX Runtime binary (`wasm/`) are loaded only by the offscreen document, which is an extension page and needs no web accessibility.

Guarded by `tests/manifest.test.ts`.

## Permissions this release deliberately does not add

| Candidate | Decision |
|-----------|----------|
| `webNavigation` | Not needed; SPA navigation is detected in the content script. |
| `declarativeNetRequest` | Not needed. |
| `identity` | No accounts. |

Later phases add `omnibox` (keyword `cx`, no warning) and `contextMenus` (no warning). They will be appended to the table above with their justification when implemented.
