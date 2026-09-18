// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyManagedLockout, MANAGED_LABEL } from "../src/options/managed-ui";
import { applyManagedPolicy } from "../src/shared/managed-policy";
import { DEFAULT_USER_SETTINGS } from "../src/shared/extension-settings";

function loadOptionsHtml(): void {
  const html = readFileSync(join(__dirname, "..", "src", "options", "options.html"), "utf8");
  const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
  document.body.outerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "") + "</body>";
}

const q = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

describe("applyManagedLockout (options page)", () => {
  beforeEach(() => loadOptionsHtml());

  it("does nothing visible without a policy", () => {
    applyManagedLockout(document, applyManagedPolicy(DEFAULT_USER_SETTINGS, {}));
    expect(q("#cx-managed-banner").hidden).toBe(true);
    expect(q<HTMLInputElement>("#cx-opt-cloud-chat").disabled).toBe(false);
    expect(document.querySelectorAll("[data-managed-note]").length).toBe(0);
  });

  it("locks every managed field, labels it 'Managed by your organization', and shows the banner", () => {
    const eff = applyManagedPolicy(
      { ...DEFAULT_USER_SETTINGS, cloudChatEnabled: true, geminiApiKey: "k" },
      {
        geminiAllowed: false,
        indexingDisabled: true,
        retentionDays: 30,
        blockedDomains: ["corp.example"],
      }
    );
    applyManagedLockout(document, eff);

    expect(MANAGED_LABEL).toBe("Managed by your organization");
    expect(q("#cx-managed-banner").hidden).toBe(false);

    const cloud = q<HTMLInputElement>("#cx-opt-cloud-chat");
    expect(cloud.disabled).toBe(true);
    expect(cloud.checked).toBe(false);
    expect(q<HTMLInputElement>("#cx-opt-gemini-key").disabled).toBe(true);
    expect(q<HTMLInputElement>("#cx-opt-gemini-key").value).toBe("");
    expect(q<HTMLInputElement>('input[name="cx-chat-mode"][value="cloud-only"]').disabled).toBe(true);
    expect(q<HTMLInputElement>('input[name="cx-chat-mode"][value="auto"]').disabled).toBe(false);

    const pause = q<HTMLButtonElement>("#cx-opt-pause-toggle");
    expect(pause.disabled).toBe(true);
    expect(pause.getAttribute("aria-checked")).toBe("true");
    expect(pause.getAttribute("aria-disabled")).toBe("true");

    const retention = q<HTMLSelectElement>("#cx-opt-retention");
    expect(retention.disabled).toBe(true);
    expect(retention.value).toBe("30");

    const managedChips = q("#cx-opt-managed-blocklist");
    expect(managedChips.hidden).toBe(false);
    expect(managedChips.textContent).toContain("corp.example");
    // Managed domains are not editable user chips and have no remove button.
    expect(managedChips.querySelectorAll("button").length).toBe(0);

    const notes = [...document.querySelectorAll<HTMLElement>("[data-managed-note]")].map((n) => n.textContent);
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const n of notes) expect(n).toBe(MANAGED_LABEL);
  });

  it("retention values that are not in the list are added as an option so the select shows the real value", () => {
    applyManagedLockout(document, applyManagedPolicy(DEFAULT_USER_SETTINGS, { retentionDays: 45 }));
    const retention = q<HTMLSelectElement>("#cx-opt-retention");
    expect(retention.value).toBe("45");
    expect(retention.selectedOptions[0].textContent).toContain("45 days");
  });

  it("is idempotent: applying twice does not duplicate notes or chips", () => {
    const eff = applyManagedPolicy(DEFAULT_USER_SETTINGS, { geminiAllowed: false, blockedDomains: ["a.corp"] });
    applyManagedLockout(document, eff);
    applyManagedLockout(document, eff);
    expect(document.querySelectorAll("[data-managed-note]").length).toBe(
      new Set([...document.querySelectorAll("[data-managed-note]")].map((n) => n.getAttribute("data-managed-note"))).size
    );
    expect(q("#cx-opt-managed-blocklist").querySelectorAll(".cx-chip").length).toBe(1);
  });
});

import { stripLockedFields } from "../src/options/managed-ui";

describe("stripLockedFields (options saves never persist managed values)", () => {
  it("drops locked fields so the user's own stored values survive", () => {
    const userS = { ...DEFAULT_USER_SETTINGS, cloudChatEnabled: true, geminiApiKey: "AIza-mine", indexingPaused: false };
    const eff = applyManagedPolicy(userS, { geminiAllowed: false, indexingDisabled: true, retentionDays: 30 });
    const out = stripLockedFields(
      { cloudChatEnabled: false, geminiApiKey: "", indexingPaused: true, retentionDays: 30, blocklist: ["mine.test"], chatMode: "auto" },
      eff,
      userS
    );
    expect(out).toEqual({ blocklist: ["mine.test"], chatMode: "auto" });
  });

  it("chatMode: keeps a real user choice, drops the forced fallback", () => {
    const userS = { ...DEFAULT_USER_SETTINGS, chatMode: "cloud-only" as const };
    const eff = applyManagedPolicy(userS, { geminiAllowed: false });
    expect(stripLockedFields({ chatMode: "on-device-only" }, eff, userS)).toEqual({});
    expect(stripLockedFields({ chatMode: "auto" }, eff, userS)).toEqual({ chatMode: "auto" });
  });

  it("blocklist: removes managed domains from what is saved as the user's own list", () => {
    const userS = { ...DEFAULT_USER_SETTINGS, blocklist: ["mine.test"] };
    const eff = applyManagedPolicy(userS, { blockedDomains: ["corp.example"] });
    expect(stripLockedFields({ blocklist: ["mine.test", "corp.example", "new.test"] }, eff, userS)).toEqual({
      blocklist: ["mine.test", "new.test"],
    });
  });
});

describe("feature toggles in options", () => {
  beforeEach(() => loadOptionsHtml());

  it("renders one labelled checkbox per Phase 5 toggle", () => {
    for (const key of [
      "peopleMemoryEnabled",
      "omniboxEnabled",
      "highlightsEnabled",
      "resurfacingEnabled",
      "youtubeTranscriptsEnabled",
      "tablesEnabled",
      "imagesEnabled",
      "imageDescriptionsEnabled",
      "pdfEnabled",
    ]) {
      const box = document.querySelector<HTMLInputElement>(`input[data-feature="${key}"]`);
      expect(box, key).not.toBeNull();
      expect(box!.type).toBe("checkbox");
      expect(box!.labels?.[0]?.textContent?.trim().length ?? 0, key).toBeGreaterThan(3);
    }
  });

  it("locks image descriptions when the policy forbids them", () => {
    applyManagedLockout(
      document,
      applyManagedPolicy({ ...DEFAULT_USER_SETTINGS, imageDescriptionsEnabled: true }, { imageDescriptionsAllowed: false })
    );
    const box = document.querySelector<HTMLInputElement>('input[data-feature="imageDescriptionsEnabled"]')!;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(document.querySelector('[data-managed-note="imageDescriptionsEnabled"]')?.textContent).toBe(MANAGED_LABEL);
  });
});
