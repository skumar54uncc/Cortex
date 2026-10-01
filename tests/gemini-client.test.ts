import { describe, expect, it, vi, afterEach } from "vitest";
import { geminiStream } from "../src/lib/chat/gemini-client";

describe("geminiStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends API key in x-goog-api-key header, not the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init?.headers;
        capturedBody = String(init?.body ?? "");
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
    const sent = JSON.parse(capturedBody) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
    };
    expect(sent.generationConfig?.thinkingConfig?.thinkingLevel).toBe("low");
  });

  it("tries the next Gemini model when the first is overloaded", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes("gemini-3.8-flash")) {
          return new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 });
        }
        return new Response(
          'data: {"candidates":[{"content":{"parts":[{"text":"Your recent reading focused on codepen."}]}}]}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      })
    );

    const chunks: string[] = [];
    for await (const chunk of geminiStream("hi", { apiKey: "k" })) chunks.push(chunk);

    expect(urls[0]).toContain("gemini-3.8-flash");
    expect(urls[1]).toContain("gemini-3.5-flash");
    expect(urls).toHaveLength(2);
    expect(chunks.join("")).toContain("codepen");
  });

  it("stops on a rejected API key instead of trying another model", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response("bad key", { status: 401 });
      })
    );

    await expect(async () => {
      for await (const _chunk of geminiStream("hi", { apiKey: "k" })) {
        /* drain */
      }
    }).rejects.toThrow(/401/);
    expect(urls).toHaveLength(1);
  });

  it("says Gemini is busy after every model is overloaded, without the raw JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"UNAVAILABLE"}}', { status: 503 }))
    );

    await expect(async () => {
      for await (const _chunk of geminiStream("hi", { apiKey: "k" })) {
        /* drain */
      }
    }).rejects.toThrow(/Gemini is busy right now/);
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
