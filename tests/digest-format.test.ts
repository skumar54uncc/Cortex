import { describe, expect, it } from "vitest";
import { personalizeDigestNarrative } from "../src/lib/chat/digest-format";

describe("personalizeDigestNarrative", () => {
  it("rewrites third-person lead-in to Your", () => {
    const out = personalizeDigestNarrative(
      "The user's recent reading focused heavily on job search at Atrium Health."
    );
    expect(out).toMatch(/^Your recent reading/i);
    expect(out).not.toMatch(/The user/i);
  });

  it("prefixes neutral narrative with Your recent reading", () => {
    const out = personalizeDigestNarrative(
      "actively searching for support operations roles."
    );
    expect(out).toBe(
      "Your recent reading focused on actively searching for support operations roles."
    );
  });
});
