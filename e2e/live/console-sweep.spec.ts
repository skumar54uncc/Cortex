import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Worker } from "@playwright/test";
import { test, expect, openOverlayViaToolbar } from "../fixtures";
import { BrowserCdp } from "../cdp";

/**
 * Phase 6 release check on real sites (network). Run only on demand:
 *   CORTEX_LIVE=1 npx playwright test e2e/live --reporter=line
 * Records uncaught exceptions and console.error from the service worker, the
 * offscreen document, and Cortex's own contexts inside pages (content script
 * isolated world, and any script whose URL is the extension's). Errors that
 * the sites themselves log are not Cortex's and are left out.
 */
test.skip(!process.env.CORTEX_LIVE, "live network sweep: set CORTEX_LIVE=1");
test.setTimeout(8 * 60_000);

const SITES: { name: string; url: string; waitMs: number; overlay?: boolean }[] = [
  { name: "LinkedIn", url: "https://www.linkedin.com/in/satyanadella/", waitMs: 15_000 },
  { name: "YouTube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", waitMs: 40_000 },
  { name: "Wikipedia table", url: "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population", waitMs: 15_000, overlay: true },
  { name: "PDF", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", waitMs: 15_000 },
  { name: "GitHub", url: "https://github.com/mozilla/pdf.js", waitMs: 15_000, overlay: true },
  { name: "chrome://newtab", url: "chrome://newtab/", waitMs: 5_000 },
];

interface Finding {
  where: string;
  kind: "exception" | "console.error";
  text: string;
}

type Row = { kind?: string; documentId: number };

async function libraryState(sw: Worker) {
  return sw.evaluate(
    () =>
      new Promise<{ docs: { url: string; title: string }[]; chunks: Row[] }>((resolve) => {
        const req = indexedDB.open("cortex-db");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["documents", "chunks"], "readonly");
          const d = tx.objectStore("documents").getAll();
          const c = tx.objectStore("chunks").getAll();
          tx.oncomplete = () => {
            resolve({
              docs: (d.result as { url: string; title: string }[]).map((x) => ({ url: x.url, title: x.title })),
              chunks: (c.result as Row[]).map((x) => ({ kind: x.kind, documentId: x.documentId })),
            });
            db.close();
          };
        };
      })
  );
}

test("real sites: no uncaught errors in the service worker, offscreen document or Cortex page contexts", async ({
  context,
  serviceWorker,
  extensionId,
  userDataDir,
}) => {
  const origin = `chrome-extension://${extensionId}`;
  const cdp = await BrowserCdp.connect(userDataDir);
  const findings: Finding[] = [];
  const targets = new Map<string, { type: string; url: string }>();
  const extContexts = new Map<string, Set<number>>();
  const label = (sid?: string) => {
    const t = sid ? targets.get(sid) : undefined;
    return t ? `${t.type} ${t.url.replace(origin, "ext:")}` : "unknown";
  };
  const isExtTarget = (sid?: string) => {
    const t = sid ? targets.get(sid) : undefined;
    return !!t && (t.url.startsWith(origin) || t.type === "service_worker");
  };
  const fromExtension = (sid: string | undefined, ctxId: unknown, urls: string[]) =>
    isExtTarget(sid) ||
    (sid != null && extContexts.get(sid)?.has(Number(ctxId))) ||
    urls.some((u) => u.startsWith(origin));

  cdp.on("Target.attachedToTarget", (p) => {
    const sid = String(p.sessionId);
    const info = p.targetInfo as { type: string; url: string };
    targets.set(sid, { type: info.type, url: info.url });
    void (async () => {
      if (info.type !== "browser" && info.type !== "browser_ui") {
        await cdp.send("Runtime.enable", {}, sid).catch(() => undefined);
      }
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => undefined);
    })();
  });
  // Context ids restart when a tab changes renderer process: forget old ones.
  cdp.on("Runtime.executionContextsCleared", (_p, sid) => {
    if (sid) extContexts.delete(sid);
  });
  cdp.on("Runtime.executionContextDestroyed", (p, sid) => {
    if (sid) extContexts.get(sid)?.delete(Number(p.executionContextId));
  });
  cdp.on("Runtime.executionContextCreated", (p, sid) => {
    const c = p.context as { id: number; origin: string; name: string };
    if (!sid) return;
    if (c.origin?.startsWith(origin)) {
      if (!extContexts.has(sid)) extContexts.set(sid, new Set());
      extContexts.get(sid)!.add(c.id);
    }
  });
  cdp.on("Runtime.exceptionThrown", (p, sid) => {
    const d = p.exceptionDetails as {
      text: string;
      url?: string;
      executionContextId?: number;
      exception?: { description?: string };
      stackTrace?: { callFrames: { url: string }[] };
    };
    const urls = [d.url ?? "", ...(d.stackTrace?.callFrames ?? []).map((f) => f.url)];
    if (!fromExtension(sid, d.executionContextId, urls)) return;
    findings.push({ where: label(sid), kind: "exception", text: `${d.text} ${d.exception?.description ?? ""}`.slice(0, 400) });
  });
  cdp.on("Runtime.consoleAPICalled", (p, sid) => {
    if (p.type !== "error") return;
    const frames = ((p.stackTrace as { callFrames?: { url: string }[] } | undefined)?.callFrames ?? []).map((f) => f.url);
    if (!fromExtension(sid, p.executionContextId, frames)) return;
    const args = (p.args as { value?: unknown; description?: string }[]).map((a) => String(a.value ?? a.description ?? ""));
    findings.push({ where: label(sid), kind: "console.error", text: args.join(" ").slice(0, 400) });
  });
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const visited: string[] = [];
  for (const site of SITES) {
    if (site.name === "PDF") {
      // Open like a user would (Chrome's PDF viewer); page.goto can turn a PDF into a download.
      await serviceWorker.evaluate(async (url) => void (await chrome.tabs.create({ url, active: true })), site.url);
      visited.push(`${site.name}: opened in a tab`);
      await new Promise((r) => setTimeout(r, site.waitMs));
      continue;
    }
    const page = await context.newPage();
    const res = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: Error) => e);
    visited.push(`${site.name}: ${res instanceof Error ? `navigation error ${res.message.split("\n")[0]}` : `HTTP ${res?.status() ?? "n/a"}`}`);
    if (site.name === "YouTube") {
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) {
          v.muted = true;
          void v.play().catch(() => undefined);
        }
      }).catch(() => undefined);
    }
    await page.waitForTimeout(site.waitMs);
    if (site.overlay) {
      await openOverlayViaToolbar(page, serviceWorker).catch((e: Error) => visited.push(`${site.name}: overlay ${e.message}`));
      await page.keyboard.type("population");
      await page.waitForTimeout(3_000);
      await page.keyboard.press("Escape");
    }
    if (site.name === "chrome://newtab") {
      await page.bringToFront();
      await serviceWorker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        (chrome.action.onClicked as unknown as { dispatch: (t: chrome.tabs.Tab) => void }).dispatch(tab!);
      });
      await page.waitForTimeout(3_000);
    }
  }
  await new Promise((r) => setTimeout(r, 5_000));
  const state = await libraryState(serviceWorker);
  cdp.close();

  const kindCounts: Record<string, number> = {};
  for (const c of state.chunks) kindCounts[c.kind ?? "text"] = (kindCounts[c.kind ?? "text"] ?? 0) + 1;
  const attachedTypes = [...new Set([...targets.values()].map((t) => (t.url.startsWith(origin) ? `${t.type} ${t.url.replace(origin, "ext:")}` : t.type)))];
  const report = {
    visited,
    attachedTargets: attachedTypes,
    indexedDocuments: state.docs,
    chunkKinds: kindCounts,
    findings,
  };
  const outDir = join(__dirname, "..", "..", "test-results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "console-sweep.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(findings).toEqual([]);
});
