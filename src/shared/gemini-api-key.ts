/**
 * S-2: Gemini API key lives outside cortex_user_settings so content scripts
 * never load it via getUserSettings().
 *
 * Runtime: chrome.storage.session with TRUSTED_CONTEXTS (SW + extension pages
 * only; content scripts cannot read session after setAccessLevel).
 * Persistence across browser restarts: dedicated chrome.storage.local key
 * read/written only by this module (never via content code paths).
 * Chat still goes overlay → SW message → offscreen; the raw key is never
 * returned to overlay/content.
 */

import { storageLocalGet, storageLocalRemove, storageLocalSet } from "./storage-local";

/** Session + local persist key name (not under cortex_user_settings). */
export const GEMINI_API_KEY_STORAGE_KEY = "cortex_gemini_api_key";

/** Legacy field inside cortex_user_settings (migrated out on first trusted read). */
export const USER_SETTINGS_STORAGE_KEY = "cortex_user_settings";

function chromeApi(): typeof chrome | undefined {
  try {
    return (globalThis as { chrome?: typeof chrome }).chrome;
  } catch {
    return undefined;
  }
}

function sessionArea(): chrome.storage.SessionStorageArea | null {
  try {
    return chromeApi()?.storage?.session ?? null;
  } catch {
    return null;
  }
}

let accessLevelPromise: Promise<void> | null = null;
let migratePromise: Promise<void> | null = null;

/** Restrict session storage to SW + extension pages (not content scripts). */
export function ensureGeminiKeyTrustedAccess(): Promise<void> {
  if (accessLevelPromise) return accessLevelPromise;
  accessLevelPromise = (async () => {
    const session = sessionArea();
    if (!session?.setAccessLevel) return;
    try {
      await session.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
    } catch {
      /* older Chrome / tests without session access-level support */
    }
  })();
  return accessLevelPromise;
}

function sessionGet(key: string): Promise<string> {
  const session = sessionArea();
  if (!session) return Promise.resolve("");
  return new Promise((resolve) => {
    try {
      session.get(key, (r) => {
        if (chromeApi()?.runtime?.lastError) {
          resolve("");
          return;
        }
        const v = (r as Record<string, unknown> | undefined)?.[key];
        resolve(typeof v === "string" ? v : "");
      });
    } catch {
      resolve("");
    }
  });
}

function sessionSet(key: string, value: string): Promise<void> {
  const session = sessionArea();
  if (!session) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      session.set({ [key]: value }, () => {
        void chromeApi()?.runtime?.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function sessionRemove(key: string): Promise<void> {
  const session = sessionArea();
  if (!session) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      session.remove(key, () => {
        void chromeApi()?.runtime?.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/**
 * Move a legacy cortex_user_settings.geminiApiKey into the secret store and
 * wipe it from the settings blob so content scripts no longer see it there.
 */
export function migrateLegacyGeminiApiKey(): Promise<void> {
  if (migratePromise) return migratePromise;
  migratePromise = (async () => {
    await ensureGeminiKeyTrustedAccess();
    try {
      const r = await storageLocalGet([USER_SETTINGS_STORAGE_KEY]);
      const raw = r[USER_SETTINGS_STORAGE_KEY] as
        | Record<string, unknown>
        | undefined;
      if (!raw || typeof raw !== "object") return;
      const legacy = raw.geminiApiKey;
      const legacyKey = typeof legacy === "string" ? legacy.trim() : "";
      if (legacyKey) {
        const existing = await readPersistedKey();
        if (!existing) {
          await writePersistedKey(legacyKey);
          await sessionSet(GEMINI_API_KEY_STORAGE_KEY, legacyKey);
        }
      }
      if ("geminiApiKey" in raw) {
        const next = { ...raw, geminiApiKey: "" };
        await storageLocalSet({ [USER_SETTINGS_STORAGE_KEY]: next });
      }
    } catch {
      /* ignore migration failures; next trusted read can retry */
      migratePromise = null;
    }
  })();
  return migratePromise;
}

async function readPersistedKey(): Promise<string> {
  const r = await storageLocalGet([GEMINI_API_KEY_STORAGE_KEY]);
  const v = r[GEMINI_API_KEY_STORAGE_KEY];
  return typeof v === "string" ? v.trim() : "";
}

async function writePersistedKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await storageLocalRemove(GEMINI_API_KEY_STORAGE_KEY);
    return;
  }
  await storageLocalSet({ [GEMINI_API_KEY_STORAGE_KEY]: trimmed });
}

/** Trusted contexts only (SW / options). Never call from content/overlay. */
export async function getGeminiApiKey(): Promise<string> {
  await ensureGeminiKeyTrustedAccess();
  await migrateLegacyGeminiApiKey();
  const fromSession = (await sessionGet(GEMINI_API_KEY_STORAGE_KEY)).trim();
  if (fromSession) return fromSession;
  const fromLocal = await readPersistedKey();
  if (fromLocal) {
    await sessionSet(GEMINI_API_KEY_STORAGE_KEY, fromLocal);
  }
  return fromLocal;
}

/** Save or clear. Empty string clears session + local persist. */
export async function setGeminiApiKey(key: string): Promise<void> {
  await ensureGeminiKeyTrustedAccess();
  await migrateLegacyGeminiApiKey();
  const trimmed = key.trim();
  if (!trimmed) {
    await sessionRemove(GEMINI_API_KEY_STORAGE_KEY);
    await writePersistedKey("");
    return;
  }
  await sessionSet(GEMINI_API_KEY_STORAGE_KEY, trimmed);
  await writePersistedKey(trimmed);
}

export async function clearGeminiApiKey(): Promise<void> {
  await setGeminiApiKey("");
}

/** Test helper: reset lazy singletons between Vitest cases. */
export function resetGeminiApiKeyStoreForTests(): void {
  accessLevelPromise = null;
  migratePromise = null;
}
