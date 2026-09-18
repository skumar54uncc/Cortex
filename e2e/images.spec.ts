import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import { test, expect, openOverlayViaToolbar } from "./fixtures";
import { clickInShadow, queryInShadow } from "./shadow";
import { BrowserCdp } from "./cdp";

/** Phase 5.8: image text is indexed; optional on-device descriptions never reach Gemini. */
const HTML = readFileSync(join(__dirname, "..", "tests", "fixtures", "images", "photo-essay.html"), "utf8");

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Solid 240x180 PNG so naturalWidth / naturalHeight pass the 100 px floor. */
function png(w = 240, h = 180): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function route(context: BrowserContext): Promise<void> {
  const image = png();
  await context.route("http://cortex-e2e.test/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (/\.(png|jpe?g|gif)$/.test(path)) return r.fulfill({ status: 200, contentType: "image/png", body: image });
    return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML });
  });
  // Cross-origin image without CORS: indexed by its text, its pixels stay unreadable.
  await context.route("https://cdn.example/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: image }));
}

type Row = { kind?: string; text: string; locator?: { images?: { src: string; alt: string }[] }; embedState?: string };

async function imageChunks(sw: Worker): Promise<Row[]> {
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
            resolve((all.result as Row[]).filter((c) => c.kind === "image"));
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

async function searchFromPopup(page: Page, query: string): Promise<{ kind?: string }[]> {
  return page.evaluate(async (q) => {
    const res = await new Promise<{ hits?: { kind?: string }[] }>((resolve) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: q }, (r) => resolve(r ?? {}))
    );
    return res.hits ?? [];
  }, query);
}

test("images: alt, caption, title and heading are indexed as one image chunk; image intent ranks it first", async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await route(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/essay");
  await expect
    .poll(async () => (await imageChunks(serviceWorker)).filter((c) => c.embedState === "embedded").length, {
      timeout: 40_000,
    })
    .toBe(1);
  const [chunk] = await imageChunks(serviceWorker);
  expect(chunk!.locator?.images?.map((i) => i.src)).toEqual([
    "http://cortex-e2e.test/img/crevasse.jpg",
    "https://cdn.example/melt.jpg",
  ]);
  expect(chunk!.text).toContain("Caption: The drone flies a photogrammetry pass at dawn.");
  expect(chunk!.text).not.toContain("Cryodrone logo");
  expect(chunk!.text).not.toContain("Description (on device)");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const hits = await searchFromPopup(popup, "photo of the drone over the crevasse");
  expect(hits[0]?.kind).toBe("image");
});

test("image descriptions: on-device only, at most the readable images, stripped before Gemini", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  await route(context);
  // Wake the offscreen document so the fake Prompt API can be installed first.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await searchFromPopup(popup, "warm up");

  const cdp = await BrowserCdp.connect(userDataDir);
  const bodies: string[] = [];
  try {
    const session = await cdp.attachOffscreen();
    await cdp.evaluate(
      session,
      `(() => {
        window.__cortexImagePrompts = [];
        window.LanguageModel = {
          availability: async () => "available",
          params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
          create: async (opts) => ({
            inputUsage: 0, inputQuota: 100000, destroy() {},
            prompt: async (input) => {
              const parts = Array.isArray(input) ? input[0].content : [];
              window.__cortexImagePrompts.push({
                expectsImage: JSON.stringify(opts?.expectedInputs ?? []).includes("image"),
                hasBlob: parts.some((p) => p.type === "image" && p.value instanceof Blob),
              });
              return "  A small grey aircraft above white ice.  ";
            },
            promptStreaming: () => new ReadableStream({ start(c) { c.enqueue("A drone [1]."); c.close(); } }),
          }),
        };
        return true;
      })()`
    );

    await setSettings(serviceWorker, { imageDescriptionsEnabled: true });
    const page = await context.newPage();
    await page.goto("http://cortex-e2e.test/essay-described");
    await expect
      .poll(async () => (await imageChunks(serviceWorker)).find((c) => c.text.includes("Description (on device)"))?.text ?? "", {
        timeout: 40_000,
      })
      .toContain("Description (on device): A small grey aircraft above white ice.");
    const prompts = await cdp.evaluate<{ expectsImage: boolean; hasBlob: boolean }[]>(
      session,
      "window.__cortexImagePrompts"
    );
    // Only the same-origin image is readable; the cross-origin one taints the canvas and is skipped.
    expect(prompts).toEqual([{ expectsImage: true, hasBlob: true }]);

    // Ask through Gemini: the description must not be in the request body.
    await setSettings(serviceWorker, { chatMode: "cloud-only", cloudChatEnabled: true, geminiApiKey: "e2e-test-key" });
    const sse = "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: "A drone [1]." }] } }] }) + "\n\n";
    cdp.on("Fetch.requestPaused", (p, sid) => {
      const req = p.request as { url: string; postData?: string };
      const requestId = String(p.requestId);
      if (!req.url.startsWith("https://generativelanguage.googleapis.com/")) {
        void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sid);
        return;
      }
      bodies.push(req.postData ?? "");
      void cdp.send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/event-stream" }],
          body: Buffer.from(sse + "data: [DONE]\n\n").toString("base64"),
        },
        sid
      );
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http*://*" }] }, session);

    await openOverlayViaToolbar(page, serviceWorker);
    await clickInShadow(page, "cortex-tab", "Ask");
    await clickInShadow(page, "cortex-ask-input");
    await page.keyboard.type("What photo of a drone over the crevasse field did I see?");
    await page.keyboard.press("Enter");
    await expect.poll(() => bodies.length, { timeout: 30_000 }).toBe(1);
    await expect
      .poll(async () => (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" "), {
        timeout: 20_000,
      })
      .toContain("A drone");
  } finally {
    cdp.close();
  }
  const sent = bodies[0]!;
  expect(sent).toContain("Fixed-wing drone over a crevasse field");
  expect(sent).not.toContain("small grey aircraft");
  expect(sent).not.toContain("Description (on device)");
  expect(sent).not.toMatch(/inlineData|fileData|image\/(png|jpeg)|base64/);
});

test("images off: no image chunks are stored", async ({ context, serviceWorker }) => {
  await setSettings(serviceWorker, { imagesEnabled: false });
  await route(context);
  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/essay-off");
  await page.waitForTimeout(4000);
  expect(await imageChunks(serviceWorker)).toEqual([]);
});
