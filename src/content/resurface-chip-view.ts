/**
 * "Seen this before" chip (Phase 5.5): a small, dismissible note in a closed
 * shadow root, linking to the related page. Built with DOM APIs; the title is
 * page-derived and rendered with textContent.
 */
export const RESURFACE_CHIP_HOST_ID = "cortex-resurface-root";
export const RESURFACE_CHIP_MS = 12_000;

const CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483645; }
.chip { display: flex; align-items: center; gap: 10px; max-width: min(420px, calc(100vw - 32px));
  padding: 10px 12px; border-radius: 12px; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #1c1917; color: #f2efe9; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
.text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.label { color: #d6d3d1; font-size: 12px; }
a { color: #f4a28a; font-weight: 600; text-decoration: underline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a:focus-visible, button:focus-visible { outline: 2px solid #f4a28a; outline-offset: 2px; }
button { flex-shrink: 0; min-width: 32px; min-height: 32px; border: 1px solid rgba(255,255,255,0.3); border-radius: 8px;
  background: transparent; color: #f2efe9; font: inherit; cursor: pointer; }
@media (prefers-reduced-motion: no-preference) { .chip { animation: in 0.18s ease-out; } }
@keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

export interface ChipContent {
  title: string;
  url: string;
}

function httpUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

export function mountResurfaceChip(
  doc: Document,
  content: ChipContent
): { mounted: boolean; shadow: ShadowRoot } {
  const href = httpUrl(content.url);
  const dummy = doc.createElement("div").attachShadow({ mode: "closed" });
  if (!href) return { mounted: false, shadow: dummy };
  doc.getElementById(RESURFACE_CHIP_HOST_ID)?.remove();

  const host = doc.createElement("div");
  host.id = RESURFACE_CHIP_HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = CSS;

  const chip = doc.createElement("div");
  chip.className = "chip";
  const text = doc.createElement("div");
  text.className = "text";
  text.setAttribute("role", "status");
  const label = doc.createElement("span");
  label.className = "label";
  label.textContent = "You read something similar:";
  const link = doc.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = (content.title || new URL(href).hostname).slice(0, 200);
  text.append(label, link);

  const close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";

  let timer: ReturnType<typeof setTimeout> | null = null;
  const remove = (): void => {
    if (timer != null) clearTimeout(timer);
    host.remove();
  };
  close.addEventListener("click", remove);
  timer = setTimeout(remove, RESURFACE_CHIP_MS);

  chip.append(text, close);
  shadow.append(style, chip);
  (doc.body ?? doc.documentElement).appendChild(host);
  return { mounted: true, shadow };
}
