import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, articleHtml, LOREM_PARAGRAPHS, EXTENSION_PATH, openOverlayViaToolbar } from "./fixtures";

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
  // No overlay markup, styles or rendering in the script that runs on every
  // page. It does look the panel's host element up by id, to tell whether the
  // panel is already open (the double Shift gesture), which is not UI.
  for (const uiMarker of [".cortex-hit", "cortex-shell", "cortex-panel", "cortex-tab", "attachShadow"]) {
    expect(contentJs, uiMarker).not.toContain(uiMarker);
  }
  const overlayJs = readFileSync(join(EXTENSION_PATH, "overlay.js"), "utf8");
  expect(overlayJs).toContain("cortex-overlay-root");
  expect(overlayJs).toContain("attachShadow");

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

  // Simulate the toolbar click inside the service worker (dispatched to this page's tab).
  await openOverlayViaToolbar(page, serviceWorker);
  expect(await page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")?.isConnected))).toBe(true);
});
