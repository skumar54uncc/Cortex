import { test, expect, articleHtml, openOverlayViaToolbar, EXTENSION_PATH_E2E_AUDIT } from "./fixtures";
import { clickInShadow, queryInShadow } from "./shadow";

/**
 * "What did I see today" is answered from the visit record, not by searching
 * passages, and needs no model. Before this, the model answered "I don't have
 * anything in your library" while twenty sources sat underneath it.
 */
test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

test("what did I see today: answered site by site, with the pages named", async ({ context, serviceWorker }) => {
  await context.route("http://cortex-e2e.test/**", (r) => {
    const slug = new URL(r.request().url()).pathname.slice(1);
    return r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml(`The ${slug} report`, [
        `The ${slug} survey team recorded unusual readings near the northern ridge during the long winter night.`,
        `Analysts compared the ${slug} data against three earlier seasons and found a drift nobody had explained.`,
        `A second visit to the ${slug} site is planned for spring with new instruments and a larger crew.`,
      ]),
    });
  });

  for (const slug of ["amberline", "borealix", "cindervale"]) {
    const p = await context.newPage();
    await p.goto(`http://cortex-e2e.test/${slug}`);
    await p.waitForTimeout(2500);
    await p.close();
  }

  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/amberline");
  await expect
    .poll(
      async () =>
        serviceWorker.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("cortex-db");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("documents")) return resolve(0);
                const all = db.transaction("documents", "readonly").objectStore("documents").getAll();
                all.onsuccess = () => {
                  resolve(all.result.length);
                  db.close();
                };
              };
            })
        ),
      { timeout: 60_000 }
    )
    .toBeGreaterThanOrEqual(3);

  await openOverlayViaToolbar(page, serviceWorker);
  await clickInShadow(page, "cortex-tab", "Ask");
  await clickInShadow(page, "cortex-ask-input");
  await page.keyboard.type("what did I see on cortex-e2e.test today?");
  await page.keyboard.press("Enter");

  // The answer names the site and the pages, as bullets, with no model involved.
  await expect
    .poll(async () => (await queryInShadow(page, "cortex-md-item")).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const answer = (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" ");
  expect(answer).toContain("cortex-e2e.test");
  expect(answer).toContain("amberline");
  expect(answer).not.toContain("I don't have anything in your library");
});
