import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openOverlayViaToolbar, EXTENSION_PATH_E2E_AUDIT } from "./fixtures";
import { clickInShadow } from "./shadow";

/**
 * The People list was cut off at the panel edge with no way to reach the rest.
 * Measured: the tab's container reported clientHeight 3963 inside a body of
 * 565 (a flex item's automatic minimum size is its content), so the cards ran
 * past the bottom of the panel and no element was scrollable. Note that
 * setting scrollTop works even on overflow:hidden, so this test scrolls with
 * the wheel, the way a person does.
 *
 * The open-shadow build, so the test can measure the panel from the page. The
 * shipped build differs only in the shadow root mode.
 */
test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

const PROFILE = readFileSync(join(__dirname, "..", "tests", "fixtures", "linkedin", "profile.html"), "utf8");

interface Measured {
  cards: number;
  /** Content that escaped the panel body, which nothing can scroll back. */
  bodyOverflow: number;
  /** A container a person can actually scroll (overflow auto or scroll). */
  userScrollable: boolean;
  /** Width the scrollbar takes in layout, next to what this browser gives
   * an ordinary scrolling box: headless Chromium draws overlay scrollbars,
   * which take no space at all, so the two are only compared. */
  scrollbarWidth: number;
  browserScrollbarWidth: number;
  /** "none" here would mean a page had hidden the panel's scrollbar. */
  scrollbarSetting: string;
  lastCardBottom: number;
  bodyBottom: number;
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const root = document.getElementById("cortex-overlay-root")?.shadowRoot;
    const body = root?.querySelector<HTMLElement>(".cortex-body");
    if (!body) {
      return {
        cards: -1,
        bodyOverflow: -1,
        userScrollable: false,
        scrollbarWidth: 0,
        browserScrollbarWidth: 0,
        scrollbarSetting: "none",
        lastCardBottom: 0,
        bodyBottom: 0,
      };
    }
    const cards = Array.from(root!.querySelectorAll<HTMLElement>(".cortex-person"));
    const scrollable = Array.from(body.querySelectorAll<HTMLElement>("*")).filter((el) => {
      const overflowY = getComputedStyle(el).overflowY;
      return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4;
    });
    // What an ordinary scrolling box gets in this browser, for comparison.
    const probe = document.createElement("div");
    probe.style.cssText = "width:200px;height:100px;overflow-y:scroll;position:fixed;left:-999px";
    document.body.appendChild(probe);
    const browserScrollbarWidth = probe.offsetWidth - probe.clientWidth;
    probe.remove();

    const last = cards[cards.length - 1]?.getBoundingClientRect();
    return {
      cards: cards.length,
      bodyOverflow: body.scrollHeight - body.clientHeight,
      userScrollable: scrollable.length > 0,
      scrollbarWidth: scrollable[0] ? scrollable[0].offsetWidth - scrollable[0].clientWidth : 0,
      browserScrollbarWidth,
      scrollbarSetting: scrollable[0] ? getComputedStyle(scrollable[0]).scrollbarWidth : "none",
      lastCardBottom: last ? Math.round(last.bottom) : 0,
      bodyBottom: Math.round(body.getBoundingClientRect().bottom),
    };
  });
}

test("the People tab scrolls, so every person is reachable", async ({ context, serviceWorker }) => {
  await context.route("https://www.linkedin.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PROFILE })
  );
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/in/mira-okafor-lind-12ab/");

  // Wait for the store to exist, then add enough people to overflow the panel.
  const seeded = await serviceWorker.evaluate(async () => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error("open failed"));
      });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const db = await open();
      if (db.objectStoreNames.contains("people")) {
        const tx = db.transaction("people", "readwrite");
        const store = tx.objectStore("people");
        for (let i = 0; i < 24; i++) {
          store.add({
            kind: "person",
            name: `Test Person ${i}`,
            headline: `Engineer number ${i} at a company with a fairly long name`,
            company: "Northwind",
            profileUrl: `https://www.linkedin.com/in/test-person-${i}/`,
            summary: "Builds test infrastructure for payments teams and writes about it.",
            firstSeen: Date.now() - i * 1000,
            lastSeen: Date.now() - i * 1000,
            visitCount: 2,
          });
        }
        await new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
        });
        const count = await new Promise<number>((resolve) => {
          const c = db.transaction("people", "readonly").objectStore("people").count();
          c.onsuccess = () => resolve(c.result);
        });
        db.close();
        return count;
      }
      db.close();
      if (Date.now() > deadline) return 0;
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  expect(seeded).toBeGreaterThanOrEqual(24);

  await page.addStyleTag({ content: `* { scrollbar-width: none !important; }` });
  await openOverlayViaToolbar(page, serviceWorker);
  await clickInShadow(page, "cortex-tab", "People & Companies");
  await expect.poll(async () => (await measure(page)).cards, { timeout: 20_000 }).toBeGreaterThanOrEqual(24);

  const before = await measure(page);
  // Nothing escapes the panel, and what is inside can be scrolled by hand.
  expect(before.bodyOverflow).toBeLessThanOrEqual(1);
  expect(before.userScrollable).toBe(true);
  // The page hid its own scrollbars; the panel's must survive that.
  expect(before.scrollbarSetting).not.toBe("none");
  if (before.browserScrollbarWidth > 0) expect(before.scrollbarWidth).toBeGreaterThan(0);
  expect(before.lastCardBottom).toBeGreaterThan(before.bodyBottom);

  await page.mouse.move(640, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);

  const after = await measure(page);
  expect(after.lastCardBottom).toBeLessThanOrEqual(after.bodyBottom + 1);
});
