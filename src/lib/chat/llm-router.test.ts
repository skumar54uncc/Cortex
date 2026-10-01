import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decideRoute,
  streamAnswer,
  ChatUnavailableError,
} from "./llm-router";
import { GEMINI_MODEL, GEMINI_MODELS, geminiStatusIsFallback } from "./gemini-client";
import type { ParsedQuestion } from "./question-parser";
import type { ChatSettings } from "./types";
import * as nanoClient from "./nano-client";

vi.mock("./nano-client", () => ({
  isNanoAvailable: vi.fn(),
  createNanoSession: vi.fn(),
}));

const lowQ = (raw: string): ParsedQuestion => ({
  rawQuery: raw,
  searchQuery: raw,
  intent: "general_qa",
  estimatedComplexity: "low",
});

describe("decideRoute", () => {
  beforeEach(() => {
    vi.mocked(nanoClient.isNanoAvailable).mockReset();
  });

  it("cloud-only without key throws ChatUnavailableError", async () => {
    const settings: ChatSettings = {
      mode: "cloud-only",
      cloudEnabled: false,
      geminiApiKey: "",
    };
    await expect(
      decideRoute("prompt", lowQ("hi"), settings)
    ).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it("cloud-only with key routes to cloud", async () => {
    const settings: ChatSettings = {
      mode: "cloud-only",
      cloudEnabled: true,
      geminiApiKey: "k",
    };
    const r = await decideRoute("x".repeat(100), lowQ("hi"), settings);
    expect(r.provider).toBe("cloud");
  });

  it("on-device-only without nano throws", async () => {
    vi.mocked(nanoClient.isNanoAvailable).mockResolvedValue({
      available: false,
      status: "unavailable",
      reason: "no nano",
    });
    const settings: ChatSettings = {
      mode: "on-device-only",
      cloudEnabled: false,
      geminiApiKey: "",
    };
    await expect(
      decideRoute("small", lowQ("hi"), settings)
    ).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it("on-device-only with nano routes to nano", async () => {
    vi.mocked(nanoClient.isNanoAvailable).mockResolvedValue({
      available: true,
      status: "available",
    });
    const settings: ChatSettings = {
      mode: "on-device-only",
      cloudEnabled: false,
      geminiApiKey: "",
    };
    const r = await decideRoute("small", lowQ("hi"), settings);
    expect(r.provider).toBe("nano");
  });

  it("auto: nano available + small prompt routes to nano", async () => {
    vi.mocked(nanoClient.isNanoAvailable).mockResolvedValue({
      available: true,
      status: "available",
    });
    const settings: ChatSettings = {
      mode: "auto",
      cloudEnabled: false,
      geminiApiKey: "",
    };
    const r = await decideRoute("hello", lowQ("hello"), settings);
    expect(r.provider).toBe("nano");
  });

  it("auto: huge prompt + cloud disabled throws", async () => {
    vi.mocked(nanoClient.isNanoAvailable).mockResolvedValue({
      available: true,
      status: "available",
    });
    const settings: ChatSettings = {
      mode: "auto",
      cloudEnabled: false,
      geminiApiKey: "",
    };
    const big = "x".repeat(25_000);
    await expect(decideRoute(big, lowQ("hi"), settings)).rejects.toBeInstanceOf(
      ChatUnavailableError
    );
  });

  it("auto: nano unavailable + cloud enabled routes to cloud", async () => {
    vi.mocked(nanoClient.isNanoAvailable).mockResolvedValue({
      available: false,
      status: "unavailable",
      reason: "missing",
    });
    const settings: ChatSettings = {
      mode: "auto",
      cloudEnabled: true,
      geminiApiKey: "abc",
    };
    const r = await decideRoute("hello", lowQ("hello"), settings);
    expect(r.provider).toBe("cloud");
  });
});

describe("streamAnswer abort (nano)", () => {
  it("destroys the Nano session and stops yielding when the signal aborts", async () => {
    const destroy = vi.fn();
    let pulled = 0;
    const session = {
      prompt: async function* (): AsyncIterable<string> {
        while (true) {
          pulled += 1;
          yield `t${pulled}`;
        }
      },
      destroy,
      tokensUsed: () => 0,
      tokensRemaining: () => 100,
    };
    vi.mocked(nanoClient.createNanoSession).mockResolvedValue(session);
    const ac = new AbortController();
    const settings: ChatSettings = { mode: "on-device-only", cloudEnabled: false, geminiApiKey: "" };
    const out: string[] = [];
    for await (const tok of streamAnswer("p", "sys", { provider: "nano", reason: "forced_on_device" }, settings, {
      signal: ac.signal,
    })) {
      out.push(tok);
      if (out.length === 2) ac.abort();
    }
    expect(out).toEqual(["t1", "t2"]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("Gemini model", () => {
  it("uses the flash model that new API keys can call", () => {
    expect(GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(GEMINI_MODEL).not.toContain("2.5");
  });

  it("falls through to other flash models when the first is busy or missing", () => {
    expect(GEMINI_MODELS[0]).toBe("gemini-3.8-flash");
    expect(GEMINI_MODELS).toContain("gemini-3.5-flash");
    expect(GEMINI_MODELS).toContain("gemini-3.5-flash-lite");
    expect(geminiStatusIsFallback(503)).toBe(true);
    expect(geminiStatusIsFallback(429)).toBe(true);
    expect(geminiStatusIsFallback(404)).toBe(true);
    expect(geminiStatusIsFallback(401)).toBe(false);
    expect(geminiStatusIsFallback(400)).toBe(false);
  });
});
