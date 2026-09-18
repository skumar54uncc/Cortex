/**
 * Focus management for the overlay dialog.
 *
 * - `getTabbable` lists keyboard reachable elements inside a root (works
 *   inside a shadow root: pass the shadow root or the panel element).
 * - `createFocusTrap` keeps Tab / Shift+Tab inside the root, pulls focus back
 *   when a page script steals it, handles Escape, and restores focus to the
 *   element that had it before the dialog opened.
 * - `focusOnceAfterTransition` runs one focus after the open transition
 *   (transitionend or a fallback timer for reduced motion), exactly once.
 */

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.hidden) return false;
    if (cur.getAttribute("aria-hidden") === "true") return false;
    const style = cur.style;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    cur = cur.parentElement;
  }
  return true;
}

export function getTabbable(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
  return all.filter((el) => {
    if (el.getAttribute("tabindex") === "-1") return false;
    if ((el as HTMLButtonElement).disabled) return false;
    return isVisible(el);
  });
}

export interface FocusTrapOptions {
  /** Element to focus again on deactivate (captured before the dialog opened). */
  restoreTo: HTMLElement | null;
  onEscape: () => void;
  /** Owner document for the focusin guard; defaults to root's document. */
  ownerDocument?: Document;
}

export interface FocusTrap {
  activate: () => void;
  deactivate: () => void;
}

/**
 * Active element as seen from inside the root's tree. For a closed shadow
 * root, `document.activeElement` only reports the host; the ShadowRoot we
 * hold a reference to still exposes its own `activeElement`.
 */
function activeElementWithin(root: HTMLElement): Element | null {
  const rootNode = root.getRootNode() as Document | ShadowRoot;
  let el: Element | null = rootNode.activeElement ?? null;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** The node a document-level listener sees for anything inside root's tree. */
function boundaryOf(root: HTMLElement): Node {
  const rootNode = root.getRootNode();
  return rootNode instanceof ShadowRoot ? rootNode.host : root;
}

const RECLAIM_LIMIT = 3;
const RECLAIM_WINDOW_MS = 1000;

export function createFocusTrap(root: HTMLElement, opts: FocusTrapOptions): FocusTrap {
  const doc = opts.ownerDocument ?? root.ownerDocument;
  let active = false;

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      opts.onEscape();
      return;
    }
    if (ev.key !== "Tab") return;
    const items = getTabbable(root);
    if (items.length === 0) {
      ev.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = activeElementWithin(root);
    if (ev.shiftKey) {
      if (current === first || !current || !root.contains(current)) {
        ev.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else if (current === last || !current || !root.contains(current)) {
      ev.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  // Pages with their own focus management (github.com) move focus back in
  // their focusin handlers. Reclaiming synchronously made the two handlers
  // re-enter each other until the stack overflowed. Reclaim after the event,
  // at most RECLAIM_LIMIT times per window, then let the page keep focus
  // until the user focuses the overlay again.
  let reclaimTimes: number[] = [];
  let yielded = false;
  let scheduled = false;
  let reclaiming = false;

  const focusIsInside = (): boolean => {
    const cur = doc.activeElement;
    return cur != null && (cur === boundaryOf(root) || root.contains(cur));
  };

  const onFocusIn = (ev: FocusEvent): void => {
    if (!active) return;
    const path = ev.composedPath();
    if (path.includes(root) || path.includes(boundaryOf(root))) {
      if (!reclaiming) {
        yielded = false;
        reclaimTimes = [];
      }
      return;
    }
    if (yielded || scheduled) return;
    const now = Date.now();
    reclaimTimes = reclaimTimes.filter((t) => now - t < RECLAIM_WINDOW_MS);
    if (reclaimTimes.length >= RECLAIM_LIMIT) {
      yielded = true;
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!active || yielded || focusIsInside()) return;
      reclaimTimes.push(Date.now());
      reclaiming = true;
      try {
        getTabbable(root)[0]?.focus({ preventScroll: true });
      } finally {
        reclaiming = false;
      }
    });
  };

  return {
    activate: () => {
      if (active) return;
      active = true;
      root.addEventListener("keydown", onKeyDown);
      doc.addEventListener("focusin", onFocusIn, true);
    },
    deactivate: () => {
      if (!active) return;
      active = false;
      root.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("focusin", onFocusIn, true);
      try {
        opts.restoreTo?.focus({ preventScroll: true });
      } catch {
        /* stale element */
      }
    },
  };
}

export function focusOnceAfterTransition(
  panel: HTMLElement,
  doFocus: () => void,
  opts: { fallbackMs?: number } = {}
): () => void {
  const fallbackMs = opts.fallbackMs ?? 260;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    if (done) return;
    done = true;
    panel.removeEventListener("transitionend", onEnd);
    if (timer != null) clearTimeout(timer);
    doFocus();
  };
  const onEnd = (): void => fire();

  panel.addEventListener("transitionend", onEnd);
  timer = setTimeout(fire, fallbackMs);

  return () => {
    done = true;
    panel.removeEventListener("transitionend", onEnd);
    if (timer != null) clearTimeout(timer);
  };
}
