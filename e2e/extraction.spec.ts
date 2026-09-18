import type { Worker } from "@playwright/test";
import { test, expect, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

/**
 * Phase 5 task 0.2: extract.js is injected only after the service worker's
 * privacy gate allows indexing. A blocklisted page never runs the extractor.
 */
async function extractorLoaded(sw: Worker, urlPart: string): Promise<boolean | null> {
  return sw.evaluate(async (part) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url?.includes(part));
    if (tab?.id == null) return null;
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Boolean((window as unknown as { __cortexExtractLoaded?: boolean }).__cortexExtractLoaded),
    });
    return Boolean(res?.result);
  }, urlPart);
}

async function docCount(sw: Worker, host: string): Promise<number> {
  return sw.evaluate(
    (h) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            resolve(0);
            return;
          }
          const all = db.transaction("documents", "readonly").objectStore("documents").getAll();
          all.onsuccess = () => {
            resolve((all.result as { domain: string }[]).filter((d) => d.domain === h).length);
            db.close();
          };
        };
      }),
    host
  );
}

test("blocklisted page: no extractor injected, nothing stored; allowed page: extracted and stored", async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, blocklist: ["blocked.test"] } });
  });
  for (const host of ["blocked.test", "allowed.test"]) {
    await context.route(`http://${host}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: articleHtml(`Page on ${host}`, LOREM_PARAGRAPHS),
      })
    );
  }

  const blocked = await context.newPage();
  await blocked.goto("http://blocked.test/secret");
  const allowed = await context.newPage();
  await allowed.goto("http://allowed.test/article");

  await expect.poll(() => docCount(serviceWorker, "allowed.test"), { timeout: 30_000 }).toBe(1);
  expect(await extractorLoaded(serviceWorker, "allowed.test")).toBe(true);

  // The blocked tab had the same time (and more) to request indexing.
  await blocked.waitForTimeout(3000);
  expect(await extractorLoaded(serviceWorker, "blocked.test")).toBe(false);
  expect(await docCount(serviceWorker, "blocked.test")).toBe(0);
});
