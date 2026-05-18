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
