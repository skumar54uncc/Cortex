# Cortex for organizations

Cortex 1.2.0 can be configured centrally through Chrome's extension policy (managed storage). Everything still runs on the user's device: there is no Cortex server, no admin console of our own, and no telemetry. Policy values reach the browser through the normal Chrome management channels (Google Admin console, Windows Group Policy / registry, macOS configuration profiles, Linux policy files).

## Policies

Declared in `managed_schema.json` at the root of the extension package. Managed values override the user's settings. In Cortex settings the affected controls are disabled and labelled "Managed by your organization", and a banner explains that some settings are managed. The user's own stored values are never overwritten, so removing a policy restores what they had chosen.

| Key | Type | Effect |
|-----|------|--------|
| `geminiAllowed` | boolean | `false`: cloud chat is forced off, the Gemini API key is never read or sent, "Cloud only" mode falls back to "On-device only". `true` or absent: users may opt in themselves. |
| `blockedDomains` | array of strings | Hostnames (and their subdomains) that are never indexed. Added to the user's own blocklist; users cannot remove them. |
| `allowedDomainsOnly` | array of strings | When non-empty, Cortex indexes only these hostnames and their subdomains. |
| `retentionDays` | integer, minimum 1 | Pages, chunks, visits and chats older than this are deleted once a day (and shortly after browser start). |
| `indexingDisabled` | boolean | `true`: nothing new is indexed, including history import. Search over existing data still works. |
| `imageDescriptionsAllowed` | boolean | `false`: on-device image descriptions (optional 1.2.0 feature) are never generated. |

Enforcement lives in the extension's service worker (indexing gate, chat routing, retention alarm), not only in the settings UI. Unit tests: `tests/managed-policy.test.ts`, `tests/options-managed-ui.test.ts`.

Sensitive-site skips, incognito exclusion and the Chrome Web Store / bank / health heuristics apply regardless of policy.

### Google Admin console

Devices > Chrome > Apps & extensions > Users & browsers > select Cortex > **Policy for extensions**, then paste:

```json
{
  "geminiAllowed": { "Value": false },
  "blockedDomains": { "Value": ["hr.example.com", "payroll.example.com", "mail.example.com"] },
  "allowedDomainsOnly": { "Value": [] },
  "retentionDays": { "Value": 30 },
  "indexingDisabled": { "Value": false },
  "imageDescriptionsAllowed": { "Value": false }
}
```

Leave a key out entirely to let users decide. An empty `allowedDomainsOnly` list is ignored.

### Windows (Group Policy or registry)

```
HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy
  geminiAllowed          REG_DWORD  0
  retentionDays          REG_DWORD  30
  indexingDisabled       REG_DWORD  0
  blockedDomains         REG_SZ     ["hr.example.com","payroll.example.com"]
```

List values are JSON strings. `<extension-id>` is the Chrome Web Store ID once published (unpacked development builds get a path-dependent ID).

### Linux

`/etc/opt/chrome/policies/managed/cortex.json`:

```json
{
  "3rdparty": {
    "extensions": {
      "<extension-id>": {
        "geminiAllowed": false,
        "retentionDays": 30,
        "blockedDomains": ["hr.example.com"]
      }
    }
  }
}
```

### Verifying a policy

Open `chrome://policy`, find the Cortex extension section, and check the values show as OK. Then open Cortex settings: managed controls are disabled with the "Managed by your organization" label.

## Data controls available to every user

- **Retention**: Settings > Privacy > "Keep indexed pages for" (Forever, 7, 30, 90, 180 days, 1 year). Locked when `retentionDays` is managed.
- **Forget**: Settings > Data, and the trash menu in the Cortex panel header: forget this site (the current tab's site, including subdomains), forget last hour, forget last day, forget all. Forgetting covers every IndexedDB store, including chats: answers that cite a forgotten site are deleted (the user's question stays), and chat messages written in a forgotten time window are deleted. The digest cache and the popup statistics snapshot are refreshed.
- A page can never trigger a forget for another site: from the in-page panel, "this site" is always taken from the tab the request came from (`src/lib/forget-request.ts`).
- **Export and backup** (1.2.0): Settings > Data. "Export notes (Markdown)" saves a zip with one note per page; "Download backup (JSON)" saves the library without embeddings and without settings (the Gemini key is never included). Only the options page can request an export; the in-page panel and other extension pages are refused. The file is created on the device and saved where the user chooses.
- **Restore**: validated row by row, then merged (default) or, after an explicit choice, replacing the library. Every restored page URL passes the same gate as a live visit (managed blocklist, allowlist, sensitive hosts); pages that fail are left out and counted. Restore is refused while `indexingDisabled` is set. Retention applies right after a restore. There is currently no policy to disable export; see "Open questions" in the release report.

## Encryption at rest: threat model (not implemented)

This section exists to support a decision. **Nothing below is implemented in 1.2.0.** Implementation needs explicit approval from the owner after reading it.

### What is stored

IndexedDB database `cortex-db` in the Chrome profile directory: page titles, URLs, extracted page text (as chunks), 384-dimension embeddings, visit timestamps, chat questions and answers. Settings (including an optional Gemini API key) live in `chrome.storage.local` in the same profile.

### What Chrome already protects

Chrome does not encrypt IndexedDB. It encrypts cookies and saved passwords with an OS-bound key (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Extensions have no API to that OS-bound key.

### What extension-level encryption could do

The only key an extension can keep is one it stores itself: a non-extractable WebCrypto `CryptoKey` in IndexedDB, or key material in `chrome.storage`. Both live in the same profile directory as the data.

| Attacker | Gets | Protected by extension-side encryption? |
|----------|------|------------------------------------------|
| Copies only the `IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb` folder (for example from a backup that includes it) | Ciphertext without the key | **Yes**, if the key is kept in a different store. This is the only case it helps. |
| Copies the whole Chrome profile | Ciphertext and the key | No. Loading the profile in another Chrome gives Cortex the key again. Non-extractable does not help because the attacker does not need to extract it. |
| Stolen or lost laptop, disk not encrypted | Whole profile | No, same as above. Full-disk encryption (BitLocker, FileVault, LUKS) is the control that helps. |
| Malware running as the user | Live browser, memory, profile | No. |
| Another extension or a web page | Nothing: IndexedDB is origin-isolated to the extension | Already protected by the browser. |
| Someone with the user's unlocked session | Opens Cortex and searches | No. |

A user passphrase (key derived with PBKDF2 or Argon2, never stored) would protect against profile copies, at the cost of typing a passphrase each browser session, losing all data if it is forgotten, and background indexing being impossible while locked.

### Costs

- Search is a linear scan over all chunks and embeddings. Encrypting them means decrypting the whole library for every query, or keeping it decrypted in memory for the session (which gives back most of the protection).
- The eval harness and upgrade path would need a key; a migration would have to rewrite every row once.
- More code in the trust boundary (key handling, migration, lock state), and the risk of permanent data loss on key loss.

### Recommendation

Do not implement profile-bound encryption in 1.2.0: it only protects against copying the IndexedDB folder alone, which is a narrow case. For organizations, the effective controls are full-disk encryption on managed devices, `retentionDays`, `blockedDomains` / `allowedDomainsOnly`, and `geminiAllowed: false`. If the owner wants protection against profile copies, the honest option is an opt-in passphrase lock, planned as its own release with its own threat review.

**Owner decision needed:** approve, reject, or ask for the passphrase design.
