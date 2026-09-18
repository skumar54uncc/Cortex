import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openOverlayViaToolbar } from "./fixtures";
import { clickInShadow, queryInShadow } from "./shadow";

/**
 * Phase 5.1: people memory end to end. linkedin.com is served by
 * context.route from a self-authored fixture; no real LinkedIn request.
 */
const PROFILE = readFileSync(join(__dirname, "..", "tests", "fixtures", "linkedin", "profile.html"), "utf8");

test("viewing a LinkedIn profile records the person; People tab lists it; Ask answers from people memory", async ({
  context,
  serviceWorker,
}) => {
  await context.route("https://www.linkedin.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PROFILE })
  );
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/in/mira-okafor-lind-12ab/");

  const person = await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const rows = await new Promise<{ name: string; company: string; profileUrl: string }[]>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("people")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("people", "readonly").objectStore("people").getAll();
          all.onsuccess = () => {
            resolve(all.result);
            db.close();
          };
        };
      });
      if (rows.length) return rows[0];
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  });
  expect(person).toMatchObject({
    name: "Mira Okafor-Lind",
    company: "Tidora",
    profileUrl: "https://www.linkedin.com/in/mira-okafor-lind-12ab/",
  });

  await openOverlayViaToolbar(page, serviceWorker);
  await clickInShadow(page, "cortex-tab", "People");
  await expect
    .poll(async () => (await queryInShadow(page, "cortex-person-name")).map((m) => m.text))
    .toContain("Mira Okafor-Lind");

  await clickInShadow(page, "cortex-tab", "Ask");
  await clickInShadow(page, "cortex-ask-input");
  await page.keyboard.type("who did I view from Tidora");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" "), {
      timeout: 20_000,
    })
    .toContain("Mira Okafor-Lind");
});

test("people memory off: profile pages do not create people rows and the People tab is hidden", async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, peopleMemoryEnabled: false } });
  });
  await context.route("https://www.linkedin.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PROFILE })
  );
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/in/mira-okafor-lind-12ab/");
  // Wait for the page itself to be indexed (proves the pipeline ran).
  await expect
    .poll(
      () =>
        serviceWorker.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("cortex-db");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("documents")) {
                  db.close();
                  resolve(0);
                  return;
                }
                const c = db.transaction("documents", "readonly").objectStore("documents").count();
                c.onsuccess = () => {
                  resolve(c.result);
                  db.close();
                };
              };
            })
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  const people = await serviceWorker.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const c = req.result.transaction("people", "readonly").objectStore("people").count();
          c.onsuccess = () => {
            resolve(c.result);
            req.result.close();
          };
        };
      })
  );
  expect(people).toBe(0);
  await openOverlayViaToolbar(page, serviceWorker);
  await page.waitForTimeout(300);
  expect((await queryInShadow(page, "cortex-tab")).map((m) => m.text)).not.toContain("People");
});
