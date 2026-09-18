import { describe, it, expect, afterEach } from "vitest";
import {
  applyManagedPolicy,
  normalizeManagedPolicy,
  readManagedPolicy,
  getEffectiveSettings,
  getEffectiveChatSettings,
  MANAGED_POLICY_KEYS,
} from "../src/shared/managed-policy";
import { DEFAULT_USER_SETTINGS, type CortexUserSettings } from "../src/shared/extension-settings";
import { createChromeStorageLocalMock } from "./helpers/chrome-storage-mock";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function user(partial: Partial<CortexUserSettings> = {}): CortexUserSettings {
  return { ...DEFAULT_USER_SETTINGS, ...partial };
}

/** Installs chrome.storage.local + a mocked chrome.storage.managed area. */
function installChrome(managed: Record<string, unknown> | "throws", local: Record<string, unknown> = {}): void {
  const { storage } = createChromeStorageLocalMock(local);
  const managedArea = {
    get: (_keys: unknown, cb?: (items: Record<string, unknown>) => void) => {
      if (managed === "throws") {
        (globalThis.chrome.runtime as { lastError?: { message: string } }).lastError = {
          message: "Managed storage unavailable",
        };
        cb?.({});
        (globalThis.chrome.runtime as { lastError?: unknown }).lastError = undefined;
        return Promise.resolve({});
      }
      cb?.({ ...managed });
      return Promise.resolve({ ...managed });
    },
  };
  globalThis.chrome = {
    storage: { ...storage, managed: managedArea },
    runtime: { id: "test", lastError: undefined },
  } as unknown as typeof chrome;
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("managed_schema.json", () => {
  it("declares exactly the supported policy keys with the right types, and the manifest points at it", () => {
    const schema = JSON.parse(readFileSync(join(__dirname, "..", "managed_schema.json"), "utf8"));
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties).sort()).toEqual([...MANAGED_POLICY_KEYS].sort());
    expect(schema.properties.geminiAllowed.type).toBe("boolean");
    expect(schema.properties.blockedDomains.type).toBe("array");
    expect(schema.properties.blockedDomains.items.type).toBe("string");
    expect(schema.properties.allowedDomainsOnly.type).toBe("array");
    expect(schema.properties.retentionDays.type).toBe("integer");
    expect(schema.properties.indexingDisabled.type).toBe("boolean");
    expect(schema.properties.imageDescriptionsAllowed.type).toBe("boolean");
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8"));
    expect(manifest.storage).toEqual({ managed_schema: "managed_schema.json" });
  });
});

describe("normalizeManagedPolicy", () => {
  it("keeps valid values, drops wrong types and unknown keys, lowercases domains", () => {
    const p = normalizeManagedPolicy({
      geminiAllowed: false,
      blockedDomains: ["Bank.Example", "", 7, "  intranet.corp "],
      allowedDomainsOnly: "not-a-list",
      retentionDays: 30.7,
      indexingDisabled: "yes",
      imageDescriptionsAllowed: true,
      somethingElse: 1,
    });
    expect(p).toEqual({
      geminiAllowed: false,
      blockedDomains: ["bank.example", "intranet.corp"],
      retentionDays: 30,
      imageDescriptionsAllowed: true,
    });
  });

  it("ignores retentionDays under 1", () => {
    expect(normalizeManagedPolicy({ retentionDays: 0 })).toEqual({});
    expect(normalizeManagedPolicy({ retentionDays: -5 })).toEqual({});
    expect(normalizeManagedPolicy(null)).toEqual({});
  });
});

describe("applyManagedPolicy", () => {
  it("no policy: user settings pass through and nothing is locked", () => {
    const eff = applyManagedPolicy(user({ blocklist: ["a.com"], cloudChatEnabled: true }), {});
    expect(eff.blocklist).toEqual(["a.com"]);
    expect(eff.cloudChatEnabled).toBe(true);
    expect(eff.locked).toEqual([]);
    expect(eff.isManaged).toBe(false);
  });

  it("geminiAllowed=false forces cloud off, hides the key, and moves cloud-only to on-device-only", () => {
    const eff = applyManagedPolicy(
      user({ cloudChatEnabled: true, geminiApiKey: "AIza-secret", chatMode: "cloud-only" }),
      { geminiAllowed: false }
    );
    expect(eff.cloudChatEnabled).toBe(false);
    expect(eff.geminiApiKey).toBe("");
    expect(eff.chatMode).toBe("on-device-only");
    expect(eff.locked).toEqual(expect.arrayContaining(["cloudChatEnabled", "geminiApiKey", "chatMode"]));
  });

  it("geminiAllowed=true does not turn cloud on", () => {
    const eff = applyManagedPolicy(user({ cloudChatEnabled: false }), { geminiAllowed: true });
    expect(eff.cloudChatEnabled).toBe(false);
    expect(eff.locked).not.toContain("cloudChatEnabled");
  });

  it("blockedDomains are added to the user's blocklist (union, no duplicates)", () => {
    const eff = applyManagedPolicy(user({ blocklist: ["mine.com", "bank.example"] }), {
      blockedDomains: ["bank.example", "hr.corp"],
    });
    expect(eff.blocklist.sort()).toEqual(["bank.example", "hr.corp", "mine.com"]);
    expect(eff.managedBlocklist).toEqual(["bank.example", "hr.corp"]);
    expect(eff.locked).toContain("blocklist");
  });

  it("allowedDomainsOnly switches on allowlist-only mode with the managed list", () => {
    const eff = applyManagedPolicy(user({ allowlistOnly: false, allowlist: ["x.com"] }), {
      allowedDomainsOnly: ["wiki.corp", "docs.corp"],
    });
    expect(eff.allowlistOnly).toBe(true);
    expect(eff.allowlist).toEqual(["wiki.corp", "docs.corp"]);
    expect(eff.locked).toEqual(expect.arrayContaining(["allowlistOnly", "allowlist"]));
  });

  it("empty allowedDomainsOnly is ignored", () => {
    const eff = applyManagedPolicy(user(), { allowedDomainsOnly: [] });
    expect(eff.allowlistOnly).toBe(false);
    expect(eff.locked).toEqual([]);
  });

  it("retentionDays overrides the user value; indexingDisabled pauses; imageDescriptionsAllowed=false disables", () => {
    const eff = applyManagedPolicy(
      user({ retentionDays: 0, indexingPaused: false, imageDescriptionsEnabled: true }),
      { retentionDays: 14, indexingDisabled: true, imageDescriptionsAllowed: false }
    );
    expect(eff.retentionDays).toBe(14);
    expect(eff.indexingPaused).toBe(true);
    expect(eff.imageDescriptionsEnabled).toBe(false);
    expect(eff.locked).toEqual(
      expect.arrayContaining(["retentionDays", "indexingPaused", "imageDescriptionsEnabled"])
    );
    expect(eff.isManaged).toBe(true);
  });

  it("indexingDisabled=false does not lock the user's pause toggle", () => {
    const eff = applyManagedPolicy(user({ indexingPaused: true }), { indexingDisabled: false });
    expect(eff.indexingPaused).toBe(true);
    expect(eff.locked).not.toContain("indexingPaused");
  });
});

describe("reading chrome.storage.managed", () => {
  it("readManagedPolicy returns the normalized managed values", async () => {
    installChrome({ geminiAllowed: false, retentionDays: 7 });
    expect(await readManagedPolicy()).toEqual({ geminiAllowed: false, retentionDays: 7 });
  });

  it("readManagedPolicy returns {} when managed storage errors or is missing", async () => {
    installChrome("throws");
    expect(await readManagedPolicy()).toEqual({});
    // @ts-expect-error test
    globalThis.chrome = { storage: {}, runtime: { id: "x" } };
    expect(await readManagedPolicy()).toEqual({});
  });

  it("getEffectiveSettings merges stored user settings with the managed policy", async () => {
    installChrome(
      { indexingDisabled: true, blockedDomains: ["corp.example"] },
      { cortex_user_settings: { ...DEFAULT_USER_SETTINGS, blocklist: ["mine.test"] } }
    );
    const eff = await getEffectiveSettings();
    expect(eff.indexingPaused).toBe(true);
    expect(eff.blocklist.sort()).toEqual(["corp.example", "mine.test"]);
  });

  it("getEffectiveChatSettings never returns a Gemini key when geminiAllowed=false", async () => {
    installChrome(
      { geminiAllowed: false },
      {
        cortex_user_settings: {
          ...DEFAULT_USER_SETTINGS,
          cloudChatEnabled: true,
          geminiApiKey: "AIza-user-key",
          chatMode: "auto",
        },
      }
    );
    const chat = await getEffectiveChatSettings();
    expect(chat).toEqual({ mode: "auto", cloudEnabled: false, geminiApiKey: "", peopleEnabled: true });
  });
});
