import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decideRoute,
  ChatUnavailableError,
} from "./llm-router";
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
