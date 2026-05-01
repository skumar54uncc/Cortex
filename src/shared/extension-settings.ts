/** chrome.storage.local — fast reads from SW + popup */

import type { ChatSettings } from "../lib/chat/types";

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

export async function getUserSettings(): Promise<CortexUserSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY], (r) => {
      if (chrome.runtime.lastError) {
        resolve({ ...DEFAULT_USER_SETTINGS });
        return;
      }
      const raw = r[KEY] as Partial<CortexUserSettings> | undefined;
      resolve({
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
      });
    });
  });
}

export async function getChatSettings(): Promise<ChatSettings> {
  const s = await getUserSettings();
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
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [KEY]: next }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}
