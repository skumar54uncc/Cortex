export type ChatMode = "auto" | "on-device-only" | "cloud-only";

export interface ChatSettings {
  mode: ChatMode;
  cloudEnabled: boolean;
  geminiApiKey: string;
}
