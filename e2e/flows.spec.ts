import type { Page, Worker, BrowserContext } from "@playwright/test";
import { test, expect, openOverlayViaToolbar, articleHtml } from "./fixtures";
import { clickInShadow, queryInShadow } from "./shadow";
import { BrowserCdp, FAKE_NANO_SCRIPT } from "./cdp";

/**
 * Phase 4.5 E2E: the unpacked production build (dist/) in a persistent
 * Chromium context. Pages are served by context.route, so no real site is
 * contacted.
 */
const TITLE = "Zephyrquill turbine field notes";
const PARAS = [
  "Zephyrquill turbines are a fictional design used only in Cortex tests. Each zephyrquill turbine spins at forty two rotations per minute in a steady coastal wind.",
  "Engineers log the zephyrquill blade pitch every morning and compare it with the tide tables before approving the next maintenance window for the array.",
  "The zephyrquill array has eleven towers. Tower seven carries the weather station and the uplink that reports blade pitch to the harbour office each hour.",
  "This paragraph adds enough readable text for the indexer to accept the page and create a document with chunks and embeddings on device.",
];

async function routeZephyr(context: BrowserContext): Promise<void> {
  await context.route("http://cortex-e2e.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: articleHtml(TITLE, PARAS) })
  );
}

/** Waits until the page is indexed and every chunk is embedded. */
async function waitForIndexed(sw: Worker, urlPart: string): Promise<void> {
  const ok = await sw.evaluate(async (part) => {
    const read = (): Promise<{ docs: number; chunks: number; embedded: number }> =>
      new Promise((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("documents")) {
            db.close();
            resolve({ docs: 0, chunks: 0, embedded: 0 });
            return;
          }
          const tx = db.transaction(["documents", "chunks"], "readonly");
          const d = tx.objectStore("documents").getAll();
          const c = tx.objectStore("chunks").getAll();
          tx.oncomplete = () => {
            const docs = (d.result as { id: number; url: string }[]).filter((x) => x.url.includes(part));
            const ids = new Set(docs.map((x) => x.id));
            const ch = (c.result as { documentId: number; embedState?: string }[]).filter((x) => ids.has(x.documentId));
            resolve({ docs: docs.length, chunks: ch.length, embedded: ch.filter((x) => x.embedState === "embedded").length });
            db.close();
          };
        };
        req.onerror = () => resolve({ docs: 0, chunks: 0, embedded: 0 });
      });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await read();
      if (r.docs > 0 && r.chunks > 0 && r.embedded === r.chunks) return true;
      await new Promise((res) => setTimeout(res, 400));
    }
    return false;
  }, urlPart);
  expect(ok, "page indexed and embedded").toBe(true);
}

async function typeInShadowField(page: Page, cls: string, text: string): Promise<void> {
  await clickInShadow(page, cls);
  await page.keyboard.type(text);
}

test("production build keeps the overlay shadow root closed", async ({ context, serviceWorker }) => {
  await routeZephyr(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/closed");
  await openOverlayViaToolbar(page, serviceWorker);
  const shadowFromPage = await page.evaluate(
    () => document.getElementById("cortex-overlay-root")?.shadowRoot ?? "closed"
  );
  expect(shadowFromPage).toBe("closed");
});

test("search: an indexed page is found from the overlay", async ({ context, serviceWorker }) => {
  await routeZephyr(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/search");
  await waitForIndexed(serviceWorker, "/search");
  await openOverlayViaToolbar(page, serviceWorker);
  await page.keyboard.type("zephyrquill blade pitch");
  await expect
    .poll(async () => (await queryInShadow(page, "cortex-hit-title")).map((m) => m.text), { timeout: 20_000 })
    .toContain(TITLE);
});

async function setChatSettings(sw: Worker, patch: Record<string, unknown>): Promise<void> {
  await sw.evaluate(async (p) => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, ...p } });
  }, patch);
}

async function askInOverlay(page: Page, sw: Worker, question: string): Promise<string> {
  await openOverlayViaToolbar(page, sw);
  await clickInShadow(page, "cortex-tab", "Ask");
  await typeInShadowField(page, "cortex-ask-input", question);
  await page.keyboard.press("Enter");
  let answer = "";
  await expect
    .poll(
      async () => {
        answer = (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" ");
        return answer;
      },
      { timeout: 30_000 }
    )
    .toContain("rotations per minute");
  await expect.poll(async () => (await queryInShadow(page, "cortex-citation")).length).toBeGreaterThan(0);
  return answer;
}

test("ask (on-device path): stubbed Prompt API answers with citations and nothing leaves the offscreen document", async ({
  context,
  serviceWorker,
  userDataDir,
}) => {
  await routeZephyr(context);
  await setChatSettings(serviceWorker, { chatMode: "on-device-only", cloudChatEnabled: false, geminiApiKey: "" });
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/ask-nano");
  await waitForIndexed(serviceWorker, "/ask-nano");

  const cdp = await BrowserCdp.connect(userDataDir);
  try {
    const session = await cdp.attachOffscreen();
    const external: string[] = [];
    cdp.on("Network.requestWillBeSent", (p, sid) => {
      const url = String((p.request as { url?: string })?.url ?? "");
      if (sid === session && !url.startsWith("chrome-extension://") && !url.startsWith("data:") && !url.startsWith("blob:")) {
        external.push(url);
      }
    });
    await cdp.send("Network.enable", {}, session);
    await cdp.evaluate(session, FAKE_NANO_SCRIPT(["Zephyrquill turbines spin at forty two ", "rotations per minute [1]."]));

    await askInOverlay(page, serviceWorker, "How fast do zephyrquill turbines spin?");

    const prompts = await cdp.evaluate<{ input: string }[]>(session, "window.__cortexE2EPrompts");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.input.toLowerCase()).toContain("zephyrquill");
    expect(external).toEqual([]);
  } finally {
    cdp.close();
  }
});

test("ask (cloud path): Gemini receives only the question and retrieved snippets", async ({
  context,
  serviceWorker,
  userDataDir,
}) => {
  await routeZephyr(context);
  await setChatSettings(serviceWorker, { chatMode: "cloud-only", cloudChatEnabled: true, geminiApiKey: "e2e-test-key" });
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/ask-cloud");
  await waitForIndexed(serviceWorker, "/ask-cloud");

  const cdp = await BrowserCdp.connect(userDataDir);
  const bodies: string[] = [];
  const keys: string[] = [];
  const unexpected: string[] = [];
  try {
    const session = await cdp.attachOffscreen();
    const NL2 = "\n\n";
    const sse = (t: string) =>
      "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) + NL2;
    const body =
      sse("Zephyrquill turbines spin at forty two ") + sse("rotations per minute [1].") + "data: [DONE]" + NL2;
    cdp.on("Fetch.requestPaused", (p, sid) => {
      const req = p.request as { url: string; postData?: string; headers: Record<string, string> };
      const requestId = String(p.requestId);
      if (!req.url.startsWith("https://generativelanguage.googleapis.com/")) {
        unexpected.push(req.url);
        void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sid);
        return;
      }
      bodies.push(req.postData ?? "");
      keys.push(req.headers["x-goog-api-key"] ?? req.headers["X-Goog-Api-Key"] ?? "");
      void cdp.send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/event-stream" }],
          body: Buffer.from(body).toString("base64"),
        },
        sid
      );
    });
    // Intercept every non-extension request from the offscreen document; nothing reaches the network.
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http*://*" }] }, session);

    await askInOverlay(page, serviceWorker, "How fast do zephyrquill turbines spin?");
  } finally {
    cdp.close();
  }

  expect(unexpected).toEqual([]);
  expect(keys).toEqual(["e2e-test-key"]);
  expect(bodies).toHaveLength(1);
  const sent = bodies[0]!;
  expect(sent.toLowerCase()).toContain("zephyrquill");
  expect(sent).not.toContain("e2e-test-key");
  expect(sent).not.toMatch(/inlineData|fileData|image\//);
  // Snippets, not the whole page: the prompt is bounded well below a full library dump.
  expect(sent.length).toBeLessThan(20_000);
});

test("side panel: toolbar click on chrome://newtab opens the Cortex shell", async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto("chrome://newtab/");
  await page.bringToFront();
  await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    (chrome.action.onClicked as unknown as { dispatch: (t: chrome.tabs.Tab) => void }).dispatch(tab!);
  });
  const surface = await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const ctx = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.SIDE_PANEL, chrome.runtime.ContextType.TAB],
      });
      const shell = ctx.find((c) => c.documentUrl?.includes("search-shell.html"));
      if (shell) return shell.contextType;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  });
  // SIDE_PANEL when Chrome accepts sidePanel.open without a user gesture;
  // TAB when it falls back to the popup window (same shell page).
  expect(["SIDE_PANEL", "TAB"]).toContain(surface);

  const extId = serviceWorker.url().split("/")[2];
  const shell = await context.newPage();
  await shell.goto(`chrome-extension://${extId}/search-shell.html`);
  await expect.poll(() => shell.evaluate(() => Boolean(document.getElementById("cortex-overlay-root")))).toBe(true);
});

test("managed policy: options page locks managed fields", async ({ context, extensionId }) => {
  // Real policies come from OS / Admin console. Here chrome.storage.managed is
  // stubbed in the options page before its script runs (enforcement itself is
  // covered by tests/managed-policy.test.ts).
  await context.addInitScript(() => {
    if (!location.href.startsWith("chrome-extension://") || !location.pathname.endsWith("/options.html")) return;
    const policy = { geminiAllowed: false, indexingDisabled: true, retentionDays: 30, blockedDomains: ["corp.example"] };
    const fake = {
      get: (_k: unknown, cb?: (v: unknown) => void) => {
        cb?.({ ...policy });
        return Promise.resolve({ ...policy });
      },
    };
    try {
      Object.defineProperty(chrome.storage, "managed", { value: fake, configurable: true });
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#cx-managed-banner")).toBeVisible();
  await expect(page.locator("#cx-opt-cloud-chat")).toBeDisabled();
  await expect(page.locator("#cx-opt-gemini-key")).toBeDisabled();
  await expect(page.locator("#cx-opt-pause-toggle")).toBeDisabled();
  await expect(page.locator("#cx-opt-retention")).toBeDisabled();
  await expect(page.locator("#cx-opt-retention")).toHaveValue("30");
  await expect(page.locator("#cx-opt-managed-blocklist")).toContainText("corp.example");
  expect(await page.locator("[data-managed-note]").count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator("[data-managed-note]").first()).toHaveText("Managed by your organization");
});

test("forget this site from the overlay menu removes the page from the library", async ({
  context,
  serviceWorker,
}) => {
  await routeZephyr(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/forget");
  await waitForIndexed(serviceWorker, "/forget");
  await openOverlayViaToolbar(page, serviceWorker);
  await clickInShadow(page, "cortex-menu-btn");
  await clickInShadow(page, "cortex-menu-item", "Forget this site");
  await expect
    .poll(async () => (await queryInShadow(page, "cortex-forget-status")).map((m) => m.text).join(" "))
    .toContain("Forgot cortex-e2e.test");
  const left = await serviceWorker.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const tx = req.result.transaction("documents", "readonly");
          const all = tx.objectStore("documents").getAll();
          all.onsuccess = () => {
            resolve((all.result as { domain: string }[]).filter((d) => d.domain === "cortex-e2e.test").length);
            req.result.close();
          };
        };
      })
  );
  expect(left).toBe(0);
});
