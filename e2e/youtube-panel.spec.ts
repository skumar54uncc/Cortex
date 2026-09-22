import type { BrowserContext, Page, Worker } from "@playwright/test";
import {
  test,
  expect,
  routeArticle,
  EXTENSION_PATH_E2E_AUDIT,
} from "./fixtures";
import { BrowserCdp } from "./cdp";
import { clickInShadow } from "./shadow";

/**
 * The owner asked for the side panel on YouTube: the player owns the
 * keyboard, so the centred in-page window is the wrong surface. Double
 * Shift cannot open chrome.sidePanel (no user gesture reaches the worker),
 * so Cortex docks the existing overlay on the right instead of falling
 * back to a popup window.
 */
const WATCH_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>A river survey - YouTube</title></head>
<body><ytd-watch-metadata><h1><yt-formatted-string>A river survey</yt-formatted-string></h1>
<div id="owner"><ytd-channel-name><a href="/c">Northern Survey</a></ytd-channel-name></div>
<div id="description-inline-expander"><yt-attributed-string>The survey team recorded readings near the northern ridge over several winter nights, and compared them with earlier seasons.</yt-attributed-string></div>
</ytd-watch-metadata><video width="640" height="360"></video></body></html>`;

async function routeYouTube(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube.com/watch**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: WATCH_HTML })
  );
  await context.route("https://www.youtube.com/api/timedtext**", (route) =>
    route.fulfill({ status: 404, body: "" })
  );
}

async function doubleShift(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down("Shift");
    await page.keyboard.up("Shift");
  }
}

function overlayOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")?.isConnected));
}

function overlayHostClass(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById("cortex-overlay-root")?.className ?? "");
}

/** Windows Chrome opened beside the tab: the fallback makes a popup one. */
function popupWindows(sw: Worker): Promise<number> {
  return sw.evaluate(async () => (await chrome.windows.getAll({})).filter((w) => w.type === "popup").length);
}

async function shellTargets(cdp: BrowserCdp): Promise<number> {
  const { targetInfos } = await cdp.send<{ targetInfos: { url: string }[] }>("Target.getTargets");
  return targetInfos.filter((t) => t.url.includes("/search-shell.html")).length;
}

async function hostBox(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const el = document.getElementById("cortex-overlay-root");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

async function openDockedOnYouTube(context: BrowserContext, page: Page): Promise<void> {
  await routeYouTube(context);
  await page.goto("https://www.youtube.com/watch?v=tIdAl4Mgr01");
  await page.bringToFront();
  await page.waitForTimeout(1500);
  await doubleShift(page);
  await expect.poll(() => overlayOpen(page), { timeout: 15_000 }).toBe(true);
}

test("double Shift on YouTube opens the side panel, not the window on the page", async ({
  context,
  serviceWorker,
  userDataDir,
}) => {
  await routeYouTube(context);
  const cdp = await BrowserCdp.connect(userDataDir);
  try {
    const page = await context.newPage();
    await page.goto("https://www.youtube.com/watch?v=tIdAl4Mgr01");
    await page.bringToFront();
    await page.waitForTimeout(1500);

    await doubleShift(page);

    await expect.poll(() => overlayOpen(page), { timeout: 15_000 }).toBe(true);
    expect(await overlayHostClass(page)).toContain("cortex-overlay-host--docked");
    expect(await popupWindows(serviceWorker)).toBe(0);
    expect(await shellTargets(cdp)).toBe(0);

    const box = await hostBox(page);
    const vp = page.viewportSize();
    expect(box).toBeTruthy();
    expect(vp).toBeTruthy();
    // Pinned to the right edge, full viewport height, roughly 420px wide.
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - vp!.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.x + box!.width - vp!.width)).toBeLessThanOrEqual(2);
    expect(box!.width).toBeGreaterThanOrEqual(360);
    expect(box!.width).toBeLessThanOrEqual(480);
  } finally {
    cdp.close();
  }
});

test("a second double Shift closes the docked panel", async ({ context }) => {
  const page = await context.newPage();
  await openDockedOnYouTube(context, page);
  await doubleShift(page);
  await expect.poll(() => overlayOpen(page), { timeout: 10_000 }).toBe(false);
});

test("Escape closes the docked panel", async ({ context }) => {
  const page = await context.newPage();
  await openDockedOnYouTube(context, page);
  await page.keyboard.press("Escape");
  await expect.poll(() => overlayOpen(page), { timeout: 10_000 }).toBe(false);
});

test("the page next to the docked panel stays clickable", async ({ context }) => {
  const page = await context.newPage();
  await openDockedOnYouTube(context, page);

  await page.evaluate(() => {
    (window as unknown as { __pageClicks: number }).__pageClicks = 0;
    document.querySelector("h1")?.addEventListener("click", () => {
      (window as unknown as { __pageClicks: number }).__pageClicks += 1;
    });
  });
  await page.locator("h1").click();

  expect(await overlayOpen(page)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __pageClicks: number }).__pageClicks)).toBe(
    1
  );
});

test("an ordinary page still opens the panel on the page", async ({ context, userDataDir }) => {
  await routeArticle(context, "An ordinary article");
  const cdp = await BrowserCdp.connect(userDataDir);
  try {
    const page = await context.newPage();
    await page.goto("http://cortex-e2e.test/ordinary");
    await page.bringToFront();
    await page.waitForTimeout(1500);

    await doubleShift(page);
    await expect.poll(() => overlayOpen(page), { timeout: 15_000 }).toBe(true);
    expect(await overlayHostClass(page)).not.toContain("cortex-overlay-host--docked");
    expect(await shellTargets(cdp)).toBe(0);

    const box = await hostBox(page);
    const vp = page.viewportSize();
    expect(box).toBeTruthy();
    expect(vp).toBeTruthy();
    // Centred overlay covers the viewport; it is not a right-edge strip.
    expect(box!.width).toBeGreaterThan(vp!.width * 0.8);
  } finally {
    cdp.close();
  }
});

test.describe("typing in the docked panel on YouTube", () => {
  // Open-shadow build, so the test can read the input value. The shipped
  // build differs only in the shadow root mode.
  test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

  test("spaces included land in the search box", async ({ context }) => {
    const page = await context.newPage();
    await openDockedOnYouTube(context, page);

    await clickInShadow(page, "cortex-search-input");
    await page.keyboard.type("glacier survey notes");

    const value = await page.evaluate(() => {
      const host = document.getElementById("cortex-overlay-root") as HTMLElement | null;
      const root = host?.shadowRoot;
      if (!root) return "(closed shadow root)";
      return root.querySelector<HTMLInputElement>(".cortex-search-input")?.value ?? "(no input)";
    });
    expect(value).toBe("glacier survey notes");
  });
});
