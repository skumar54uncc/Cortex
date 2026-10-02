/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_PROMPT_TEMPLATES,
  AGENTS_INTRO_BODY,
  AGENTS_SHEET_RULES,
  AGENTS_STEPS,
  AGENTS_TAB_LABEL,
  getAgentPrompt,
} from "../src/shared/agent-prompts";
import { renderAgentsView } from "../src/content/agents-view";

describe("agent prompts", () => {
  it("exposes Connect AI Agents tab label", () => {
    expect(AGENTS_TAB_LABEL).toBe("Connect AI Agents");
  });

  it("teaches live sheet use and forbids backup archives", () => {
    const blob = [
      AGENTS_INTRO_BODY,
      ...AGENTS_STEPS,
      ...AGENTS_SHEET_RULES,
      ...AGENT_PROMPT_TEMPLATES.map((t) => t.prompt),
    ].join("\n");
    expect(blob).toMatch(/Cortex Memory/);
    expect(blob).toMatch(/live/i);
    expect(blob).toMatch(/Content/);
    expect(blob).toMatch(/About/);
    expect(blob.toLowerCase()).toMatch(/json backup|monthly archive/);
    expect(blob).not.toMatch(/\u2014/);
  });

  it("includes Claude, ChatGPT, Gemini, and Cursor-style templates", () => {
    const ids = AGENT_PROMPT_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["claude", "chatgpt", "gemini", "cursor", "generic"])
    );
    expect(getAgentPrompt("claude")?.prompt.length).toBeGreaterThan(80);
  });
});

describe("agents view", () => {
  it("renders steps, rules, and Assist Sync deep link", () => {
    const host = document.createElement("div");
    const open = vi.fn();
    renderAgentsView(host, { openAssistSyncSettings: open });
    expect(host.textContent).toContain("Connect AI agents");
    expect(host.querySelectorAll("[data-agent]").length).toBe(
      AGENT_PROMPT_TEMPLATES.length
    );
    const btn = host.querySelector<HTMLButtonElement>("[data-cortex-open-assist-sync]");
    expect(btn).toBeTruthy();
    btn!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Copy prompt");
    expect(host.querySelector(".cortex-agents-prompt")).toBeTruthy();
  });
});
