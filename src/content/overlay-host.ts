/**
 * Host element of the in-page panel. Kept in its own module so the class
 * names stay unit-testable without loading overlay.ts (chrome, CSS, the
 * rest of the panel).
 */

export const OVERLAY_ROOT_ID = "cortex-overlay-root";
export const OVERLAY_HOST_SHELL_CLASS = "cortex-overlay-host--shell";
export const OVERLAY_HOST_DOCKED_CLASS = "cortex-overlay-host--docked";

/**
 * Class added to #cortex-overlay-root. Shell (the real side-panel document)
 * and docked (in-page fallback when there is no user gesture) are exclusive;
 * shell wins because that document is already the side panel.
 */
export function overlayHostModifierClass(opts: {
  shell?: boolean;
  docked?: boolean;
}): string | null {
  if (opts.shell) return OVERLAY_HOST_SHELL_CLASS;
  if (opts.docked) return OVERLAY_HOST_DOCKED_CLASS;
  return null;
}
