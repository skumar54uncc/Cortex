import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, articleHtml, LOREM_PARAGRAPHS, EXTENSION_PATH } from "./fixtures";

/**
 * The overlay bundle is injected on demand: content.js (always on) must not
 * contain the overlay, and a toolbar click must still open the panel by
 * injecting overlay.js through chrome.scripting.executeScript.
 */
test("content.js carries no overlay UI; toolbar click injects overlay.js and opens the panel", async ({
  context,
  serviceWorker,
}) => {
  const contentJs = readFileSync(join(EXTENSION_PATH, "content.js"), "utf8");
  expect(contentJs).not.toContain("cortex-overlay-root");
  expect(contentJs).not.toContain(".cortex-hit");
  const overlayJs = readFileSync(join(EXTENSION_PATH, "overlay.js"), "utf8");
  expect(overlayJs).toContain("cortex-overlay-root");

  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Overlay injection page", LOREM_PARAGRAPHS),
    })
  );
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/overlay");
  await page.bringToFront();

  // Content script present but overlay not mounted yet.
  await expect.poll(() => page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")))).toBe(false);

  // Simulate the toolbar click inside the service worker.
  const dispatched = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return "no-active-tab";
    const ev = chrome.action.onClicked as unknown as { dispatch?: (t: chrome.tabs.Tab) => void };
    if (typeof ev.dispatch !== "function") return "no-dispatch";
    ev.dispatch(tab);
    return "ok";
  });
  expect(dispatched).toBe("ok");

  await expect
    .poll(() => page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")?.isConnected)), {
      timeout: 15_000,
    })
    .toBe(true);
});
