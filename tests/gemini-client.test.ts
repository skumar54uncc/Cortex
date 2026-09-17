import { describe, expect, it, vi, afterEach } from "vitest";
import { geminiStream } from "../src/lib/chat/gemini-client";

describe("geminiStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends API key in x-goog-api-key header, not the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init?.headers;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      })
    );

    for await (const _chunk of geminiStream("hi", {
      apiKey: "AIzaSyTESTKEY123",
    })) {
      break;
    }

    expect(capturedUrl).not.toContain("AIzaSyTESTKEY123");
    expect(capturedUrl).not.toContain("key=");
    expect(capturedHeaders).toMatchObject({
      "x-goog-api-key": "AIzaSyTESTKEY123",
    });
  });
});

describe("geminiStream abort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the AbortSignal to fetch and stops yielding once aborted", async () => {
    let capturedSignal: AbortSignal | undefined;
    const ac = new AbortController();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              enc.encode('data: {"candidates":[{"content":{"parts":[{"text":"one "}]}}]}\n\n')
            );
            // Second chunk arrives only after abort: simulate by never closing.
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      })
    );

    const received: string[] = [];
    let threw: unknown = null;
    try {
      for await (const chunk of geminiStream("hi", { apiKey: "k", signal: ac.signal })) {
        received.push(chunk);
        ac.abort();
      }
    } catch (e) {
      threw = e;
    }
    expect(capturedSignal).toBe(ac.signal);
    expect(received).toEqual(["one "]);
    expect((threw as { name?: string } | null)?.name).toBe("AbortError");
  });
});
