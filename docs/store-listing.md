# Chrome Web Store listing draft

Hosted pages, after GitHub Pages deploys the `docs` folder:

- Privacy policy: https://skumar54uncc.github.io/Cortex/privacy-policy.html
- Data deletion: https://skumar54uncc.github.io/Cortex/data-deletion.html

Canonical release-pack answers (permissions form, privacy practices tab, detailed listing) live in `docs/release-1.2.0/STORE_RELEASE.md`. Keep this draft aligned with that file; do not invent a second privacy story.

## Single purpose

Cortex is a private, on-device memory of what the user reads in Chrome: it indexes pages, videos, PDFs, tables and images the user views (after in-product consent), and lets the user search and ask questions about them. Optional Assistant Sync copies that same memory into the user's own Google Drive folder named Cortex Memory. Optional Cloud Chat answers from retrieved snippets via the user's Gemini API key. Sync and Cloud Chat are features of the same private memory, not separate products.

## Category

Productivity

## Title

Cortex: Private Memory for Everything You Read

## Short description

Ask anything you've read, watched or scanned. Pages, YouTube, tables and images, indexed on your device.

## Full description

Cortex is a private memory for your browser. After you agree on the welcome page, it indexes what you read, watch and open, and lets you search it or ask questions in plain language. Indexing, search and the language model all run on your device. There is no Cortex server, no account and no tracking.

Optional Assistant Sync copies that same memory into a folder named Cortex Memory in your own Google Drive, only after you press Enable. The Google permission is drive.file (files Cortex creates, not your whole Drive). Optional Cloud Chat uses your own Gemini API key and sends only short text snippets, never whole pages, PDFs or images. Assist Sync and Cloud Chat are features of the same private memory.

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
- Optionally connect an assistant to your Drive copy of the same memory

Privacy by design:
- Index storage stays on your computer unless you enable Assist Sync or Cloud Chat
- You must agree in the product UI before indexing or history import begins
- Sensitive sites like banking, health and email are skipped automatically
- Incognito windows are never indexed (`incognito: not_allowed`)
- Delete all indexed data, after you type DELETE, removes the local library and moves the Cortex Memory folder to the Drive trash

## Permission justifications

Use the review-form table in `docs/release-1.2.0/STORE_RELEASE.md` as the source of truth. Short form for listing drafts:

- tabs and host access: index pages the user reads on any site (single purpose), show the in-page panel, read PDFs the user opens, and after Enable update only the app-created Cortex Memory file (`drive.file`). Sensitive sites, Incognito, and blocklists are skipped.
- storage: keep settings on this device; also reads enterprise managed storage.
- history: optional import after Start indexing on the welcome page, or Scan history in Settings. Not continuous background watching.
- scripting, offscreen, alarms: run the on-device model and maintenance; Assist Sync work runs only while sync is enabled (handlers no-op when off).
- identity: Google sign-in when the user presses Enable. Interactive auth only from that click; later Sync now and the alarm use a silent token. OAuth scope is drive.file only.
- drive.file (OAuth scope): create and edit only the Cortex Memory folder and spreadsheet. Not access to every file in Drive.
- notifications: optional notice when a consented history scan starts and finishes.
- sidePanel, contextMenus, omnibox: panel on Chrome pages; Save to Cortex / collections; address-bar search with keyword `cx`.
