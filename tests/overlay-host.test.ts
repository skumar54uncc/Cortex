import { describe, it, expect } from "vitest";
import {
  overlayHostModifierClass,
  OVERLAY_HOST_DOCKED_CLASS,
  OVERLAY_HOST_SHELL_CLASS,
} from "../src/content/overlay-host";

describe("overlayHostModifierClass", () => {
  it("is empty for the centred in-page overlay", () => {
    expect(overlayHostModifierClass({})).toBeNull();
    expect(overlayHostModifierClass({ docked: false })).toBeNull();
  });

  it("docks the in-page overlay when asked", () => {
    expect(overlayHostModifierClass({ docked: true })).toBe(
      OVERLAY_HOST_DOCKED_CLASS
    );
  });

  it("uses the shell class inside the real side-panel document", () => {
    expect(overlayHostModifierClass({ shell: true })).toBe(
      OVERLAY_HOST_SHELL_CLASS
    );
  });

  it("lets the shell win if both flags are set: that document is already the side panel", () => {
    expect(overlayHostModifierClass({ shell: true, docked: true })).toBe(
      OVERLAY_HOST_SHELL_CLASS
    );
  });
});
