/**
 * Double tap of Shift opens the Cortex panel.
 *
 * A double tap of Shift is the only keyboard shortcut. Chrome commands cannot describe a double
 * tap, so the gesture has to be recognised in the page. Shift is also held for
 * selection and pressed for every capital letter, so the rules are strict:
 *
 *   - each tap is a full press and release (keydown then keyup), and the
 *     second keydown lands within `DOUBLE_SHIFT_WINDOW_MS` of the first;
 *   - any other key pressed between the taps cancels, so Shift+A and
 *     Shift+ArrowDown never count;
 *   - a mouse press between the taps cancels, so Shift+click selection is safe;
 *   - auto-repeat from a held Shift is ignored, never a second tap;
 *   - taps inside the panel count too, so the gesture closes what it opened.
 *
 * The state is cleared on a trigger, so a third quick tap starts a fresh
 * sequence instead of firing (and toggling the panel) a second time.
 *
 * No imports on purpose: this ships inside content.js, which is injected into
 * every http(s) page and holds a 15 KB budget.
 */

/** Milliseconds allowed between the first and the second Shift keydown. */
export const DOUBLE_SHIFT_WINDOW_MS = 400;

/** Host element of the in-page panel (see openCortexOverlay in overlay.ts). */
export const CORTEX_PANEL_ROOT_ID = "cortex-overlay-root";

export interface DoubleShiftOptions {
  /**
   * Runs on a completed double tap. `panelOpen` is true when the Cortex panel
   * is already on the page, which is the toggle (close) case.
   */
  onTrigger: (panelOpen: boolean) => void;
  /** Event source; defaults to `window`. */
  target?: EventTarget;
  /** Document consulted for the panel element; defaults to `document`. */
  doc?: Document;
  /** Overrides `DOUBLE_SHIFT_WINDOW_MS`. */
  windowMs?: number;
  /** Clock, injectable so tests do not have to sleep. */
  now?: () => number;
}

/** Starts listening. The returned function removes every listener again. */
export function installDoubleShift(opts: DoubleShiftOptions): () => void {
  const target = opts.target ?? window;
  const doc = opts.doc ?? document;
  const windowMs = opts.windowMs ?? DOUBLE_SHIFT_WINDOW_MS;
  const now = opts.now ?? ((): number => Date.now());

  /** "down": first tap still held. "up": first tap finished, armed. */
  let phase: "idle" | "down" | "up" = "idle";
  let firstDownAt = 0;

  const reset = (): void => {
    phase = "idle";
  };

  const panelHost = (): Element | null => doc.getElementById(CORTEX_PANEL_ROOT_ID);

  /** A closed shadow root retargets to its host, so check the host both ways. */
  const insidePanel = (ev: Event): boolean => {
    const host = panelHost();
    if (!host) return false;
    return ev.target === host || ev.composedPath().includes(host);
  };

  const onKeyDown = (e: Event): void => {
    const ev = e as KeyboardEvent;
    if (ev.key !== "Shift") {
      reset();
      return;
    }
    // Holding Shift fires keydown over and over: one press, not two.
    if (ev.repeat) return;
    // A held Shift (as in a browser chord) is not a double tap.
    if (ev.ctrlKey || ev.altKey || ev.metaKey) {
      reset();
      return;
    }
    const at = now();
    if (phase === "up" && at - firstDownAt <= windowMs) {
      reset();
      // Inside the panel the gesture means "close it again".
      opts.onTrigger(panelHost() != null || insidePanel(ev));
      return;
    }
    // Too slow, or the first tap of a new sequence.
    phase = "down";
    firstDownAt = at;
  };

  const onKeyUp = (e: Event): void => {
    if ((e as KeyboardEvent).key !== "Shift") return;
    phase = phase === "down" ? "up" : "idle";
  };

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);
  target.addEventListener("mousedown", reset, true);
  target.addEventListener("blur", reset);

  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("keyup", onKeyUp, true);
    target.removeEventListener("mousedown", reset, true);
    target.removeEventListener("blur", reset);
  };
}

/**
 * Setting-driven installer. Returns a function that takes the current value of
 * `doubleShiftShortcutEnabled`: while it is false nothing is listening at all.
 */
export function doubleShiftSwitch(
  opts: DoubleShiftOptions
): (enabled: boolean) => void {
  let stop: (() => void) | null = null;
  return (enabled: boolean): void => {
    if (enabled === (stop != null)) return;
    if (enabled) {
      stop = installDoubleShift(opts);
      return;
    }
    stop?.();
    stop = null;
  };
}
