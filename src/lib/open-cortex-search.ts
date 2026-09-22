import {
  choosePanelMode,
  panelSurfaceForGesture,
  type PanelModeDecision,
  type PanelPreference,
} from "./panel-mode";
import {
  enableSidePanelForRestrictedTab,
  openSearchSidePanelReliable,
} from "./side-panel-launcher";

export type OpenSearchOnTabOptions = {
  /** Pin the in-page overlay to the right edge instead of centring it. */
  docked?: boolean;
};

export type OpenSearchOnTabFn = (
  tabId: number,
  options?: OpenSearchOnTabOptions
) => Promise<boolean>;

export interface OpenCortexSearchOptions {
  /**
   * The stored panel preference. Anything unrecognised (including undefined)
   * is treated as "auto", which is what an un-wired caller gets today.
   */
  userPreference?: PanelPreference | string | null;
  /**
   * True when the caller still holds a user gesture (toolbar icon,
   * chrome.commands). False for a message from a content script (double
   * Shift): chrome.sidePanel.open() will throw, so injectable side-panel
   * hosts get the docked overlay instead of a popup window. Defaults to
   * true so existing callers keep today's behaviour.
   */
  userGesture?: boolean;
}

/**
 * Which surface Cortex would use for this tab, and why.
 *
 * Exported so the service worker can log or badge the decision without
 * repeating the rules. Pure — it opens nothing.
 */
export function panelModeForTab(
  tab: chrome.tabs.Tab,
  options?: OpenCortexSearchOptions
): PanelModeDecision {
  return choosePanelMode({
    url: tab?.url ?? "",
    userPreference: options?.userPreference,
  });
}

/**
 * Open Cortex for the active tab.
 *
 * In-page overlay on ordinary web pages; Chrome's side panel on pages
 * Cortex cannot be injected into (chrome://, file://, the Web Store, PDFs)
 * and on hosts that take the keyboard back from the overlay (claude.ai and
 * friends — see KEYBOARD_CAPTURING_HOSTS in ./panel-mode), when the caller
 * still holds a user gesture. Without a gesture (double Shift), those
 * injectable hosts get the same overlay docked to the right edge instead
 * of a popup window.
 *
 * `options` is optional and additive: existing callers keep compiling and
 * keep today's behaviour on every page that is not on the host list.
 */
export async function openCortexSearchForTab(
  tab: chrome.tabs.Tab,
  openSearchOnTab: OpenSearchOnTabFn,
  options?: OpenCortexSearchOptions
): Promise<void> {
  const windowId = tab.windowId;
  if (windowId == null) return;

  const tabId = tab.id;
  const url = tab.url ?? "";
  const decision = panelModeForTab(tab, options);
  const surface = panelSurfaceForGesture(
    decision,
    options?.userGesture ?? true
  );

  if (tabId != null && surface === "docked-overlay") {
    await openSearchOnTab(tabId, { docked: true });
    return;
  }

  if (tabId != null && surface === "overlay") {
    await openSearchOnTab(tabId);
    return;
  }

  if (tabId != null) {
    enableSidePanelForRestrictedTab(tabId, url);
  }
  await openSearchSidePanelReliable(windowId, tabId, url);
}
