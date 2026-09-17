/**
 * "Chats" toggle for the Ask tab. In wide layout the history sidebar is always
 * visible and the button is hidden by CSS; in medium it opens a drawer, in
 * narrow it expands a collapsible header. One control, three layouts.
 */
export interface ChatDrawerToggle {
  button: HTMLButtonElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  setCount: (n: number) => void;
}

export function createChatDrawerToggle(
  sidebar: HTMLElement,
  opts: { label: string }
): ChatDrawerToggle {
  if (!sidebar.id) sidebar.id = "cortex-chat-sidebar";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cortex-chat-drawer-toggle";
  button.setAttribute("aria-controls", sidebar.id);
  button.setAttribute("aria-expanded", "false");

  const svgNs = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNs, "svg");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
  icon.appendChild(path);

  const label = document.createElement("span");
  label.className = "cortex-chat-drawer-label";
  label.textContent = opts.label;

  const count = document.createElement("span");
  count.className = "cortex-chat-drawer-count";
  count.hidden = true;

  button.append(icon, label, count);

  let openState = false;
  const apply = (): void => {
    button.setAttribute("aria-expanded", openState ? "true" : "false");
    sidebar.classList.toggle("is-open", openState);
  };

  button.addEventListener("click", () => {
    openState = !openState;
    apply();
  });

  return {
    button,
    open: () => {
      openState = true;
      apply();
    },
    close: () => {
      openState = false;
      apply();
    },
    isOpen: () => openState,
    setCount: (n: number) => {
      if (n > 0) {
        count.textContent = String(n);
        count.hidden = false;
      } else {
        count.textContent = "";
        count.hidden = true;
      }
    },
  };
}
