import { describe, it, expect } from "vitest";
import { SEARCH_SHELL_PATH } from "../src/lib/side-panel-launcher";

describe("side-panel-launcher", () => {
  it("uses search-shell as the panel document", () => {
    expect(SEARCH_SHELL_PATH).toBe("search-shell.html");
  });
});
