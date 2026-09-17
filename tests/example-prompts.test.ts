import { describe, it, expect } from "vitest";
import {
  buildExamplePrompts,
  GENERIC_EXAMPLE_PROMPTS,
  type ExamplePromptInput,
} from "../src/content/example-prompts";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 16, 12, 0).getTime();

describe("buildExamplePrompts", () => {
  it("returns the three generic prompts on an empty library", () => {
    const out = buildExamplePrompts({ recent: [], now: NOW });
    expect(out).toHaveLength(3);
    expect(out).toEqual(GENERIC_EXAMPLE_PROMPTS.slice(0, 3));
    for (const p of out) expect(p).not.toContain("—");
  });

  it("builds three prompts from recent local titles and domains", () => {
    const input: ExamplePromptInput = {
      recent: [
        { title: "Kubernetes scheduling deep dive", hostname: "kubernetes.io", visitedAt: NOW - 3600_000 },
        { title: "Rocket radiator manufacturing", hostname: "example.org", visitedAt: NOW - 2 * DAY },
        { title: "Kubernetes taints and tolerations", hostname: "kubernetes.io", visitedAt: NOW - 3 * DAY },
        { title: "", hostname: "blank.test", visitedAt: NOW - DAY },
      ],
      now: NOW,
    };
    const out = buildExamplePrompts(input);
    expect(out).toHaveLength(3);
    // 1: about the most recent title
    expect(out[0]).toContain("Kubernetes scheduling deep dive");
    // 2: about the most visited domain
    expect(out[1]).toContain("kubernetes.io");
    // 3: time based
    expect(out[2].toLowerCase()).toMatch(/yesterday|this week|today/);
    expect(new Set(out).size).toBe(3);
    for (const p of out) {
      expect(p.length).toBeLessThanOrEqual(80);
      expect(p).not.toContain("—");
    }
  });

  it("truncates long titles and falls back to generic prompts when data is thin", () => {
    const long = "A".repeat(200);
    const out = buildExamplePrompts({
      recent: [{ title: long, hostname: "", visitedAt: NOW }],
      now: NOW,
    });
    expect(out).toHaveLength(3);
    expect(out[0].length).toBeLessThanOrEqual(80);
    expect(out[0]).toContain("...");
    // No domain available: second slot falls back to a generic prompt
    expect(GENERIC_EXAMPLE_PROMPTS).toContain(out[1]);
    expect(new Set(out).size).toBe(3);
  });
});
