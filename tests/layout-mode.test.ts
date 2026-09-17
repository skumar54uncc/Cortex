import { describe, it, expect } from "vitest";
import {
  layoutModeForWidth,
  LAYOUT_MEDIUM_MIN_PX,
  LAYOUT_WIDE_MIN_PX,
} from "../src/content/layout-mode";

describe("layoutModeForWidth", () => {
  it("exposes the breakpoints the CSS relies on", () => {
    expect(LAYOUT_WIDE_MIN_PX).toBe(880);
    expect(LAYOUT_MEDIUM_MIN_PX).toBe(560);
  });

  it("is wide at 880 and above", () => {
    expect(layoutModeForWidth(880)).toBe("wide");
    expect(layoutModeForWidth(881)).toBe("wide");
    expect(layoutModeForWidth(1920)).toBe("wide");
  });

  it("is medium from 560 to 879", () => {
    expect(layoutModeForWidth(560)).toBe("medium");
    expect(layoutModeForWidth(700)).toBe("medium");
    expect(layoutModeForWidth(879)).toBe("medium");
    expect(layoutModeForWidth(879.9)).toBe("medium");
  });

  it("is narrow under 560", () => {
    expect(layoutModeForWidth(559)).toBe("narrow");
    expect(layoutModeForWidth(559.9)).toBe("narrow");
    expect(layoutModeForWidth(360)).toBe("narrow");
    expect(layoutModeForWidth(0)).toBe("narrow");
  });

  it("treats invalid widths as narrow (safe default)", () => {
    expect(layoutModeForWidth(Number.NaN)).toBe("narrow");
    expect(layoutModeForWidth(-10)).toBe("narrow");
  });
});
