// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_USER_SETTINGS } from "../src/shared/extension-settings";

/**
 * The double Shift shortcut is on by default and is offered next to the other
 * keyboard shortcuts on the options page, through the same `data-feature`
 * wiring every other toggle uses (load and save need no extra code).
 */

const OPTIONS_DIR = join(__dirname, "..", "src", "options");
const TOGGLE_ID = "cx-feat-doubleShiftShortcutEnabled";

function loadOptionsHtml(): void {
  const html = readFileSync(join(OPTIONS_DIR, "options.html"), "utf8");
  const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
  document.body.outerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "") + "</body>";
}

describe("doubleShiftShortcutEnabled setting", () => {
  it("defaults to on", () => {
    expect(DEFAULT_USER_SETTINGS.doubleShiftShortcutEnabled).toBe(true);
  });

  it("keeps every other default untouched", () => {
    expect(DEFAULT_USER_SETTINGS.peopleMemoryEnabled).toBe(true);
    expect(DEFAULT_USER_SETTINGS.omniboxEnabled).toBe(true);
    expect(DEFAULT_USER_SETTINGS.highlightsEnabled).toBe(true);
    expect(DEFAULT_USER_SETTINGS.resurfacingEnabled).toBe(false);
    expect(DEFAULT_USER_SETTINGS.imageDescriptionsEnabled).toBe(false);
    expect(DEFAULT_USER_SETTINGS.pdfEnabled).toBe(true);
    expect(DEFAULT_USER_SETTINGS.indexingPaused).toBe(false);
    expect(DEFAULT_USER_SETTINGS.retentionDays).toBe(0);
    expect(DEFAULT_USER_SETTINGS.chatMode).toBe("auto");
  });
});

describe("options page shortcut toggle", () => {
  beforeEach(() => loadOptionsHtml());

  it("sits in the keyboard shortcuts group of the About section", () => {
    const box = document.getElementById(TOGGLE_ID);
    expect(box).not.toBeNull();
    const group = box!.closest(".cx-group");
    expect(group?.querySelector(".cx-group-title")?.textContent).toBe("Keyboard shortcuts");
    expect(box!.closest("#cx-sec-about")).not.toBeNull();
  });

  it("follows the markup the other toggles use, so options.ts wires it for free", () => {
    const box = document.getElementById(TOGGLE_ID) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.dataset.feature).toBe("doubleShiftShortcutEnabled");
    expect(box.className).toBe("cx-check-native cx-switch");
    const label = document.querySelector<HTMLLabelElement>(`label[for="${TOGGLE_ID}"]`);
    expect(label?.querySelector(".cx-field-label")?.textContent).toBe(
      "Open with a double tap of Shift"
    );
    expect(label?.querySelector(".cx-field-hint")?.textContent).toBe(
      "Tap Shift twice quickly on any page. The shortcuts above keep working."
    );
  });

  it("every data-feature box is a key of the settings object", () => {
    const keys = new Set(Object.keys(DEFAULT_USER_SETTINGS));
    const boxes = [...document.querySelectorAll<HTMLInputElement>("input[data-feature]")];
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) expect(keys.has(box.dataset.feature ?? "")).toBe(true);
  });

  it("still documents Ctrl+Shift+K and Alt+Shift+C", () => {
    const text = document.getElementById("cx-sec-about")?.textContent ?? "";
    expect(text).toContain("Ctrl");
    expect(text).toContain("Alt");
    expect(text).toContain("K");
    expect(text).toContain("C");
  });
});
