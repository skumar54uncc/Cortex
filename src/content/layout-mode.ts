/**
 * Responsive layout modes for the overlay panel. The panel is measured with a
 * ResizeObserver (not the viewport) so the side panel and the in-page modal
 * share one rule set. CSS keys off `data-layout` on the panel.
 */
export type LayoutMode = "wide" | "medium" | "narrow";

export const LAYOUT_WIDE_MIN_PX = 880;
export const LAYOUT_MEDIUM_MIN_PX = 560;

export function layoutModeForWidth(px: number): LayoutMode {
  if (!Number.isFinite(px) || px < LAYOUT_MEDIUM_MIN_PX) return "narrow";
  if (px < LAYOUT_WIDE_MIN_PX) return "medium";
  return "wide";
}

/** Sets `data-layout` and returns the mode; no-op when unchanged. */
export function applyLayoutForWidth(panel: Element, px: number): LayoutMode {
  const mode = layoutModeForWidth(px);
  if (panel.getAttribute("data-layout") !== mode) {
    panel.setAttribute("data-layout", mode);
  }
  return mode;
}

type ResizeObserverLike = {
  observe: (el: Element) => void;
  disconnect: () => void;
};
type ResizeObserverCtor = new (
  cb: (entries: { contentRect: { width: number } }[]) => void
) => ResizeObserverLike;

/**
 * Observe the panel width and keep `data-layout` current. Applies an initial
 * mode from `initialWidth` synchronously so the first paint is right.
 * Returns a disconnect function.
 */
export function observePanelLayout(
  panel: Element,
  initialWidth: number,
  onChange?: (mode: LayoutMode) => void,
  Ctor: ResizeObserverCtor | undefined = (globalThis as { ResizeObserver?: ResizeObserverCtor })
    .ResizeObserver
): () => void {
  let last = applyLayoutForWidth(panel, initialWidth);
  onChange?.(last);
  if (!Ctor) return () => undefined;
  const ro = new Ctor((entries) => {
    const w = entries[entries.length - 1]?.contentRect.width;
    if (typeof w !== "number") return;
    const mode = applyLayoutForWidth(panel, w);
    if (mode !== last) {
      last = mode;
      onChange?.(mode);
    }
  });
  ro.observe(panel);
  return () => ro.disconnect();
}
