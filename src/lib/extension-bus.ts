import type { ChatStreamEvent } from "./chat/chat-engine";
import type { DigestResult } from "./chat/digest-types";
import type { ChatSettings } from "./chat/types";

export const CORTEX_EXTENSION_BUS_CHANNEL = "cortex-extension-v1";

export type CortexBusInbound =
  | {
      kind: "chat-run";
      tabId: number;
      conversationId: number | null;
      question: string;
      settings: ChatSettings;
    }
  | {
      kind: "digest-run";
      tabId: number;
      range: "today" | "yesterday" | "last_7_days";
      forceRegenerate?: boolean;
      settings: ChatSettings;
    };

export type CortexBusOutbound =
  | { kind: "chat-event"; tabId: number; event: ChatStreamEvent }
  | { kind: "digest-done"; tabId: number; result: DigestResult }
  | { kind: "digest-error"; tabId: number; message: string };
