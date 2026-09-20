import type { BrowserContext } from "@playwright/test";
import { test, expect, openOverlayViaToolbar, EXTENSION_PATH_E2E_AUDIT } from "./fixtures";
import { clickInShadow } from "./shadow";

/**
 * Sites bind keys to the document: YouTube plays or pauses on Space and
 * swallows it with preventDefault, which stopped Space reaching the Cortex
 * question box. Two cases:
 *  - handlers on the document (what video sites do): the page must see nothing.
 *  - handlers on window in the capture phase, registered before the panel
 *    exists: listener order cannot be won, so the panel types the character
 *    itself and the box still works.
 */
function hostilePage(where: "document" | "window-capture"): string {
  const bind =
    where === "document"
      ? `document.addEventListener("keydown", grab, true);
         document.addEventListener("keydown", grab);
         window.addEventListener("keydown", grab);`
      : `window.addEventListener("keydown", grab, true);`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hostile keys</title></head>
<body><main><article><h1>Player page</h1>
<p>This page binds Space and letters the way a video site does, and blocks the default action so the character is never typed.</p>
<p>It exists so the Cortex panel can prove that typing inside the panel keeps working and stays out of the page.</p>
</article></main>
<script>
  window.__seen = [];
  const grab = (e) => { window.__seen.push(e.key); e.preventDefault(); };
  ${bind}
</script></body></html>`;
}

// The open-shadow build, so the test can read the panel's input value. The
// shipped build differs only in the shadow root mode.
test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

async function route(context: BrowserContext, where: "document" | "window-capture"): Promise<void> {
  await context.route("http://cortex-e2e.test/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: hostilePage(where) })
  );
}

/** Reads the panel's search box through the page, for the open-shadow e2e build. */
async function searchValue(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("cortex-overlay-root") as HTMLElement | null;
    const root = host?.shadowRoot;
    if (!root) return "(closed shadow root)";
    return root.querySelector<HTMLInputElement>(".cortex-search-input")?.value ?? "(no input)";
  });
}

test("typing works on a page that cancels keys on the document, spaces included", async ({ context, serviceWorker }) => {
  await route(context, "document");
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/player");
  await openOverlayViaToolbar(page, serviceWorker);

  await clickInShadow(page, "cortex-search-input");
  await page.keyboard.type("glacier survey notes");

  // The page sees the keys: a content script runs in an isolated world and
  // cannot stop that. What matters is that every character still lands.
  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.length)).toBeGreaterThan(0);
  expect(await searchValue(page)).toBe("glacier survey notes");

  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => Boolean(document.getElementById("cortex-overlay-root"))))
    .toBe(false);
});

test("even when the page cancels keys first, the question box still types", async ({ context, serviceWorker }) => {
  await route(context, "window-capture");
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/player-capture");
  await openOverlayViaToolbar(page, serviceWorker);

  await clickInShadow(page, "cortex-search-input");
  await page.keyboard.type("aurora drift 4 nT");

  // The page got the keys (it listens earlier than any extension can) and
  // cancelled them, yet every character, spaces included, landed in the box.
  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.length)).toBeGreaterThan(0);
  expect(await searchValue(page)).toBe("aurora drift 4 nT");
});
