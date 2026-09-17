// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  resolveTheme,
  THEME_TOKENS,
  themeTokensCss,
  contrastRatio,
  applyThemeToHost,
  normalizeThemeSetting,
  type ThemeSetting,
} from "../src/shared/theme";

describe("resolveTheme", () => {
  it("honours explicit light and dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system follows prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("normalizeThemeSetting", () => {
  it("defaults to system for unknown values", () => {
    expect(normalizeThemeSetting(undefined)).toBe("system");
    expect(normalizeThemeSetting("blue")).toBe("system");
    expect(normalizeThemeSetting("dark")).toBe("dark");
    expect(normalizeThemeSetting("light")).toBe("light");
  });
});

describe("palette contrast (WCAG AA, recorded in docs/UI_DECISIONS.md)", () => {
  const pairs: Array<[keyof typeof THEME_TOKENS.light, keyof typeof THEME_TOKENS.light]> = [
    ["text", "bg"],
    ["text", "surface"],
    ["text", "surfaceInput"],
    ["textMuted", "surface"],
    ["textSubtle", "surface"],
    ["link", "surface"],
    ["accent", "surface"],
    ["accent", "bg"],
  ];
  for (const theme of ["light", "dark"] as const) {
    for (const [fg, bg] of pairs) {
      it(`${theme}: ${fg} on ${bg} >= 4.5:1`, () => {
        const ratio = contrastRatio(THEME_TOKENS[theme][fg], THEME_TOKENS[theme][bg]);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("contrastRatio matches known values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 3);
  });
});

describe("themeTokensCss", () => {
  it("emits light tokens on :host and dark tokens under :host([data-theme=dark])", () => {
    const css = themeTokensCss();
    expect(css).toContain(":host {");
    expect(css).toContain(':host([data-theme="dark"]) {');
    for (const name of ["--cx-bg", "--cx-surface", "--cx-text", "--cx-accent", "--cx-border", "--cx-link"]) {
      const count = css.split(name + ":").length - 1;
      expect(count, name).toBe(2);
    }
    expect(css).toContain(`--cx-bg: ${THEME_TOKENS.light.bg}`);
    expect(css).toContain(`--cx-bg: ${THEME_TOKENS.dark.bg}`);
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });
});

describe("applyThemeToHost", () => {
  function fakeMatchMedia(initialDark: boolean) {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const mql = {
      matches: initialDark,
      addEventListener: vi.fn((_t: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb)),
      removeEventListener: vi.fn((_t: string, cb: (e: { matches: boolean }) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      }),
    };
    return {
      matchMedia: vi.fn(() => mql),
      fire: (matches: boolean) => {
        mql.matches = matches;
        for (const l of [...listeners]) l({ matches });
      },
      listeners,
    };
  }

  it("sets data-theme from the setting and follows system changes only in system mode", () => {
    const host = document.createElement("div");
    const mm = fakeMatchMedia(false);
    const stop = applyThemeToHost(host, "system", mm.matchMedia as unknown as typeof matchMedia);
    expect(host.getAttribute("data-theme")).toBe("light");
    mm.fire(true);
    expect(host.getAttribute("data-theme")).toBe("dark");
    stop();
    mm.fire(false);
    expect(host.getAttribute("data-theme")).toBe("dark");
    expect(mm.listeners).toHaveLength(0);

    const host2 = document.createElement("div");
    const mm2 = fakeMatchMedia(true);
    const stop2 = applyThemeToHost(host2, "light" as ThemeSetting, mm2.matchMedia as unknown as typeof matchMedia);
    expect(host2.getAttribute("data-theme")).toBe("light");
    expect(mm2.listeners).toHaveLength(0);
    stop2();
  });
});
