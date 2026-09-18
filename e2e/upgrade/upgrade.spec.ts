import { test, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BrowserCdp, FAKE_NANO_SCRIPT } from "../cdp";
import { articleHtml } from "../fixtures";

/**
 * Phase 6 upgrade test: a real 1.0.1 install, 10 indexed pages and 2 chats,
 * then 1.2.0 loaded over it from the same folder into the same profile.
 * Run on demand with a 1.0.1 build:
 *   CORTEX_UPGRADE_FROM=<path to 1.0.1 dist> npx playwright test e2e/upgrade --reporter=line
 */
const FROM = process.env.CORTEX_UPGRADE_FROM;
test.skip(!FROM, "set CORTEX_UPGRADE_FROM to a 1.0.1 dist folder");
test.setTimeout(6 * 60_000);

const TO = resolve(__dirname, "..", "..", "dist");
const WORDS = ["amberline", "borealix", "cindervale", "dunmarrow", "embergate", "frostwick", "glimmerfen", "hollowquay", "ironbrook", "junipera"];

async function launch(extDir: string, profile: string): Promise<{ context: BrowserContext; sw: Worker }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--remote-debugging-port=0"],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  await context.route("http://cortex-upgrade.test/**", (r) => {
    const w = new URL(r.request().url()).pathname.slice(1);
    return r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: articleHtml(`The ${w} field report`, [
        `The ${w} survey team recorded unusual readings near the northern ridge during the long winter night of the expedition.`,
        `Analysts compared the ${w} data against three earlier seasons and found a steady drift that nobody had explained before.`,
        `A second visit to the ${w} site is planned for spring, with new instruments and a larger crew to confirm the pattern.`,
      ]),
    });
  });
  return { context, sw };
}

interface Snapshot {
  version: string;
  dbVersion: number;
  stores: string[];
  docs: { url: string; title: string; visitCount: number }[];
  chunksPerDoc: Record<string, number>;
  conversations: string[];
  messages: { role: string; content: string }[];
  visits: number;
  settings: { blocklist?: string[]; chatMode?: string };
}

async function snapshot(sw: Worker): Promise<Snapshot> {
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open("cortex-db");
      r.onsuccess = () => res(r.result);
    });
    const all = <T,>(store: string) =>
      new Promise<T[]>((res) => {
        const q = db.transaction(store, "readonly").objectStore(store).getAll();
        q.onsuccess = () => res(q.result as T[]);
      });
    const docs = await all<{ id: number; url: string; title: string; visitCount: number }>("documents");
    const chunks = await all<{ documentId: number }>("chunks");
    const urlOf = new Map(docs.map((d) => [d.id, d.url]));
    const chunksPerDoc: Record<string, number> = {};
    for (const c of chunks) {
      const u = urlOf.get(c.documentId) ?? "orphan";
      chunksPerDoc[u] = (chunksPerDoc[u] ?? 0) + 1;
    }
    const convs = await all<{ title: string }>("conversations");
    const msgs = await all<{ role: string; content: string; timestamp: number }>("messages");
    const visits = (await all<unknown>("visitLog")).length;
    const settings = ((await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {}) as Snapshot["settings"];
    const out = {
      version: chrome.runtime.getManifest().version,
      dbVersion: db.version,
      stores: [...db.objectStoreNames].sort(),
      docs: docs.map((d) => ({ url: d.url, title: d.title, visitCount: d.visitCount })).sort((a, b) => a.url.localeCompare(b.url)),
      chunksPerDoc,
      conversations: convs.map((c) => c.title).sort(),
      messages: msgs.sort((a, b) => a.timestamp - b.timestamp).map((m) => ({ role: m.role, content: m.content })),
      visits,
      settings: { blocklist: settings.blocklist, chatMode: settings.chatMode },
    };
    db.close();
    return out;
  });
}

test("1.0.1 with 10 pages and 2 chats upgrades to 1.2.0 with data and chats intact", async () => {
  const extDir = mkdtempSync(join(tmpdir(), "cortex-upgrade-ext-"));
  const profile = mkdtempSync(join(tmpdir(), "cortex-upgrade-profile-"));
  cpSync(FROM!, extDir, { recursive: true });

  // ---- 1.0.1
  let { context, sw } = await launch(extDir, profile);
  await sw.evaluate(async () => {
    const cur = (await chrome.storage.local.get("cortex_user_settings")).cortex_user_settings ?? {};
    await chrome.storage.local.set({
      cortex_user_settings: { ...cur, blocklist: ["blocked-before-upgrade.test"], chatMode: "on-device-only" },
    });
  });
  for (const w of WORDS) {
    const page = await context.newPage();
    await page.goto(`http://cortex-upgrade.test/${w}`);
    await page.waitForTimeout(2500);
    await page.close();
  }
  await expect.poll(async () => (await snapshot(sw)).docs.length, { timeout: 90_000 }).toBe(10);

  const extId = sw.url().split("/")[2];
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const cdp = await BrowserCdp.connect(profile);
  const session = await cdp.attachOffscreen(60_000);
  await cdp.evaluate(session, FAKE_NANO_SCRIPT(["The amberline survey found a steady drift [1]."]));
  for (const question of ["What did the amberline survey find?", "When is the next borealix visit?"]) {
    const res = await popup.evaluate(
      (q) => new Promise<{ ok?: boolean; error?: string }>((r) => chrome.runtime.sendMessage({ type: "CORTEX_CHAT_START", question: q, shell: true }, r)),
      question
    );
    expect(res.ok, JSON.stringify(res)).toBe(true);
    await expect.poll(async () => (await snapshot(sw)).messages.filter((m) => m.role === "assistant").length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(question.startsWith("What") ? 1 : 2);
  }
  cdp.close();
  const before = await snapshot(sw);
  await context.close();

  // ---- load 1.2.0 over it: same folder, same profile
  rmSync(extDir, { recursive: true, force: true });
  cpSync(TO, extDir, { recursive: true });
  ({ context, sw } = await launch(extDir, profile));
  await expect.poll(async () => (await snapshot(sw)).version, { timeout: 30_000 }).toBe("1.2.0");
  // Use 1.2.0 first: its first database open runs the v6 migration (Dexie opens lazily).
  const popup2 = await context.newPage();
  await popup2.goto(`chrome-extension://${sw.url().split("/")[2]}/popup.html`);
  const hit = await popup2.evaluate(async () => {
    const res = await new Promise<{ hits?: { title?: string }[] }>((r) =>
      chrome.runtime.sendMessage({ type: "CORTEX_SEARCH", query: "frostwick field report drift" }, (x) => r(x ?? {}))
    );
    return res.hits?.[0]?.title;
  });
  expect(hit).toBe("The frostwick field report");
  const after = await snapshot(sw);

  const report = { before, after };
  mkdirSync(resolve(__dirname, "..", "..", "test-results"), { recursive: true });
  writeFileSync(resolve(__dirname, "..", "..", "test-results", "upgrade-report.json"), JSON.stringify(report, null, 2));

  expect(before.version).toBe("1.0.1");
  expect(before.docs).toHaveLength(10);
  expect(before.conversations).toHaveLength(2);
  expect(after.dbVersion).toBe(60);
  expect(after.stores).toEqual(expect.arrayContaining(["people", "collections", "collectionItems", "highlights"]));
  expect(after.docs).toEqual(before.docs);
  expect(after.chunksPerDoc).toEqual(before.chunksPerDoc);
  expect(after.conversations).toEqual(before.conversations);
  expect(after.messages).toEqual(before.messages);
  expect(after.visits).toBe(before.visits);
  expect(after.settings).toEqual(before.settings);

  await context.close();
});
