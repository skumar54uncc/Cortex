import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GEMINI_API_KEY_STORAGE_KEY,
  clearGeminiApiKey,
  getGeminiApiKey,
  migrateLegacyGeminiApiKey,
  resetGeminiApiKeyStoreForTests,
  setGeminiApiKey,
} from "../src/shared/gemini-api-key";
import {
  getUserSettings,
  getUserSettingsFresh,
  resetUserSettingsMemoryForTests,
  setUserSettings,
  DEFAULT_USER_SETTINGS,
} from "../src/shared/extension-settings";
import { createChromeStorageLocalMock } from "./helpers/chrome-storage-mock";

function install(local: Record<string, unknown> = {}) {
  const mock = createChromeStorageLocalMock(local);
  globalThis.chrome = {
    storage: mock.storage,
    runtime: { id: "test", lastError: undefined },
  } as unknown as typeof chrome;
  return mock;
}

afterEach(() => {
  resetUserSettingsMemoryForTests();
  resetGeminiApiKeyStoreForTests();
  // @ts-expect-error test cleanup
  delete globalThis.chrome;
});

describe("S-2 Gemini API key isolation", () => {
  it("getUserSettings never returns a key even if legacy field is still in local storage", async () => {
    install({
      cortex_user_settings: {
        ...DEFAULT_USER_SETTINGS,
        geminiApiKey: "AIza-should-not-leak",
      },
    });
    const s = await getUserSettings();
    expect(s.geminiApiKey).toBe("");
    const fresh = await getUserSettingsFresh();
    expect(fresh.geminiApiKey).toBe("");
  });

  it("setUserSettings routes geminiApiKey to the secret store and keeps settings blob empty", async () => {
    const mock = install({
      cortex_user_settings: { ...DEFAULT_USER_SETTINGS },
    });
    await setUserSettings({ geminiApiKey: "AIza-via-settings", cloudChatEnabled: true });
    expect(await getGeminiApiKey()).toBe("AIza-via-settings");
    const all = mock.getAll();
    expect((all.cortex_user_settings as { geminiApiKey: string }).geminiApiKey).toBe("");
    expect(all[GEMINI_API_KEY_STORAGE_KEY]).toBe("AIza-via-settings");
    expect(mock.getSessionAll()[GEMINI_API_KEY_STORAGE_KEY]).toBe("AIza-via-settings");
  });

  it("migrates legacy cortex_user_settings.geminiApiKey into the secret store", async () => {
    const mock = install({
      cortex_user_settings: {
        ...DEFAULT_USER_SETTINGS,
        geminiApiKey: "AIza-legacy",
        cloudChatEnabled: true,
      },
    });
    await migrateLegacyGeminiApiKey();
    expect(await getGeminiApiKey()).toBe("AIza-legacy");
    const settings = mock.getAll().cortex_user_settings as { geminiApiKey: string };
    expect(settings.geminiApiKey).toBe("");
    expect(mock.getAll()[GEMINI_API_KEY_STORAGE_KEY]).toBe("AIza-legacy");
  });

  it("clearGeminiApiKey removes session and local persist copies", async () => {
    const mock = install({});
    await setGeminiApiKey("AIza-temp");
    await clearGeminiApiKey();
    expect(await getGeminiApiKey()).toBe("");
    expect(mock.getAll()[GEMINI_API_KEY_STORAGE_KEY]).toBeUndefined();
    expect(mock.getSessionAll()[GEMINI_API_KEY_STORAGE_KEY]).toBeUndefined();
  });

  it("content and overlay sources never import the secret store", () => {
    const contentDir = join(__dirname, "..", "src", "content");
    const files = readdirSync(contentDir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const src = readFileSync(join(contentDir, f), "utf8");
      expect(src, f).not.toMatch(/gemini-api-key/);
      expect(src, f).not.toContain(GEMINI_API_KEY_STORAGE_KEY);
    }
  });

  it("getUserSettings path in extension-settings hardcodes empty geminiApiKey", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "shared", "extension-settings.ts"),
      "utf8"
    );
    const fn = source.slice(
      source.indexOf("function normalizeSettings"),
      source.indexOf("async function loadUserSettingsFromStorage")
    );
    expect(fn).toContain('geminiApiKey: ""');
    expect(fn).not.toMatch(/raw\?\.geminiApiKey/);
  });
});
