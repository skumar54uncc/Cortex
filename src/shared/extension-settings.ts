/** chrome.storage.local — fast reads from SW + popup */

import type { ChatSettings } from "../lib/chat/types";
import { storageLocalGet, storageLocalSet } from "./storage-local";

export type ChatMode = ChatSettings["mode"];

export interface CortexUserSettings {
  indexingPaused: boolean;
  /** Lowercase domain fragments e.g. banking.example.com */
  blocklist: string[];
  /** When true, only index hosts listed in allowlist (advanced) */
  allowlistOnly: boolean;
  allowlist: string[];
  chatMode: ChatMode;
  cloudChatEnabled: boolean;
  geminiApiKey: string;
}

const KEY = "cortex_user_settings";

export const DEFAULT_USER_SETTINGS: CortexUserSettings = {
  indexingPaused: false,
  blocklist: [],
  allowlistOnly: false,
  allowlist: [],
  chatMode: "auto",
  cloudChatEnabled: false,
  geminiApiKey: "",
};

let memorySettings: CortexUserSettings | null = null;

function normalizeSettings(
  raw: Partial<CortexUserSettings> | undefined
): CortexUserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...raw,
    blocklist: Array.isArray(raw?.blocklist) ? raw!.blocklist : [],
    allowlist: Array.isArray(raw?.allowlist) ? raw!.allowlist : [],
    chatMode:
      raw?.chatMode === "on-device-only" ||
      raw?.chatMode === "cloud-only" ||
      raw?.chatMode === "auto"
        ? raw.chatMode
        : DEFAULT_USER_SETTINGS.chatMode,
    cloudChatEnabled: Boolean(raw?.cloudChatEnabled),
    geminiApiKey:
      typeof raw?.geminiApiKey === "string" ? raw.geminiApiKey : "",
  };
}

async function loadUserSettingsFromStorage(): Promise<CortexUserSettings> {
  const r = await storageLocalGet([KEY]);
  return normalizeSettings(r[KEY] as Partial<CortexUserSettings> | undefined);
}

try {
  const c = (globalThis as { chrome?: typeof chrome }).chrome;
  c?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    void loadUserSettingsFromStorage().then((s) => {
      memorySettings = s;
    });
  });
} catch {
  /* ignore */
}

export async function getUserSettings(): Promise<CortexUserSettings> {
  if (memorySettings) {
    return { ...memorySettings };
  }
  const loaded = await loadUserSettingsFromStorage();
  memorySettings = loaded;
  return { ...loaded };
}

export async function getChatSettings(): Promise<ChatSettings> {
  const s = await loadUserSettingsFromStorage();
  memorySettings = s;
  return {
    mode: s.chatMode,
    cloudEnabled: s.cloudChatEnabled,
    geminiApiKey: s.geminiApiKey.trim(),
  };
}

export async function setUserSettings(
  partial: Partial<CortexUserSettings>
): Promise<void> {
  const cur = await getUserSettings();
  const next = { ...cur, ...partial };
  memorySettings = next;
  await storageLocalSet({ [KEY]: next });
}
