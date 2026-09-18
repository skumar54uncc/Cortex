import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, articleHtml, LOREM_PARAGRAPHS } from "./fixtures";

/**
 * Phase 5.5: "Seen this before" chip. Off by default; when on, a page very
 * similar to an earlier one shows one chip, and not again the same day.
 */
async function routePair(context: BrowserContext): Promise<void> {
  await context.route("http://first.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml("Local memory notes, first read", LOREM_PARAGRAPHS) })
  );
  await context.route("http://second.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml("Local memory notes, reprint", LOREM_PARAGRAPHS) })
  );
}

const chipShown = (p: Page) => p.evaluate(() => Boolean(document.getElementById("cortex-resurface-root")));

async function waitIndexed(context: BrowserContext, page: Page): Promise<void> {
  // Give indexing and embedding time; the chip decision happens after embeddings.
  await page.waitForTimeout(6000);
  void context;
}

test("off by default: no chip even for a near-duplicate page", async ({ context }) => {
  await routePair(context);
  const a = await context.newPage();
  await a.goto("http://first.test/a");
  await waitIndexed(context, a);
  const b = await context.newPage();
  await b.goto("http://second.test/b");
  await waitIndexed(context, b);
  expect(await chipShown(b)).toBe(false);
});

test("on: a near-duplicate page shows one chip linking to the earlier page, once per day", async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, resurfacingEnabled: true } });
  });
  await routePair(context);
  const a = await context.newPage();
  await a.goto("http://first.test/a");
  await waitIndexed(context, a);
  expect(await chipShown(a)).toBe(false); // nothing earlier to point at

  const b = await context.newPage();
  await b.goto("http://second.test/b");
  await expect.poll(() => chipShown(b), { timeout: 40_000 }).toBe(true);
  // Closed shadow root: the page sees only the host element.
  expect(await b.evaluate(() => document.getElementById("cortex-resurface-root")?.shadowRoot ?? "closed")).toBe("closed");

  const shown = await serviceWorker.evaluate(async () => (await chrome.storage.local.get("cortex_resurface_shown")).cortex_resurface_shown);
  expect(Object.keys(shown as object)).toEqual(["http://second.test/b"]);

  await b.reload();
  await waitIndexed(context, b);
  expect(await chipShown(b)).toBe(false);
});
