import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EXTENSION_PATH = resolve(__dirname, "..", "dist");

export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(join(EXTENSION_PATH, "manifest.json"))) {
      throw new Error("dist/manifest.json missing. Run `npm run build` before e2e.");
    }
    const userDataDir = mkdtempSync(join(tmpdir(), "cortex-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.CORTEX_E2E_HEADED ? false : true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split("/")[2]);
  },
});

export const expect = test.expect;

/** Minimal readable article so Readability + the 72 char floor accept it. */
export function articleHtml(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body><main><article><h1>${title}</h1>${body}</article></main></body></html>`;
}

export const LOREM_PARAGRAPHS: string[] = [
  "Cortex indexes the pages you read and keeps every byte on your own machine. The embedding model runs inside the browser using WebAssembly, so nothing is sent to a server.",
  "Retrieval combines a lexical BM25 score with cosine similarity over sentence embeddings. Recency and engagement signals nudge the ranking toward pages you actually spent time on.",
  "The service worker orchestrates indexing, the offscreen document hosts the model, and the content script only extracts text and relays messages. This split keeps the page footprint small.",
  "Enterprise deployments can pin settings through managed storage, set a retention window, and block domains centrally. Users see those fields as managed by their organization.",
  "This paragraph exists only to push the article past the minimum length that the indexer requires before it will bother creating a document and a set of chunks for the page.",
];
