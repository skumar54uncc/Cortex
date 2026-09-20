import { test, expect, articleHtml, openOverlayViaToolbar, EXTENSION_PATH_E2E_AUDIT } from "./fixtures";
import { clickInShadow, findInShadow, queryInShadow } from "./shadow";
import { BrowserCdp, FAKE_NANO_SCRIPT } from "./cdp";

/**
 * Answers used to print the model's raw markdown: literal asterisks for
 * bullets and "**" around bold. They must render as a real answer, with
 * citations that link to the page they came from.
 */
test.use({ extensionPath: EXTENSION_PATH_E2E_AUDIT });

const ANSWER = [
  "You read about **glacier drift** this week.\n\n",
  "*   The northern station logged 4 nT per hour [1].\n",
  "*   The fluxgate was recalibrated on day three [1].\n\n",
  "Use `fluxgate` as the search term.",
];

test("an answer renders as prose, bullets and code, not raw markdown, with linked citations", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  await context.route("http://cortex-e2e.test/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml("Glacier drift notes", [
        "The northern station logged a magnetometer drift of four nanotesla per hour through the long winter night.",
        "Field teams recalibrated the fluxgate on day three and compared it against the southern reference station.",
        "Solar wind coupling remains the leading explanation, pending a second winter of measurements.",
      ]),
    })
  );
  await serviceWorker.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({
      cortex_user_settings: { ...cur, chatMode: "on-device-only", cloudChatEnabled: false, geminiApiKey: "" },
    });
  });

  const page = await context.newPage();
  await page.goto("http://cortex-e2e.test/glacier");
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(
    () => new Promise((r) => chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "warm up" }, r))
  );

  // Wait until the page is indexed and embedded, so Ask has something to cite.
  await expect
    .poll(
      async () =>
        serviceWorker.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open("cortex-db");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("chunks")) return resolve(0);
                const all = db.transaction("chunks", "readonly").objectStore("chunks").getAll();
                all.onsuccess = () => {
                  resolve((all.result as { embedState?: string }[]).filter((c) => c.embedState === "embedded").length);
                  db.close();
                };
              };
            })
        ),
      { timeout: 60_000 }
    )
    .toBeGreaterThan(0);

  const cdp = await BrowserCdp.connect(userDataDir);
  try {
    await cdp.evaluate(await cdp.attachOffscreen(), FAKE_NANO_SCRIPT(ANSWER));
    await openOverlayViaToolbar(page, serviceWorker);
    await clickInShadow(page, "cortex-tab", "Ask");
    await clickInShadow(page, "cortex-ask-input");
    await page.keyboard.type("magnetometer drift at the northern station");
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => (await queryInShadow(page, "cortex-md-item")).length, { timeout: 30_000 })
      .toBe(2);
  } finally {
    cdp.close();
  }

  const answer = (await queryInShadow(page, "cortex-msg--assistant")).map((m) => m.text).join(" ");
  expect(answer).toContain("The northern station logged 4 nT per hour");
  // No raw markdown left on screen.
  expect(answer).not.toContain("**");
  expect(answer).not.toMatch(/(^|\s)\*\s/);

  const strong = await queryInShadow(page, "cortex-md-strong");
  expect(strong.map((s) => s.text)).toContain("glacier drift");
  const code = await queryInShadow(page, "cortex-md-code");
  expect(code.map((c) => c.text)).toContain("fluxgate");

  // Citations are links to the cited page.
  const cites = await findInShadow(page, (n, a) => n === "A" && (a.class ?? "").split(" ").includes("cortex-citation"));
  expect(cites.length).toBeGreaterThan(0);
  expect(cites[0]!.attrs.href).toContain("cortex-e2e.test/glacier");
});
