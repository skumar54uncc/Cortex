import { test, expect, articleHtml, LOREM_PARAGRAPHS, openOverlayViaToolbar } from "./fixtures";
import { BrowserCdp, FAKE_NANO_SCRIPT, recordExtensionConsole, type ConsoleProblem } from "./cdp";
import { clickInShadow } from "./shadow";

/**
 * A sweep for the console, because an owner opening chrome://extensions
 * should find the Errors list empty. It watches every surface at once: the
 * pages, the extension's own pages (options, popup, side panel), the service
 * worker and the offscreen document, while a normal session runs through
 * indexing, search, Ask, Digest and People.
 *
 * Anything Chrome itself complains about counts, not only thrown errors:
 * that is how the Prompt API warning about a missing output language showed
 * up, logged against offscreen.html with no stack of ours.
 *
 * The same session also proves core value 1 for the surfaces a person
 * actually touches: nothing may leave the machine while the panel, the
 * digest and the options page are on screen. This is how the favicons
 * fetched from Google, one request per domain the user had read, were
 * found: embedding.spec only ever watched indexing, never the panel.
 */

/** Noise from the harness rather than from Cortex. */
function fromCortex(p: { text: string }): boolean {
  const text = p.text;
  if (/favicon\.ico/i.test(text)) return false;
  // Playwright's route interception aborts pending requests at teardown.
  if (/net::ERR_ABORTED|net::ERR_FAILED/i.test(text)) return false;
  return true;
}

test("the console stays clean through a full session", async ({ context, serviceWorker, extensionId, userDataDir }) => {
  const pageProblems: ConsoleProblem[] = [];
  context.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    // The URL matters: "Failed to load resource" alone never says what failed.
    pageProblems.push({
      source: new URL(msg.page()?.url() ?? "http://x/unknown").pathname,
      level: type,
      text: `${msg.text()} [${msg.location().url}]`,
    });
  });
  context.on("weberror", (err) => {
    pageProblems.push({
      source: err.page()?.url() ?? "unknown",
      level: "error",
      text: String(err.error().stack ?? err.error().message),
    });
  });

  const external: string[] = [];
  context.on("request", (req) => {
    const url = req.url();
    const local =
      url.startsWith("chrome-extension://") ||
      url.startsWith("http://cortex-e2e.test/") ||
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith("about:");
    if (!local) external.push(url);
  });

  const cdp = await BrowserCdp.connect(userDataDir);
  const extensionProblems = await recordExtensionConsole(cdp);

  try {
    await context.route("http://cortex-e2e.test/**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: articleHtml("The magnetometer report", LOREM_PARAGRAPHS),
      })
    );

    const page = await context.newPage();
    await page.goto("http://cortex-e2e.test/report");
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const req = indexedDB.open("cortex-db");
                req.onsuccess = () => {
                  const db = req.result;
                  if (!db.objectStoreNames.contains("documents")) return resolve(0);
                  const c = db.transaction("documents", "readonly").objectStore("documents").count();
                  c.onsuccess = () => {
                    resolve(c.result);
                    db.close();
                  };
                };
              })
          ),
        { timeout: 60_000 }
      )
      .toBeGreaterThan(0);

    const offscreen = await cdp.attachOffscreen();
    await cdp.evaluate(offscreen, FAKE_NANO_SCRIPT(["Everything is on the device [1]."]));

    await openOverlayViaToolbar(page, serviceWorker);
    await clickInShadow(page, "cortex-search-input");
    await page.keyboard.type("magnetometer");
    await page.waitForTimeout(1500);

    await clickInShadow(page, "cortex-tab", "Ask");
    await clickInShadow(page, "cortex-ask-input");
    await page.keyboard.type("what did the report say about the magnetometer?");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);

    // The request Chrome complained about: it must name its output language.
    const askOptions = await cdp.evaluate<string>(
      offscreen,
      `window.__cortexE2EPrompts?.[0]?.options ?? "null"`
    );
    expect(JSON.parse(askOptions ?? "null")).toMatchObject({
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      expectedInputs: [{ type: "text", languages: ["en"] }],
    });

    await clickInShadow(page, "cortex-tab", "Digest");
    await page.waitForTimeout(3000);

    await clickInShadow(page, "cortex-tab", "People & Companies");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");

    // The extension's own pages, which no one opens during the other specs.
    for (const path of ["options.html", "popup.html", "onboarding.html", "search-shell.html"]) {
      const extPage = await context.newPage();
      await extPage.goto(`chrome-extension://${extensionId}/${path}`).catch(() => undefined);
      await extPage.waitForTimeout(1500);
      await extPage.close();
    }
    await page.waitForTimeout(500);
  } finally {
    cdp.close();
  }

  expect(external, "nothing may leave the device").toEqual([]);

  const found = [...extensionProblems, ...pageProblems].filter(fromCortex);
  expect(found.map((p) => `${p.level} in ${p.source}: ${p.text}`)).toEqual([]);
});
