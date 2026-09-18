import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EXTENSION_PATH = resolve(__dirname, "..", "dist");
/** Open-shadow build for axe audits (npm run build:e2e). */
export const EXTENSION_PATH_E2E_AUDIT = resolve(__dirname, "..", "dist-e2e");

export interface ExtensionFixtures {
  extensionPath: string;
  userDataDir: string;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  extensionPath: [EXTENSION_PATH, { option: true }],
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    await use(mkdtempSync(join(tmpdir(), "cortex-e2e-")));
  },
  context: async ({ extensionPath, userDataDir }, use) => {
    if (!existsSync(join(extensionPath, "manifest.json"))) {
      throw new Error(`${extensionPath}/manifest.json missing. Run the build before e2e.`);
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.CORTEX_E2E_HEADED ? false : true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // Lets e2e/cdp.ts reach the offscreen document, which Playwright does not expose.
        "--remote-debugging-port=0",
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

/** Simulate a toolbar click inside the service worker and wait for the overlay root. */
export async function openOverlayViaToolbar(
  page: import("@playwright/test").Page,
  serviceWorker: Worker
): Promise<void> {
  await page.bringToFront();
  // Dispatch to this page's own tab, found by URL. "The active tab" is not
  // reliable here: on a fresh profile the onboarding tab (an extension page,
  // so its URL reads as "") can still be the last focused one, and a click
  // dispatched to it never opens the overlay on the test page.
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    const dispatched = await serviceWorker.evaluate(async (url) => {
      const matches = (await chrome.tabs.query({})).filter((t) => t.url === url);
      const tab = matches.find((t) => t.active) ?? matches[matches.length - 1];
      if (!tab) return "no-tab-for-page";
      const ev = chrome.action.onClicked as unknown as { dispatch?: (t: chrome.tabs.Tab) => void };
      if (typeof ev.dispatch !== "function") return "no-dispatch";
      ev.dispatch(tab);
      return "ok";
    }, page.url());
    if (dispatched === "no-dispatch") throw new Error("toolbar dispatch failed: no-dispatch");
    if (dispatched !== "ok") {
      await page.waitForTimeout(250);
      continue;
    }
    opened = await page
      .waitForFunction(
        () => Boolean(document.getElementById("cortex-overlay-root")?.isConnected),
        undefined,
        { timeout: 5_000 }
      )
      .then(() => true)
      .catch(() => false);
  }
  if (!opened) throw new Error("overlay did not open after 3 toolbar dispatches");
  // Let the open transition settle.
  await page.waitForTimeout(350);
}

export async function routeArticle(context: BrowserContext, title = "Cortex E2E page"): Promise<void> {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml(title, LOREM_PARAGRAPHS),
    })
  );
}
