import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ChatStreamController,
  CHAT_INACTIVITY_TIMEOUT_MS,
  type ChatStreamCallbacks,
} from "../src/content/chat-stream-controller";

function makeController() {
  const sent: unknown[] = [];
  const cb: ChatStreamCallbacks = {
    onConversation: vi.fn(),
    onSources: vi.fn(),
    onToken: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onAborted: vi.fn(),
    onStateChange: vi.fn(),
  };
  const ctl = new ChatStreamController({
    send: (msg) => {
      sent.push(msg);
    },
    callbacks: cb,
    shell: false,
  });
  return { ctl, sent, cb };
}

describe("ChatStreamController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle, submit moves to streaming and sends CORTEX_CHAT_START with a requestId", () => {
    const { ctl, sent } = makeController();
    expect(ctl.state).toBe("idle");
    expect(ctl.submit("what did I read?", null)).toBe(true);
    expect(ctl.state).toBe("streaming");
    expect(sent).toHaveLength(1);
    const msg = sent[0] as { type: string; question: string; requestId: number; conversationId: number | null; shell: boolean };
    expect(msg.type).toBe("CORTEX_CHAT_START");
    expect(msg.question).toBe("what did I read?");
    expect(msg.conversationId).toBeNull();
    expect(msg.shell).toBe(false);
    expect(typeof msg.requestId).toBe("number");
  });

  it("rejects a second submit while streaming", () => {
    const { ctl, sent } = makeController();
    expect(ctl.submit("first", null)).toBe(true);
    expect(ctl.submit("second", null)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(ctl.state).toBe("streaming");
  });

  it("routes events to callbacks and ends in done", () => {
    const { ctl, cb } = makeController();
    ctl.submit("q", null);
    const id = ctl.currentRequestId!;
    ctl.handleEvent({ type: "conversation", data: { id: 7 } }, id);
    ctl.handleEvent({ type: "sources", data: { chunks: [{ id: 1 }] } }, id);
    ctl.handleEvent({ type: "token", data: "Hel" }, id);
    ctl.handleEvent({ type: "token", data: "lo" }, id);
    ctl.handleEvent({ type: "done", data: { provider: "nano" } }, id);
    expect(cb.onConversation).toHaveBeenCalledWith(7);
    expect(cb.onSources).toHaveBeenCalledWith([{ id: 1 }]);
    expect(cb.onToken).toHaveBeenNthCalledWith(1, "Hel");
    expect(cb.onToken).toHaveBeenNthCalledWith(2, "lo");
    expect(cb.onDone).toHaveBeenCalledWith({ provider: "nano" });
    expect(ctl.state).toBe("done");
    expect(ctl.submit("again", 7)).toBe(true);
  });

  it("inactivity timeout is 45s and resets on every token", () => {
    const { ctl, cb } = makeController();
    expect(CHAT_INACTIVITY_TIMEOUT_MS).toBe(45_000);
    ctl.submit("q", null);
    const id = ctl.currentRequestId!;
    vi.advanceTimersByTime(40_000);
    ctl.handleEvent({ type: "token", data: "a" }, id);
    vi.advanceTimersByTime(40_000);
    expect(ctl.state).toBe("streaming");
    expect(cb.onError).not.toHaveBeenCalled();
    ctl.handleEvent({ type: "token", data: "b" }, id);
    vi.advanceTimersByTime(44_999);
    expect(ctl.state).toBe("streaming");
    vi.advanceTimersByTime(1);
    expect(ctl.state).toBe("error");
    expect(cb.onError).toHaveBeenCalledTimes(1);
    const err = (cb.onError as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string; recoverable?: boolean };
    expect(err.message).toMatch(/no response/i);
    expect(err.recoverable).toBe(true);
  });

  it("abort() sends CORTEX_CHAT_ABORT for the active request and moves to aborted", () => {
    const { ctl, sent, cb } = makeController();
    ctl.submit("q", null);
    const id = ctl.currentRequestId!;
    ctl.abort();
    expect(ctl.state).toBe("aborted");
    expect(cb.onAborted).toHaveBeenCalledTimes(1);
    const abortMsg = sent[1] as { type: string; requestId: number; shell: boolean };
    expect(abortMsg.type).toBe("CORTEX_CHAT_ABORT");
    expect(abortMsg.requestId).toBe(id);
    // Abort when idle is a no-op
    const { ctl: idle, sent: idleSent } = makeController();
    idle.abort();
    expect(idleSent).toHaveLength(0);
    expect(idle.state).toBe("idle");
  });

  it("ignores late events after abort, after done, and events for other requestIds", () => {
    const { ctl, cb } = makeController();
    ctl.submit("q", null);
    const id = ctl.currentRequestId!;
    ctl.handleEvent({ type: "token", data: "x" }, id + 1);
    expect(cb.onToken).not.toHaveBeenCalled();
    ctl.abort();
    ctl.handleEvent({ type: "token", data: "late" }, id);
    ctl.handleEvent({ type: "done", data: {} }, id);
    expect(cb.onToken).not.toHaveBeenCalled();
    expect(cb.onDone).not.toHaveBeenCalled();
    expect(ctl.state).toBe("aborted");

    ctl.submit("q2", null);
    const id2 = ctl.currentRequestId!;
    ctl.handleEvent({ type: "done", data: {} }, id2);
    ctl.handleEvent({ type: "error", data: { message: "late error" } }, id2);
    expect(cb.onError).not.toHaveBeenCalled();
    expect(ctl.state).toBe("done");
  });

  it("timer is cleared on done and on abort (no spurious timeout later)", () => {
    const { ctl, cb } = makeController();
    ctl.submit("q", null);
    ctl.handleEvent({ type: "done", data: {} }, ctl.currentRequestId!);
    vi.advanceTimersByTime(CHAT_INACTIVITY_TIMEOUT_MS + 1);
    expect(cb.onError).not.toHaveBeenCalled();
    ctl.submit("q2", null);
    ctl.abort();
    vi.advanceTimersByTime(CHAT_INACTIVITY_TIMEOUT_MS + 1);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("error event moves to error and reports state changes in order", () => {
    const { ctl, cb } = makeController();
    ctl.submit("q", null);
    ctl.handleEvent({ type: "error", data: { message: "boom" } }, ctl.currentRequestId!);
    expect(ctl.state).toBe("error");
    expect(cb.onError).toHaveBeenCalledWith({ message: "boom" });
    const states = (cb.onStateChange as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(states).toEqual(["streaming", "error"]);
  });

  it("start failure reported by the sender moves to error", () => {
    const { ctl, cb } = makeController();
    ctl.submit("q", null);
    ctl.failStart({ message: "Too many chat requests.", userAction: "Wait." });
    expect(ctl.state).toBe("error");
    expect(cb.onError).toHaveBeenCalledWith({ message: "Too many chat requests.", userAction: "Wait." });
  });
});

describe("ChatStreamController collection scope", () => {
  it("includes collectionId in CORTEX_CHAT_START when given", () => {
    const sent: unknown[] = [];
    const ctl = new ChatStreamController({
      send: (m) => {
        sent.push(m);
      },
      shell: false,
      callbacks: {
        onConversation: () => undefined,
        onSources: () => undefined,
        onToken: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
        onAborted: () => undefined,
      },
    });
    ctl.submit("q", null, { collectionId: 4 });
    expect((sent[0] as { collectionId?: number }).collectionId).toBe(4);
    ctl.abort();
    ctl.submit("q2", null);
    expect("collectionId" in (sent[2] as object)).toBe(false);
  });
});
