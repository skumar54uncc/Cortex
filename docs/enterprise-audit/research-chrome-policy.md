# Chrome Web Store policy research (Pass 1) — Cortex

**Research date:** 2026-10-02 (America/New_York)  
**Scope:** Current Chrome Web Store / Chrome extension docs relevant to a privacy-first Manifest V3 extension with optional Google Drive sync.  
**Constraint:** Documentation-only; no application/source code, manifest, or OAuth item-id / public-key changes recommended or performed.

## Product facts used (given; not invented)

- Cortex is **MV3**. Library stays **on device**. **No Cortex server**, no telemetry.
- **Optional Assistant Sync** copies memory into the user's own Google Drive folder **`Cortex Memory`**, only after the user presses **Enable**.
- Auth: `chrome.identity.getAuthToken` with only **`drive.file`** scope.
- Unpacked extension id: `fkhaacmaaaheapelljjcmfdmifmfbboa`
- Published CWS id: `happibddmmagkgneicjkndapcpmhdbfn`
- Do **not** change OAuth item id or public key in `manifest.json`.

Observed from current `manifest.json` (read-only for context): `incognito: "not_allowed"`; required `host_permissions` `http://*/*` + `https://*/*`; content scripts on all http(s); permissions include `tabs`, `history`, `identity`, `scripting`, `offscreen`, etc.; `oauth2.scopes` = `drive.file` only.

---

## 1. Single purpose policy

### Policy text (paraphrase / short quote)

> An extension must have a **single purpose that is narrow and easy to understand**. Do not require users to accept bundles of unrelated functionality. If two pieces are clearly separate, they should be separate extensions.

Source: [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines)

Troubleshooting maps violations to **Red Magnesium / Red Copper / Red Lithium / Red Argon**. Common rejects: two+ unrelated purposes; unrelated action-icon features; search/NTP overrides; ad injection as a distinct purpose.

Source: [Troubleshooting — Single purpose](https://developer.chrome.com/docs/webstore/troubleshooting)

Dashboard guidance: the Privacy practices **single purpose description** must clearly communicate that focus for reviewers.

Source: [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

### Cortex implications

- Frame **one** purpose: *private, on-device searchable memory of what the user has read* (index + Ask/search UI).
- Treat **optional Assistant Sync (Drive)** and **optional cloud chat (Gemini)** as *features of that same purpose* (export/sync of the same memory; Q&A against retrieved snippets)—not as separate products (e.g. “Drive file manager” or “general Gemini client”).
- Listing, screenshots, and in-product copy must not imply unrelated tool bundles.
- Risk if reviewers read “local library + Drive backup + Gemini chat” as multiple purposes without a tight narrative.

---

## 2. Permission justifications & minimum permissions

### Policy text

> Request access to the **narrowest permissions necessary** to implement your Product's features. If more than one permission could implement a feature, request those with the **least access**. Don't “future proof” with unused permissions.

Source: [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)

Dashboard: every permission from the manifest needs a **specific justification**; unused permissions should be removed before upload. Broader-than-necessary permissions may cause rejection (**Purple Potassium**).

Sources: [cws-dashboard-privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Troubleshooting — Excessive permissions](https://developer.chrome.com/docs/webstore/troubleshooting)

Developer FAQ: minimum-permission rules apply to **both required and optional** permissions; list permissions and reasons in the listing or an in-extension about page.

Source: [User Data FAQ — Minimum Permission](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

### Cortex implications

- Prepare **feature-tied** justifications for each of: `tabs`, `offscreen`, `alarms`, `scripting`, `storage`, `history`, `notifications`, `sidePanel`, `contextMenus`, `identity`, and broad hosts.
- Especially sensitive: **`history`** (must map to user-triggered bulk import only, not continuous surveillance) and **broad host / content-script access** (must map to indexing + overlays on pages the user visits).
- Vague phrases like “required for functionality” are review-hostile; name the UI surface and data flow.
- Do not leave declared-but-unused permissions in the package.

---

## 3. Optional host permissions & optional API permissions

### Docs text

- Prefer **`optional_permissions` / `optional_host_permissions`** when a feature is not essential to core install-time functionality, so users grant access when enabling that feature.
- `chrome.permissions.request` must run from a **user gesture**; hosts can be requested as subsets of declared optional patterns (e.g. declare `https://*/*`, request a specific origin).

Sources: [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)

### Cortex implications

- Core product (index pages you browse) may still need broad host/content-script access for the single purpose—but reviewers scrutinize **install-time** `<all_urls>`-style grants heavily.
- Optional features (Drive sync, Gemini) align with **runtime consent** patterns; Drive OAuth already gates on Enable. If any *host* access is only needed for Drive API HTTPS calls from the extension origin, note that `drive.file` + `identity` typically use Google endpoints—justify whether broad hosts are truly required for sync vs for page indexing.
- Moving non-core permissions to optional (where product UX allows) reduces Purple Potassium risk and improves install conversion; any such change is a later engineering decision—not part of this research pass.

---

## 4. OAuth2 / `chrome.identity` / limited scopes (`drive.file`)

### Chrome Identity

- Declare `"identity"` and an `"oauth2"` block with `client_id` + `scopes`.
- `getAuthToken({ interactive: true })` may prompt for Chrome sign-in / scope approval.
- **Do not** call interactive `getAuthToken` when the app is first launched; initiate from UI that explains what authorization is for.

Source: [chrome.identity](https://developer.chrome.com/docs/extensions/reference/api/identity)

### OAuth tutorial (MV3)

- Keep a **stable extension ID** via dashboard public key / `"key"` (and Chrome Extension OAuth client **Item ID** matching that ID).
- Register OAuth client type **Chrome Extension** with the item ID; put client id + scopes in manifest.

Source: [OAuth 2.0: authenticate users with Google](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)

**Constraint for Cortex:** Do **not** recommend changing OAuth item id or public key. Published id `happibddmmagkgneicjkndapcpmhdbfn` and unpacked id `fkhaacmaaaheapelljjcmfdmifmfbboa` must stay consistent with existing Google Cloud OAuth client binding.

### Drive scope (Google Drive API)

From Google Drive API scope guidance (developers.google.com):

- `https://www.googleapis.com/auth/drive.file` — create/modify files the app creates or that the user opens/shares with the app (per-file / narrow access). Prefer non-sensitive scopes over full `drive`.

Source: [Choose Google Drive API scopes](https://developers.google.com/drive/api/guides/api-specific-auth)

### MV3 remote-server allowance

MV3 policy still allows communicating with remote servers for purposes such as **“Syncing user account data with a remote server”**, provided extension **logic** remains in-package and Limited Use / Privacy Policy apply.

Source: [Additional Requirements for Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)

### Cortex implications

- **`drive.file` only** is the right least-privilege story: Cortex creates the `Cortex Memory` folder/file; it should not request full Drive.
- Interactive auth **only after Enable** matches Chrome Identity UX guidance and strengthens consent narrative.
- Destination is **the user's Drive**, not a Cortex backend—still “handles user data” (login + cloud write) and must be disclosed; Limited Use transfer rules treat necessary third-party transfer for the single purpose as allowed when disclosed.
- Affirmative Limited Use statement for Google APIs must appear on the project site / privacy policy (see §6).

---

## 5. Incognito behavior

### Docs text

- Manifest `"incognito"`: `"spanning"` (default), `"split"`, or `"not_allowed"`.
- Privacy guidance: do not persist browsing history from incognito windows; honor the “leave no tracks” promise. Settings may still be stored.

Sources: [Manifest — Incognito](https://developer.chrome.com/docs/extensions/reference/manifest/incognito), [Protect user privacy — Saving data and incognito](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)

### Cortex implications

- Current `"incognito": "not_allowed"` is a **strong privacy posture** for a browsing-activity indexer: private windows are never indexed or synced.
- Call this out in store privacy disclosures and reviewer justifications (reduces risk of silent private-session capture claims).
- If product ever changed to allow incognito, would need split/spanning analysis and explicit non-persistence of private browsing into the library/Drive—higher review risk.

---

## 6. Data use / privacy disclosures / Limited Use / remote code

### Privacy policy & disclosure

- If the Product handles any user data → accurate privacy policy in the **designated dashboard field**.
- Disclose collection, use, sharing, and parties shared with.
- **Prior to installation / collection:** prominent disclosure + affirmative informed consent; after install, **disclose data-practice changes**.

Sources: [Privacy Policies](https://developer.chrome.com/docs/webstore/program-policies/privacy), [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)

### Critical FAQ (local data still counts)

> Extensions must disclose how they handle user data **even when data is only processed or stored locally** and is not transmitted to external servers.

Prominent disclosure + consent must occur **in the Product UI**; store description alone does **not** satisfy the prominent-disclosure requirement.

Clipping/scraping page content and collecting web browsing activity are explicit “handle user data” examples.

Source: [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) (Q2–Q3, Q10, Q13–Q14)

### Limited Use

- Collect/use/transmit only data **necessary for the disclosed single purpose** (incl. related ops).
- **Web browsing activity** only to the extent required for a **user-facing feature** described prominently on the CWS page **and** in the Product UI.
- Restricted transfers; no sale for ads / brokers; humans reading user data restricted.
- Homepage / privacy policy must include an affirmative statement that use of information from Google APIs adheres to the CWS User Data Policy including Limited Use.

Source: [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

### 2026 policy updates (already past enforcement start for this research date)

Published 2026-07-01; **enforcement began 2026-08-01**:

- Limited Use tightened: data must be **strictly necessary** to the disclosed single purpose.
- Disclosure: **all** data collection prominently disclosed (even if related to single purpose); **proactively disclose** post-install practice changes.

Source: [CWS policy updates 2026](https://developer.chrome.com/blog/cws-policy-updates-2026)

### Remote code (MV3) — Blue Argon

- Full functionality must be discernible from submitted code; external resources **must not contain logic**.
- Violations: remote `<script>`, `eval` of remote strings, interpreters for remote “data” commands.
- Allowed examples include syncing account data, remote config **without** shipping logic, non-logic assets.
- Dashboard: declare remote code use honestly; MV3 cannot load/execute remotely hosted files. Bundled deps that fetch remote code still count.

Sources: [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), [Remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Troubleshooting — Blue Argon](https://developer.chrome.com/docs/webstore/troubleshooting), [cws-dashboard-privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

### Cortex implications

- **Local indexing is still “handling user data”** → privacy policy + dashboard certifications + **in-product** prominent disclosure/consent before indexing begins (first-run UX), not only a hosted privacy URL.
- Web browsing activity is the product’s core input → must be **prominently** described in listing *and* UI as the user-facing feature (search/Ask over what you read).
- Optional Drive sync: disclose folder name, `drive.file` limits, Enable gate, user ownership, deletion path; HTTPS to Google APIs satisfies secure transmission for that path.
- Optional Gemini: disclose that prompts leave the device to Google’s API under the user’s key/terms; not Cortex telemetry—still third-party transfer for Limited Use.
- No Cortex backend is a strength; still certify Limited Use and avoid claiming “no data handling.”
- Ensure packaged build has **no RHC** (scan compiled bundle for remote script loads / eval of fetched code). API JSON responses used as data are fine; executing them is not.
- Include Google APIs Limited Use compliance sentence on privacy/homepage.

---

## 7. What reviewers commonly reject (MV3-relevant)

From [Troubleshooting Chrome Web Store violations](https://developer.chrome.com/docs/webstore/troubleshooting) (last updated 2026-07-20 on fetch):

| ID | Theme | Why it matters for Cortex |
|----|--------|---------------------------|
| **Blue Argon** | Remotely hosted / executed code | Bundled ML/libs, build artifacts, any eval of remote strings |
| **Purple Potassium** | Excessive / unused permissions | Broad hosts, `history`, `tabs`, `scripting` need tight justifications |
| **Purple Lithium / Nickel / Copper / Magnesium** | Privacy policy, prominent disclosure, secure transmission, browsing-activity rules | Local index + optional Drive/Gemini |
| **Red Magnesium et al.** | Single purpose | Local memory vs Drive vs chat narrative |
| **Yellow Magnesium** | Functionality not working | Reviewer cannot complete Enable/sync or search flows |
| **Yellow Zinc** | Insufficient metadata | Screenshots/description must explain indexing consent & optional sync |
| **Red Titanium** | Obfuscation | Minify OK; conceal/packers not OK |
| **Red Nickel/Potassium/Silicon** | Deceptive metadata | “Private / no server” claims must match behavior (Drive/Gemini still leave device when enabled) |

Also relevant: review process emphasizes that broad host permissions and sensitive capabilities get closer scrutiny ([review process](https://developer.chrome.com/docs/webstore/review-process) — referenced via search; use troubleshooting + permissions docs as primary cites).

---

## 8. Synthesis — privacy-first + optional Drive sync model

| Design choice | Policy fit | Watch-outs |
|---------------|------------|------------|
| On-device library, no Cortex server | Aligns with Limited Use / privacy narrative | Local processing **must still be disclosed**; UI consent before indexing |
| `incognito: not_allowed` | Honors private browsing promise for an indexer | State clearly in privacy materials |
| Optional Assist Sync after **Enable** | Matches Identity “explain then interactive auth” + optional-feature consent | Keep sync off by default; no silent Drive writes |
| Scope **`drive.file` only** | Narrow / non-full-Drive; files app creates | Stay within app-created `Cortex Memory` tree; don’t creep scopes |
| User’s Drive as sync target | Allowed “sync user account data” style remote use under MV3 | Disclose Google as party; Limited Use Google APIs statement |
| Stable OAuth item id + manifest `key` | Required for Chrome Extension OAuth client | **Do not change** item id or public key |
| Broad `host_permissions` + content scripts | May be argued as necessary for “index what you read” | Highest rejection risk area; justifications + prominent browsing-activity disclosure mandatory; consider optional hosts only if UX still delivers core purpose |
| Optional Gemini via user API key | Third-party transfer; not Cortex telemetry | Disclose in UI before first send; dashboard data types must match |

---

## Cited URLs (Chrome / CWS / Drive)

All URLs below were used for this pass (developer.chrome.com, chromewebstore-related program policies, Drive scope doc):

1. https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines  
2. https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq  
3. https://developer.chrome.com/docs/webstore/program-policies  
4. https://developer.chrome.com/docs/webstore/troubleshooting  
5. https://developer.chrome.com/docs/webstore/cws-dashboard-privacy  
6. https://developer.chrome.com/docs/webstore/program-policies/permissions  
7. https://developer.chrome.com/docs/webstore/program-policies/limited-use  
8. https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements  
9. https://developer.chrome.com/docs/webstore/program-policies/privacy  
10. https://developer.chrome.com/docs/webstore/program-policies/user-data-faq  
11. https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements  
12. https://developer.chrome.com/blog/cws-policy-updates-2026  
13. https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions  
14. https://developer.chrome.com/docs/extensions/reference/api/permissions  
15. https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy  
16. https://developer.chrome.com/docs/extensions/reference/api/identity  
17. https://developer.chrome.com/docs/extensions/how-to/integrate/oauth  
18. https://developer.chrome.com/docs/extensions/reference/manifest/incognito  
19. https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code  
20. https://developers.google.com/drive/api/guides/api-specific-auth  

---

## Key store-review risks (checklist)

See final parent report bullets; mirrored here for the audit file:

1. **Broad install-time host + content-script access** framed as excessive (Purple Potassium) without airtight single-purpose + browsing-activity justification.  
2. **Missing in-product prominent disclosure/consent** before local indexing (FAQ: CWS description alone is insufficient).  
3. **Web browsing activity** not described prominently enough in listing *and* UI as the user-facing feature.  
4. **Single-purpose stretch**: local memory + Drive sync + Gemini chat read as unrelated purposes.  
5. **`history` permission** appears unused or continuous rather than user-triggered import.  
6. **Permission justifications** too generic for any of `tabs` / `scripting` / `offscreen` / `alarms` / `notifications` / `identity`.  
7. **Privacy policy / dashboard certifications** inconsistent with actual optional Drive or Gemini transfers.  
8. **Limited Use Google APIs affirmative statement** missing from homepage/privacy.  
9. **Interactive OAuth** without clear Enable UI context (or auth on startup).  
10. **Scope creep** beyond `drive.file` or writing outside app-created files.  
11. **Blue Argon**: remote script / eval / dependency RHC in packaged build.  
12. **“No data leaves device” marketing** that contradicts optional Drive/Gemini when enabled (deceptive metadata).  
13. **Post-install data-practice changes** (2026 disclosure rules) not surfaced in-product if sync/chat behavior changes.  
14. **Reviewer cannot exercise core flows** (Yellow Magnesium): first-run, search, Enable sync with test account.  
15. **Changing OAuth item id / manifest key** (explicitly out of scope) would break Chrome Extension OAuth client binding to published id `happibddmmagkgneicjkndapcpmhdbfn`.

---

*End of Pass 1 research notes. No src/, tests/, package.json, manifest, or eval files were modified.*
