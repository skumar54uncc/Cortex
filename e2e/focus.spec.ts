import { test, expect, openOverlayViaToolbar, routeArticle } from "./fixtures";

/**
 * Phase 2.5 keyboard-only behaviour: focus lands in the search input once
 * the overlay opens, Tab stays inside the dialog, Escape closes it and
 * focus returns to the element that had it before.
 */
test("Escape closes the overlay and focus returns to the previous element", async ({
  context,
  serviceWorker,
}) => {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><title>Focus page</title></head><body>
        <main><article><h1>Focus page</h1>
        <p>${"Readable text about focus management in overlays. ".repeat(12)}</p>
        <input id="page-input" placeholder="page input" />
        </article></main></body></html>`,
    })
  );
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/focus");
  await page.focus("#page-input");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("page-input");

  await openOverlayViaToolbar(page, serviceWorker);
  // Focus moved into the overlay host (closed shadow root reports the host).
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("cortex-overlay-root");

  // Typing goes to the search input inside the overlay, not the page input.
  await page.keyboard.type("abc");
  expect(await page.evaluate(() => (document.getElementById("page-input") as HTMLInputElement).value)).toBe("");

  // Tab several times: focus must stay inside the overlay.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("cortex-overlay-root");
  }

  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root"))))
    .toBe(false);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("page-input");
});
