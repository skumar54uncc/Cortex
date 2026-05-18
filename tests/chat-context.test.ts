import { describe, expect, it } from "vitest";
import {
  selectHistoryForPrompt,
  type ChatHistoryTurn,
} from "../src/lib/chat/context-builder";

describe("selectHistoryForPrompt", () => {
  it("keeps recent turns within budget", () => {
    const turns: ChatHistoryTurn[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "follow up" },
    ];
    const picked = selectHistoryForPrompt(turns, 500);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked[picked.length - 1]?.content).toContain("follow");
  });
});
