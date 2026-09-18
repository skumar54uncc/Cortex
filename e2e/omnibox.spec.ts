import { test, expect, articleHtml } from "./fixtures";

/**
 * Phase 5.2: "cx <query>" suggestions come from the local library and Enter
 * opens the best hit. Omnibox events are dispatched inside the service worker.
 */
test("omnibox suggests indexed pages and opens the best hit", async ({ context, serviceWorker }) => {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Glacier drone <b>photogrammetry</b> & melt gauges", [
        "Glacier drones fly photogrammetry passes over the ice every morning when the weather hold lifts.",
        "Melt gauges are read by the base camp uplink and compared with the crevasse map each evening.",
        "Battery swaps happen at the base camp between passes so the drones can stay in the air longer.",
        "This paragraph adds enough readable text for the indexer to accept the page on device.",
      ]),
    })
  );
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/glacier");

  const suggestions = await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const got = await new Promise<chrome.omnibox.SuggestResult[]>((resolve) => {
        const ev = chrome.omnibox.onInputChanged as unknown as {
          dispatch: (t: string, cb: (s: chrome.omnibox.SuggestResult[]) => void) => void;
        };
        ev.dispatch("glacier photogrammetry", (s) => resolve(s));
        setTimeout(() => resolve([]), 5000);
      });
      if (got.length) return got;
      await new Promise((r) => setTimeout(r, 500));
    }
    return [];
  });
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions[0].content).toBe("http://cortex-e2e.test/glacier");
  expect(suggestions[0].description).toContain("<match>photogrammetry</match>");
  expect(suggestions[0].description).toContain("&lt;b&gt;");
  expect(suggestions[0].description).toContain("&amp;");

  const before = await serviceWorker.evaluate(async () => (await chrome.tabs.query({})).length);
  await serviceWorker.evaluate(() => {
    const ev = chrome.omnibox.onInputEntered as unknown as { dispatch: (t: string, d: string) => void };
    ev.dispatch("glacier photogrammetry", "newForegroundTab");
  });
  // A new tab was opened on the best hit (the fake host may not resolve in a
  // tab Playwright did not create, so the tab's target URL is checked).
  // The original page plus the newly opened one: two tabs on that URL.
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () =>
          (await chrome.tabs.query({})).filter(
            (t) => (t.pendingUrl || t.url || "") === "http://cortex-e2e.test/glacier"
          ).length
      )
    )
    .toBe(2);
  expect(await serviceWorker.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(before + 1);
});
