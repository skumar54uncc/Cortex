# Chrome Web Store listing draft

Hosted pages, after GitHub Pages deploys the `docs` folder:

- Privacy policy: https://skumar54uncc.github.io/Cortex/privacy-policy.html
- Data deletion: https://skumar54uncc.github.io/Cortex/data-deletion.html

## Single purpose

Cortex builds a private, on-device memory of pages you read so you can search and ask about them later. Optional Assistant Sync copies that memory into one folder in your own Google Drive.

## Category

Productivity

## Title

Cortex: Private Memory for Everything You Read

## Short description

Ask anything you've read, watched or scanned. Pages, YouTube, tables and images, indexed on your device.

## Full description

Cortex indexes pages, YouTube transcripts, tables, and images on your device. You can search that library and ask questions about what you read. The index stays in this browser. Cortex has no server that stores your browsing.

Assistant Sync is optional and off until you press Enable. It copies page titles, URLs, excerpts of pages you read for 5 minutes or more, searches, LinkedIn profiles you opened, and topic labels into a folder named Cortex Memory in your Google Drive. You own that file. An assistant you connect to Drive can read the relevant rows when you ask it a question.

The Google permission is drive.file. Cortex can create and edit only the files it creates, not the rest of your Drive. Delete all indexed data, after you type DELETE, removes the local library and moves the Cortex Memory folder to the Drive trash.

## Permission justifications

- tabs and host access: read the page you are on so Cortex can index it, and show the in-page search panel.
- storage: keep settings on this device.
- history: optional import you start yourself. Cortex does not watch history in the background.
- scripting, offscreen, alarms: run the on-device model and maintenance. The 15 minute sync alarm runs only after you enable Assistant Sync.
- identity: Google sign-in when you press Enable. The sign-in popup opens from that click.
- https://www.googleapis.com/* (optional): requested on the same click. Used to create and update the Cortex Memory spreadsheet. Not granted until you allow it.
- drive.file (OAuth scope): create and edit only the Cortex Memory folder and spreadsheet. Not access to every file in Drive.
