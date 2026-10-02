import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("overlay Agents tab wiring", () => {
  it("registers agents mode next to People and uses shared label", () => {
    const overlay = readFileSync(
      join(__dirname, "..", "src", "content", "overlay.ts"),
      "utf8"
    );
    expect(overlay).toMatch(/"agents"/);
    expect(overlay).toContain("Connect AI Agents");
    expect(overlay).toContain("agents-view");
    expect(overlay).toContain("renderAgentsView");
    expect(overlay).toContain('openExtensionOptionsFromOverlay("cx-sec-assistant")');
    // People tab still present; Agents follows in rebuildTabs.
    const tabsBlock = overlay.slice(
      overlay.indexOf("function rebuildTabs"),
      overlay.indexOf("let askSidebarListEl")
    );
    expect(tabsBlock.indexOf("people")).toBeLessThan(tabsBlock.indexOf("agents"));
    expect(tabsBlock).toContain("Connect AI Agents");
  });

  it("service worker whitelists Assist Sync options section", () => {
    const sw = readFileSync(
      join(__dirname, "..", "src", "background", "service-worker.ts"),
      "utf8"
    );
    const block = sw.slice(
      sw.indexOf('type === "CORTEX_OPEN_OPTIONS"'),
      sw.indexOf('type === "CORTEX_OPEN_OPTIONS"') + 800
    );
    expect(block).toContain("cx-sec-assistant");
    expect(block).toContain("options.html#");
  });
});
