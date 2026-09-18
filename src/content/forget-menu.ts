/**
 * Overlay header menu for forget controls (Phase 4.3). Menu button pattern:
 * aria-haspopup, aria-expanded, arrow keys, Home/End, Escape returns focus.
 * "Forget this site" sends no hostname: the service worker takes it from the
 * sender tab, so a page cannot aim it at another site. Built with DOM APIs.
 */
type Scope = "site" | "hour" | "day" | "all";

export interface ForgetMenuOptions {
  shell: boolean;
  send: (msg: { type: "CORTEX_FORGET"; scope: Scope }) => Promise<unknown>;
  /** Called with a short status line for the live region. */
  onDone: (message: string) => void;
}

export interface ForgetMenu {
  root: HTMLElement;
  close: () => void;
}

const LABELS: Record<Scope, string> = {
  site: "Forget this site",
  hour: "Forget last hour",
  day: "Forget last day",
  all: "Forget all",
};

function describeResult(scope: Scope, res: unknown): string {
  const r = res as { ok?: boolean; site?: string; counts?: { documents?: number } } | undefined;
  if (!r?.ok) return "Could not forget that data.";
  if (scope === "all") return "Forgot everything Cortex had stored.";
  const n = r.counts?.documents ?? 0;
  const what = scope === "site" ? (r.site ?? "this site") : scope === "hour" ? "the last hour" : "the last day";
  return `Forgot ${what}: ${n} page${n === 1 ? "" : "s"} removed.`;
}

let menuSeq = 0;

export function createForgetMenu(opts: ForgetMenuOptions): ForgetMenu {
  const id = `cortex-forget-menu-${++menuSeq}`;
  const root = document.createElement("div");
  root.className = "cortex-menu";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cortex-icon-btn cortex-menu-btn";
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", id);
  btn.setAttribute("aria-label", "Forget options");
  btn.title = "Forget";
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  for (const [k, v] of Object.entries({
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(k, v);
  }
  for (const d of ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"]) {
    const p = document.createElementNS(svgNs, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  btn.appendChild(svg);

  const list = document.createElement("div");
  list.id = id;
  list.className = "cortex-menu-list";
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", "Forget");
  list.hidden = true;

  const scopes: Scope[] = opts.shell ? ["hour", "day", "all"] : ["site", "hour", "day", "all"];
  let confirmAll = false;
  const items: HTMLButtonElement[] = scopes.map((scope) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `cortex-menu-item${scope === "all" ? " cortex-menu-item--danger" : ""}`;
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.textContent = LABELS[scope];
    item.addEventListener("click", () => {
      if (scope === "all" && !confirmAll) {
        confirmAll = true;
        item.textContent = "Click again to forget everything";
        return;
      }
      close();
      void opts
        .send({ type: "CORTEX_FORGET", scope })
        .then((res) => opts.onDone(describeResult(scope, res)))
        .catch(() => opts.onDone("Could not forget that data."));
    });
    return item;
  });
  list.append(...items);

  const resetConfirm = (): void => {
    confirmAll = false;
    const all = items.find((i) => i.classList.contains("cortex-menu-item--danger"));
    if (all) all.textContent = LABELS.all;
  };

  function open(): void {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    items[0]?.focus({ preventScroll: true });
  }

  function close(returnFocus = false): void {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    resetConfirm();
    if (returnFocus) btn.focus({ preventScroll: true });
  }

  btn.addEventListener("click", () => {
    if (list.hidden) open();
    else close();
  });

  list.addEventListener("keydown", (ev) => {
    const idx = items.indexOf(ev.target as HTMLButtonElement);
    let next: number | null = null;
    if (ev.key === "ArrowDown") next = (idx + 1) % items.length;
    else if (ev.key === "ArrowUp") next = (idx - 1 + items.length) % items.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = items.length - 1;
    else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
      return;
    } else if (ev.key === "Tab") {
      close();
      return;
    }
    if (next == null) return;
    ev.preventDefault();
    items[next]?.focus({ preventScroll: true });
  });

  root.append(btn, list);
  return { root, close: () => close() };
}
