# Cortex 1.2.0: Chrome Web Store release pack

Package: `cortex-1.2.0.zip` (21,213,717 bytes, 51 files, `manifest.json` at the root, no source maps). Built from branch `release/1.2.0`. **Not uploaded.** Upload is the owner's step.

## Release notes (for the "What's new" field and the listing)

**Cortex 1.2.0: remember more than pages**

- **YouTube transcripts.** Videos you watch for 30 seconds or more are indexed from their captions. Answers link to the exact moment.
- **PDFs.** PDFs you open in Chrome are read on your device, page by page. Answers link to the page.
- **Tables.** Data tables are indexed row by row, so "what was the price of X" finds the right row.
- **Images.** Image captions and alt text are searchable. Optional on-device image descriptions (off by default) never leave your computer.
- **Highlights and notes.** Select text, right click, "Save to Cortex", and add a note.
- **Collections.** Group pages into collections and search or ask within one.
- **People.** Cortex remembers LinkedIn profiles you viewed, so you can ask "who did I look at from Acme".
- **Address bar search.** Type `cx` and a space in the address bar to search your library.
- **Seen this before.** An optional chip tells you when a page is close to one you already read (off by default).
- **Export and backup.** Export your library as Markdown notes, or back it up and restore it as a file.
- **Your data, your rules.** Forget a site, the last hour or the last day. Choose how long Cortex keeps pages. Organizations can manage Cortex with Chrome policies.
- **Faster and lighter.** The script that runs on every page is now 2.7 KB (was 103 KB). Better answers from smaller text passages, and Cortex says so when it has nothing relevant instead of guessing.

## Single purpose

Cortex is a private, on-device memory of what the user reads in Chrome: it indexes pages, videos, PDFs, tables and images the user views, and lets the user search and ask questions about them.

## Permission justifications

| Permission | Justification for the review form |
|------------|-----------------------------------|
| `host_permissions` `http://*/*`, `https://*/*` | Cortex indexes the pages the user reads on any site, so it needs to read page content on the sites the user visits. It also reads PDFs the user opens (the same URL as the tab) and, only if the user opts in during onboarding, fetches pages from their history to build the index. Sensitive sites (banking, health, email, login pages), incognito windows, user and admin blocklists are skipped before anything is read or stored. Nothing is sent to any server. |
| `tabs` | To know which tab the user clicked Cortex on (open the panel on web pages, the side panel on Chrome pages), to skip incognito tabs, and to detect PDF tabs. |
| `scripting` | To inject the Cortex panel only when the user opens it, and to inject the page reader only after the privacy checks pass for that tab. |
| `offscreen` | Runs the on-device language model (embeddings), search, and PDF reading in a hidden extension page, because a service worker cannot run long WebAssembly jobs. |
| `storage` | Saves the user's settings. Also reads enterprise policy set by an administrator (managed storage). |
| `alarms` | Daily maintenance: retention cleanup of old pages, storage housekeeping, and upgrading older library entries. |
| `history` | Optional: if the user turns it on during onboarding, Cortex builds the initial index from recent history. Never used otherwise. |
| `notifications` | One notification when the optional history import starts and finishes. |
| `sidePanel` | Shows Cortex on pages where the in-page panel cannot run, such as the New Tab page. |
| `contextMenus` | "Save to Cortex" for selected text (highlights and notes) and "Add page to collection". Removed when the user turns those features off. |
| `omnibox` keyword `cx` | Search the local library from the address bar. Suggestions come only from the user's own library. |

No remote code. All JavaScript and WebAssembly ship in the package; the model weights are bundled. Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'`.

## Privacy practices: what changed since 1.0.1

Everything below is stored only in the browser's local storage (IndexedDB) on the user's device, unless marked otherwise.

| Data | 1.0.1 | 1.2.0 |
|------|-------|-------|
| Web history (URLs, titles, visit times) | stored locally | unchanged; new retention setting and "forget" controls |
| Website content (page text) | stored locally | adds YouTube captions, table rows, image alt text and captions, PDF text, text the user highlights and their notes, LinkedIn profile name, headline and company for profiles the user views. All local. |
| Image pixels | not used | only if the user turns on image descriptions: up to 5 images per page, already loaded by the page, described by Chrome's built-in on-device model. Pixels are never stored and never sent anywhere. |
| Sent off the device | if the user turns on cloud chat with their own Gemini API key: the question and the retrieved text snippets go to Google's Gemini API | unchanged, same opt-in. Snippets may now come from captions, tables, PDFs and image text. Never images, PDF files or whole pages; on-device image descriptions are removed before any cloud request. |
| Exported files | none | the user can save a Markdown export or a JSON backup to their own disk. Backups never contain settings or the Gemini key. |
| Site icons in the panel | fetched from Google's favicon service, one request per domain the user had read | drawn on the device from the host name. No request leaves the machine. |
| Analytics, telemetry, ads, sale or transfer of data | none | none |

### Privacy practices form: the answers to submit

Fill the "Privacy practices" tab exactly like this.

**Single purpose**: Cortex is a private, on-device memory of what the user reads in Chrome. It indexes pages, videos, PDFs, tables and images the user opens, and lets the user search and ask questions about them.

**Data types collected** (tick these three, leave every other box clear):

| Type | Tick | Why |
|------|------|-----|
| Web history | yes | Cortex stores the URLs, titles and visit times of pages the user reads, so it can search them. |
| Website content | yes | Page text, YouTube captions, table rows, PDF text, image alt text, and text the user highlights. |
| Personally identifiable information | yes | People memory stores the name, headline, company, location and role history of LinkedIn profiles the user opens. It stays on the device, and the feature can be turned off in settings. |

Leave unticked: health information, financial and payment information, authentication information, personal communications, location, user activity (no clicks, keystrokes or analytics are recorded), website content of other users.

**Certifications** (all three can be certified):
- Data is not being sold to third parties, and is not transferred for purposes unrelated to the item's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending purposes.
- The item's use of the data is limited to the single purpose above.

**Remote code**: no. Every script and the WebAssembly runtime ship inside the package; the model weights are bundled. Content Security Policy is `script-src 'self' 'wasm-unsafe-eval'`.

**Data transmission**: nothing is sent anywhere by default. The one exception is optional cloud chat: if the user turns it on and adds their own Google Gemini API key, the question and the retrieved text snippets go to Google's Gemini API under that key. Never whole pages, never PDFs or images, and on-device image descriptions are removed before the request. Describe this in the justification box for "Website content".

**Privacy policy URL**: the listing needs a public privacy policy page that matches the answers above (the repo has one in the extension's privacy page; publish it at a stable URL and paste that link).

## Listing copy

**Name:** Cortex: Private Memory for Everything You Read

**Short description (manifest, 104 characters):** Ask anything you've read, watched or scanned. Pages, YouTube, tables and images, indexed on your device.

**Detailed description:**

Cortex is a private memory for your browser. It quietly indexes what you read, watch and open, and lets you search it or ask questions in plain language. Indexing, search and the language model all run on your device. There is no Cortex server, no account and no tracking.

What Cortex remembers:
- Articles and pages you read
- YouTube videos you watch (from their captions), with links to the exact moment
- PDFs you open, with links to the right page
- Data tables, row by row
- Image captions and alt text
- Your highlights and notes
- LinkedIn profiles you viewed

What you can do:
- Search your library from the Cortex panel, the side panel, or the address bar (type cx and a space)
- Ask questions and get answers with citations you can click
- Group pages into collections and search inside one
- Get a daily or weekly digest of what you read
- Export your notes as Markdown, or back up and restore your library

Privacy by design:
- Everything is stored on your computer
- Sensitive sites like banking, health and email are skipped automatically
- Incognito windows are never indexed
- Pause indexing, block any site, forget a site or the last hour at any time
- Choose how long pages are kept
- Optional cloud chat uses your own Gemini API key and sends only short text snippets, never whole pages, PDFs or images

For organizations: administrators can manage Cortex with Chrome policies (block domains, allow listed domains only, set retention, turn off cloud chat, turn off indexing).

**Category:** Productivity. **Language:** English.

## Screenshots to capture (1280x800, PNG)

Capture from the unpacked 1.2.0 build in a clean profile with a small demo library (10 to 20 pages, one YouTube video, one PDF, one table page). Light theme unless noted. No real personal data on screen.

1. **Ask with citations.** A news or science article in the background, the Cortex panel open on Ask, a question such as "What did the glacier survey find?" with a three sentence answer and two citation cards: one article, one "Video at 12:40".
2. **Search across kinds.** Search tab with the query "fluxgate calibration", results showing an article, a "PDF page 4" hit and a "Table rows 13 to 24" hit.
3. **YouTube moment.** A YouTube watch page with the panel open; a citation card "Video at 3:05" hovered, showing it opens the video at that moment.
4. **Highlights and collections.** Selected text with the right click menu open on "Save to Cortex", and the scope bar set to a collection such as "Thesis research".
5. **Privacy controls (dark theme).** Options page: Privacy section with retention, blocklist and "Forget" controls, and the Export and backup section visible.

Caption each shot with one short line, for example "Answers from what you read, with sources." No em dashes in captions.

## Demo video script (45 seconds)

| Time | Picture | Voice over |
|------|---------|-----------|
| 0 to 5 s | Browser with many tabs, cursor closing them one by one. | "You read a lot. You remember very little of it." |
| 5 to 12 s | Scrolling a science article, then a YouTube talk playing, then a PDF open. | "Cortex remembers for you: pages, videos, PDFs and tables, right on your computer." |
| 12 to 22 s | Press Ctrl+Shift+K, type "what did the survey find about drift", the answer streams in with citations. | "Ask in your own words. Answers come with sources you can click." |
| 22 to 28 s | Click a "Video at 12:40" citation; YouTube opens at 12:40. Then a "PDF page 4" citation opens the PDF on page 4. | "Jump to the exact moment in a video, or the right page in a PDF." |
| 28 to 36 s | Select a sentence, right click, Save to Cortex, type a short note. Type "cx glacier" in the address bar and pick a suggestion. | "Save highlights with notes. Search from the address bar." |
| 36 to 43 s | Options page: pause, forget last hour, blocklist; a small lock icon and "Stays on your device". | "No account, no server, no tracking. Sensitive sites are skipped, and you can forget anything." |
| 43 to 45 s | Cortex logo and name. | "Cortex. Private memory for everything you read." |

## Before upload (owner checklist)

- Choose and add a LICENSE (open question from Phase 1).
- Decide on the PII declaration above.
- Capture the 5 screenshots and record the video from the script.
- Upload `cortex-1.2.0.zip`, paste the release notes and justifications above, submit for review.
