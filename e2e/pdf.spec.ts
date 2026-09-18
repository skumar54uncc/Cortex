import type { BrowserContext, Worker } from "@playwright/test";
import { test, expect, articleHtml, openOverlayViaToolbar } from "./fixtures";
import { BrowserCdp, FAKE_NANO_SCRIPT } from "./cdp";
import { clickInShadow, findInShadow, queryInShadow } from "./shadow";
import { makePdf } from "../tests/helpers/make-pdf";

/** Phase 5.9: PDFs opened in a tab are read in the offscreen document with pdfjs-dist. */
const PDF_URL = "https://papers.cortex-e2e.test/notes/aurora-notes.pdf";
const PDF = Buffer.from(
  makePdf(
    [
      ["Aurora survey field notes", "Magnetometer drift was 4 nT per hour at the northern station."],
      ["Page two covers the calibration run.", "The fluxgate was recalibrated on day three."],
      ["Page three lists open questions about solar wind coupling."],
    ],
    "Aurora field notes 2026"
  )
);

type Row = { kind?: string; text: string; locator?: { page?: number }; embedState?: string; documentId: number };

async function pdfChunks(sw: Worker): Promise<Row[]> {
  return sw.evaluate(
    () =>
      new Promise<Row[]>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
          all.onsuccess = () => {
            resolve((all.result as Row[]).filter((c) => c.kind === "pdf"));
            db.close();
          };
        };
      })
  );
}

async function setSettings(sw: Worker, patch: Record<string, unknown>): Promise<void> {
  await sw.evaluate(async (p) => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({ cortex_user_settings: { ...cur, ...p } });
  }, patch);
}

/** Serves the PDF to the tab; a session cookie lets us check the offscreen fetch sends none. */
async function routeTab(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: "session", value: "secret-e2e", domain: "papers.cortex-e2e.test", path: "/", secure: true }]);
  await context.route("https://papers.cortex-e2e.test/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/pdf", body: PDF })
  );
}

interface Seen {
  urls: string[];
  cookies: string[];
}

/** Intercepts every request of the offscreen document; only the PDF is answered. */
async function interceptOffscreen(cdp: BrowserCdp, session: string): Promise<Seen> {
  const seen: Seen = { urls: [], cookies: [] };
  cdp.on("Fetch.requestPaused", (p, sid) => {
    const req = p.request as { url: string; headers: Record<string, string> };
    const requestId = String(p.requestId);
    seen.urls.push(req.url);
    const cookie = Object.entries(req.headers).find(([k]) => k.toLowerCase() === "cookie")?.[1];
    if (cookie) seen.cookies.push(cookie);
    if (req.url !== PDF_URL) {
      void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sid);
      return;
    }
    void cdp.send(
      "Fetch.fulfillRequest",
      {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/pdf" },
          { name: "Content-Length", value: String(PDF.length) },
        ],
        body: PDF.toString("base64"),
      },
      sid
    );
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http*://*" }] }, session);
  return seen;
}

async function wakeOffscreen(context: BrowserContext, extensionId: string): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(
    () => new Promise((resolve) => chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "warm up" }, resolve))
  );
  await popup.close();
}

async function openPdfTab(sw: Worker): Promise<void> {
  await sw.evaluate(async (url) => {
    await chrome.tabs.create({ url, active: true });
  }, PDF_URL + "#page=2");
}

test("a PDF tab is fetched once without cookies, read page by page, and found by search with its page", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  await routeTab(context);
  await wakeOffscreen(context, extensionId);
  const cdp = await BrowserCdp.connect(userDataDir);
  let seen: Seen;
  try {
    seen = await interceptOffscreen(cdp, await cdp.attachOffscreen());
    await openPdfTab(serviceWorker);
    await expect
      .poll(async () => (await pdfChunks(serviceWorker)).filter((c) => c.embedState === "embedded").length, {
        timeout: 60_000,
      })
      .toBe(3);
  } finally {
    cdp.close();
  }
  expect(seen.urls).toEqual([PDF_URL]);
  expect(seen.cookies).toEqual([]);

  const chunks = await pdfChunks(serviceWorker);
  expect(chunks.map((c) => c.locator?.page)).toEqual([1, 2, 3]);
  expect(chunks[1]!.text).toContain("fluxgate was recalibrated");
  const doc = await serviceWorker.evaluate(
    (id) =>
      new Promise<{ url: string; title: string }>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const g = req.result.transaction("documents", "readonly").objectStore("documents").get(id);
          g.onsuccess = () => resolve(g.result);
        };
      }),
    chunks[0]!.documentId
  );
  expect(doc).toMatchObject({ url: PDF_URL, title: "Aurora field notes 2026" });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const hit = await popup.evaluate(async () => {
    const res = await new Promise<{ hits?: { kind?: string; locator?: { page?: number } }[] }>((resolve) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "pdf fluxgate recalibrated" }, (r) => resolve(r ?? {}))
    );
    return res.hits?.[0];
  });
  expect(hit?.kind).toBe("pdf");
  expect(hit?.locator?.page).toBe(2);
});

test("PDFs off or indexing paused: the offscreen document never fetches the PDF", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  await routeTab(context);
  await wakeOffscreen(context, extensionId);
  const cdp = await BrowserCdp.connect(userDataDir);
  let seen: Seen;
  try {
    seen = await interceptOffscreen(cdp, await cdp.attachOffscreen());
    await setSettings(serviceWorker, { pdfEnabled: false });
    await openPdfTab(serviceWorker);
    await new Promise((r) => setTimeout(r, 4000));
    await setSettings(serviceWorker, { pdfEnabled: true, indexingPaused: true });
    await openPdfTab(serviceWorker);
    await new Promise((r) => setTimeout(r, 4000));
  } finally {
    cdp.close();
  }
  expect(seen.urls).toEqual([]);
  expect(await pdfChunks(serviceWorker)).toEqual([]);
});

test("an answer citing a PDF opens the PDF at the cited page, and the card says which page", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  await routeTab(context);
  await context.route("http://cortex-e2e.test/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Reading list", ["A short page used only to open the Cortex panel for this test, about nothing in particular."]),
    })
  );
  await setSettings(serviceWorker, { chatMode: "on-device-only", cloudChatEnabled: false, geminiApiKey: "" });
  await wakeOffscreen(context, extensionId);
  const cdp = await BrowserCdp.connect(userDataDir);
  try {
    const session = await cdp.attachOffscreen();
    await interceptOffscreen(cdp, session);
    await openPdfTab(serviceWorker);
    await expect
      .poll(async () => (await pdfChunks(serviceWorker)).filter((c) => c.embedState === "embedded").length, { timeout: 60_000 })
      .toBe(3);
    await cdp.evaluate(session, FAKE_NANO_SCRIPT(["The fluxgate was recalibrated on day three [1]."]));

    const page = await context.newPage();
    await page.goto("http://cortex-e2e.test/reading");
    await openOverlayViaToolbar(page, serviceWorker);
    await clickInShadow(page, "cortex-tab", "Ask");
    await clickInShadow(page, "cortex-ask-input");
    await page.keyboard.type("When was the fluxgate recalibrated?");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" "), { timeout: 30_000 })
      .toContain("recalibrated on day three");

    const cited = await findInShadow(page, (n, a) => n === "A" && (a.class ?? "").split(" ").includes("cortex-citation"));
    expect(cited[0]?.attrs.href).toBe(`${PDF_URL}#page=2`);
    const cards = await findInShadow(page, (n, a) => n === "A" && (a.class ?? "").split(" ").includes("cortex-source-item"));
    expect(cards[0]?.attrs.href).toBe(`${PDF_URL}#page=2`);
    expect(cards[0]?.text).toContain("PDF page 2");
  } finally {
    cdp.close();
  }
});
