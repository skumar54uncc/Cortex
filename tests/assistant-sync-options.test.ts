// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assistantSyncDb, readSyncEngineState } from "../src/assistant-sync/db";
import { applyAssistantSyncPreferences } from "../src/assistant-sync/preferences";
import { ASSISTANT_SYNC_ARCHIVES_KEY, ASSISTANT_SYNC_RETENTION_KEY } from "../src/assistant-sync/preference-keys";
import { mountAssistantSyncPanel } from "../src/options/assistant-sync-panel";

const html = readFileSync(join(__dirname, "..", "src", "options", "options.html"), "utf8");

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("assistant sync options", () => {
  beforeEach(async () => {
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";
    await assistantSyncDb.state.clear();
  });

  it("puts consent above Enable and keeps each assistant guide under 150 words", () => {
    const consent = document.getElementById("cx-assistant-consent")?.textContent ?? "";
    expect(consent).toMatch(/page titles, URLs, excerpts of pages you read for 5 minutes or more, searches, LinkedIn profiles, and topics/);
    expect(consent).toMatch(/folder named Cortex Memory/);
    expect(consent).toMatch(/drive\.file/);
    expect(consent).toMatch(/relevant rows/);
    const enable = document.getElementById("cx-assistant-enable");
    const consentNode = document.getElementById("cx-assistant-consent");
    expect(enable).toBeTruthy();
    expect(consentNode).toBeTruthy();
    const position = consentNode && enable ? consentNode.compareDocumentPosition(enable) : 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById("cx-assistant-archives-note")?.textContent).toMatch(/personal backups/);
    expect(document.getElementById("cx-assistant-retention")?.getAttribute("min")).toBe("7");
    expect(document.getElementById("cx-assistant-retention")?.getAttribute("max")).toBe("365");
    const guides = [...document.querySelectorAll("[data-assistant-guide]")];
    expect(guides.map((node) => node.getAttribute("data-assistant-guide"))).toEqual([
      "muse",
      "grok",
      "chatgpt",
      "claude",
      "generic",
    ]);
    for (const guide of guides) {
      const text = guide.querySelector("p")?.textContent ?? "";
      expect(words(text)).toBeLessThan(150);
      expect(text).toMatch(/Google Drive/);
      expect(text).toMatch(/Cortex Memory/);
      expect(text).toMatch(/About/);
      expect(text).toMatch(/Content/);
    }
    expect(document.getElementById("cx-opt-delete-all")?.textContent).toMatch(/Delete all indexed data/);
    expect(html).toMatch(/Type <strong>DELETE<\/strong>/);
  });

  it("requests Drive permission from the Enable click and passes that token", async () => {
    const sent: { type?: string; action?: string; token?: string }[] = [];
    const order: string[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      identity: {
        getAuthToken: (_details: { interactive: boolean }, callback: (token?: string) => void) => {
          order.push(_details.interactive ? "interactive" : "silent");
          callback("click-token");
        },
      },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { type?: string; action?: string; token?: string }) => {
          order.push(msg.action ?? "");
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          return { ok: true, status: "ready" };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.getElementById("cx-assistant-enable")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["status", "interactive", "enable", "status"]);
    expect(sent.find((msg) => msg.action === "enable")?.token).toBe("click-token");
    // Sync now stays gated until status reports syncEnabled.
    const nowBtn = document.getElementById("cx-assistant-now") as HTMLButtonElement;
    expect(nowBtn.disabled).toBe(true);
  });

  it("shows Disable when sync is on and turns sync off without a Google token", async () => {
    const { writeSyncEngineState, defaultSyncEngineState } = await import("../src/assistant-sync/db");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    const sent: { type?: string; action?: string; token?: string }[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        lastError: undefined,
        sendMessage: async (msg: { type?: string; action?: string; token?: string }) => {
          sent.push(msg);
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          if (msg.action === "disable") {
            await writeSyncEngineState({ ...(await readSyncEngineState()), syncEnabled: false });
            return { ok: true, status: "disabled" };
          }
          return { ok: true };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const disable = document.getElementById("cx-assistant-disable") as HTMLButtonElement;
    const enable = document.getElementById("cx-assistant-enable") as HTMLButtonElement;
    const now = document.getElementById("cx-assistant-now") as HTMLButtonElement;
    expect(disable.hidden).toBe(false);
    expect(enable.hidden).toBe(true);
    expect(now.disabled).toBe(false);
    disable.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.some((msg) => msg.action === "disable")).toBe(true);
    expect(sent.find((msg) => msg.action === "disable")?.token).toBeUndefined();
    expect((await readSyncEngineState()).syncEnabled).toBe(false);
  });

  it("saves retention and the archive toggle for the next sync", async () => {
    const stored: Record<string, unknown> = {};
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of keys) if (key in stored) out[key] = stored[key];
            return out;
          },
          set: async (values: Record<string, unknown>) => {
            Object.assign(stored, values);
          },
        },
      },
      runtime: {
        sendMessage: async (msg: { action?: string }) => {
          if (msg.action === "status") return { ok: true, state: await readSyncEngineState() };
          return { ok: true };
        },
      },
    };
    mountAssistantSyncPanel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retention = document.getElementById("cx-assistant-retention") as HTMLInputElement;
    retention.value = "30";
    retention.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const archives = document.getElementById("cx-assistant-archives") as HTMLInputElement;
    archives.checked = true;
    archives.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stored[ASSISTANT_SYNC_RETENTION_KEY]).toBe(30);
    expect(stored[ASSISTANT_SYNC_ARCHIVES_KEY]).toBe(true);
    await applyAssistantSyncPreferences({
      retentionDays: stored[ASSISTANT_SYNC_RETENTION_KEY],
      archivesEnabled: stored[ASSISTANT_SYNC_ARCHIVES_KEY],
    });
    const state = await readSyncEngineState();
    expect(state.retentionDays).toBe(30);
    expect(state.archivesEnabled).toBe(true);
    expect(state.syncEnabled).toBe(false);
  });
});
