import type { ChatStreamEvent } from "../lib/chat/chat-engine";

/**
 * Owns the lifecycle of one Ask request at a time.
 *
 * idle -> streaming -> done | error | aborted -> (submit) -> streaming ...
 *
 * - A second submit while streaming is rejected.
 * - Every event carries the requestId it belongs to; late events from an
 *   earlier request (or after abort/done) are ignored.
 * - An inactivity timer (45s) is reset by every token so long answers on a
 *   slow model do not time out, while a hung stream still surfaces an error.
 * - abort() sends CORTEX_CHAT_ABORT so the offscreen document can cancel the
 *   Nano session or the Gemini fetch.
 */
export type ChatStreamState = "idle" | "streaming" | "done" | "error" | "aborted";

export const CHAT_INACTIVITY_TIMEOUT_MS = 45_000;

export interface ChatErrorData {
  message: string;
  userAction?: string;
  recoverable?: boolean;
}

export interface ChatStreamCallbacks {
  onConversation: (id: number) => void;
  onSources: (chunks: unknown[]) => void;
  onToken: (text: string) => void;
  onDone: (data: unknown) => void;
  onError: (data: ChatErrorData) => void;
  onAborted: () => void;
  onStateChange?: (state: ChatStreamState) => void;
}

export interface ChatStreamControllerOptions {
  send: (msg: unknown) => void;
  callbacks: ChatStreamCallbacks;
  shell: boolean;
  inactivityMs?: number;
}

let nextRequestId = 1;

export class ChatStreamController {
  private _state: ChatStreamState = "idle";
  private _requestId: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inactivityMs: number;

  constructor(private readonly opts: ChatStreamControllerOptions) {
    this.inactivityMs = opts.inactivityMs ?? CHAT_INACTIVITY_TIMEOUT_MS;
  }

  get state(): ChatStreamState {
    return this._state;
  }

  get currentRequestId(): number | null {
    return this._requestId;
  }

  get isStreaming(): boolean {
    return this._state === "streaming";
  }

  /** Returns false (and sends nothing) while a request is streaming. */
  submit(
    question: string,
    conversationId: number | null,
    scope: { collectionId?: number | null } = {}
  ): boolean {
    if (this._state === "streaming") return false;
    this._requestId = nextRequestId++;
    this.setState("streaming");
    this.armTimer();
    this.opts.send({
      type: "CORTEX_CHAT_START",
      question,
      conversationId,
      shell: this.opts.shell,
      requestId: this._requestId,
      ...(scope.collectionId != null ? { collectionId: scope.collectionId } : {}),
    });
    return true;
  }

  /** The start message itself was rejected (rate limit, too long, runtime error). */
  failStart(data: ChatErrorData): void {
    if (this._state !== "streaming") return;
    this.finish("error");
    this.opts.callbacks.onError(data);
  }

  handleEvent(ev: ChatStreamEvent, requestId: number | undefined): void {
    if (this._state !== "streaming") return;
    if (requestId !== this._requestId) return;
    const cb = this.opts.callbacks;
    switch (ev.type) {
      case "conversation":
        cb.onConversation((ev.data as { id: number }).id);
        return;
      case "sources":
        cb.onSources(((ev.data as { chunks?: unknown[] }).chunks ?? []) as unknown[]);
        return;
      case "route":
        return;
      case "token":
        this.armTimer();
        cb.onToken(String(ev.data ?? ""));
        return;
      case "done":
        this.finish("done");
        cb.onDone(ev.data);
        return;
      case "error":
        this.finish("error");
        cb.onError(ev.data as ChatErrorData);
        return;
      default:
        return;
    }
  }

  abort(): void {
    if (this._state !== "streaming") return;
    const requestId = this._requestId;
    this.finish("aborted");
    this.opts.send({
      type: "CORTEX_CHAT_ABORT",
      requestId,
      shell: this.opts.shell,
    });
    this.opts.callbacks.onAborted();
  }

  /** Overlay closing: drop timers, do not fire callbacks. */
  dispose(): void {
    this.clearTimer();
    this._state = "idle";
    this._requestId = null;
  }

  private armTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this._state !== "streaming") return;
      this.finish("error");
      this.opts.callbacks.onError({
        message: "No response from Cortex.",
        userAction: "Try again. If it keeps happening, reload the extension.",
        recoverable: true,
      });
    }, this.inactivityMs);
  }

  private clearTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private finish(state: Exclude<ChatStreamState, "idle" | "streaming">): void {
    this.clearTimer();
    this.setState(state);
  }

  private setState(state: ChatStreamState): void {
    this._state = state;
    this.opts.callbacks.onStateChange?.(state);
  }
}
