// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createChatDrawerToggle } from "../src/content/chat-drawer";

function setup() {
  const sidebar = document.createElement("aside");
  sidebar.id = "cortex-chat-sidebar";
  const toggle = createChatDrawerToggle(sidebar, { label: "Chats" });
  document.body.append(toggle.button, sidebar);
  return { sidebar, toggle };
}

describe("createChatDrawerToggle", () => {
  it("renders a button wired to the sidebar with aria-expanded=false", () => {
    const { sidebar, toggle } = setup();
    expect(toggle.button.tagName).toBe("BUTTON");
    expect(toggle.button.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.button.getAttribute("aria-controls")).toBe(sidebar.id);
    expect(toggle.button.textContent).toContain("Chats");
    expect(sidebar.classList.contains("is-open")).toBe(false);
  });

  it("click opens and closes the drawer and mirrors aria-expanded", () => {
    const { sidebar, toggle } = setup();
    toggle.button.click();
    expect(toggle.button.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.classList.contains("is-open")).toBe(true);
    toggle.button.click();
    expect(toggle.button.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.classList.contains("is-open")).toBe(false);
  });

  it("close() collapses the drawer (used after picking a conversation)", () => {
    const { sidebar, toggle } = setup();
    toggle.open();
    expect(sidebar.classList.contains("is-open")).toBe(true);
    toggle.close();
    expect(sidebar.classList.contains("is-open")).toBe(false);
    expect(toggle.button.getAttribute("aria-expanded")).toBe("false");
  });

  it("setCount shows the number of chats without changing the label text", () => {
    const { toggle } = setup();
    toggle.setCount(12);
    expect(toggle.button.textContent).toContain("Chats");
    expect(toggle.button.textContent).toContain("12");
    toggle.setCount(0);
    expect(toggle.button.textContent).not.toContain("12");
  });
});
