export type ChatMode = "auto" | "on-device-only" | "cloud-only";

export interface ChatSettings {
  mode: ChatMode;
  cloudEnabled: boolean;
  geminiApiKey: string;
  /** People memory (Phase 5.1); undefined means on. */
  peopleEnabled?: boolean;
}
