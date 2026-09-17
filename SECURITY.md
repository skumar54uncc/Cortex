# Security policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue for anything that could be exploited.

- Email: shailesh.entrant@gmail.com with the subject "Cortex security"
- Include: affected version (chrome://extensions shows it), steps to reproduce, and impact.

You will get an acknowledgement within 3 business days and a status update at least every 14 days until the issue is resolved. Coordinated disclosure is preferred: please allow 90 days before publishing details.

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | Yes       |
| 1.0.x   | Security fixes only until 1.2.0 ships on the Chrome Web Store, then no |
| < 1.0   | No        |

## Scope

Cortex is a Manifest V3 Chrome extension. Everything (indexing, embeddings, search, chat history) runs on the user's device. The only optional network call is to the Google Gemini API when the user turns cloud chat on and adds their own API key; it receives retrieved text snippets only.

In scope:

- Content script and overlay trust boundary (page scripts vs extension contexts)
- Message bus between content script, service worker, offscreen document, side panel and options
- IndexedDB and chrome.storage handling, retention and forget controls
- Managed policy enforcement
- Supply chain: dependencies in the shipped bundle (`npm audit --omit=dev` is a CI gate) and the CycloneDX SBOM published with each release

Out of scope:

- Vulnerabilities in Chrome itself or in Google Gemini
- Issues that need a compromised browser profile or OS account (see the threat model in docs/ENTERPRISE.md)

## Build integrity

Releases are built from a tagged commit with `npm ci && npm run build`. The SBOM for the shipped dependencies is generated in CI (`npm run sbom`) and attached to the release.
