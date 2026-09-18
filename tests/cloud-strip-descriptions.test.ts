import { describe, it, expect, vi } from "vitest";

const { gemini } = vi.hoisted(() => ({ gemini: { geminiStream: vi.fn() } }));
vi.mock("../src/lib/chat/gemini-client", () => gemini);

import { streamAnswer } from "../src/lib/chat/llm-router";
import { appendDescriptions } from "../src/lib/capture/images";

describe("Gemini never receives on-device image descriptions", () => {
  it("strips description lines from the prompt at the cloud boundary", async () => {
    gemini.geminiStream.mockImplementation(async function* () {
      yield "ok";
    });
    const chunk = appendDescriptions("Images on this page:\n- Drone over ice (Section: Survey)", [
      { src: "https://e.test/0.jpg", description: "A small aircraft above white ice." },
    ]);
    const prompt = `SOURCES:\n[1] Content: ${chunk}\n\nQuestion: what flew over the ice?`;
    const out: string[] = [];
    for await (const t of streamAnswer(prompt, "sys", { provider: "cloud", reason: "forced_cloud" }, {
      mode: "cloud-only",
      cloudEnabled: true,
      geminiApiKey: "k",
    })) {
      out.push(t);
    }
    expect(out).toEqual(["ok"]);
    const sent = gemini.geminiStream.mock.calls[0]![0] as string;
    expect(sent).not.toContain("small aircraft");
    expect(sent).not.toContain("Description (on device)");
    expect(sent).toContain("Drone over ice");
    expect(sent).toContain("what flew over the ice?");
  });
});
