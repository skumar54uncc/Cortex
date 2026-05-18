/** Open Cortex in the side panel on chrome:// and other non-injectable pages. */

import { devLog } from "./extension-logger";

export const SEARCH_SHELL_PATH = "search-shell.html";

export function isSidePanelApiAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.sidePanel?.open);
}

export function configureSidePanelBehavior(): void {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
}

function shellPageUrl(): string {
  return chrome.runtime.getURL(SEARCH_SHELL_PATH);
}

/** Focus an existing search-shell tab/window instead of opening a duplicate. */
async function focusExistingShellSurface(): Promise<boolean> {
  try {
    const url = shellPageUrl();
    const tabs = await chrome.tabs.query({ url });
    const tab = tabs[0];
    if (tab?.id == null || tab.windowId == null) return false;
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    return true;
  } catch {
    return false;
  }
}

async function openFallbackWindow(): Promise<void> {
  if (await focusExistingShellSurface()) return;
  void chrome.windows.create({
    url: shellPageUrl(),
    type: "popup",
    width: 780,
    height: 860,
    focused: true,
  });
}

function sidePanelSetOptions(
  opts: chrome.sidePanel.PanelOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.sidePanel!.setOptions(opts, () => {
      const err = chrome.runtime.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve();
    });
  });
}

function sidePanelOpen(opts: chrome.sidePanel.OpenOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.sidePanel!.open(opts, () => {
      const err = chrome.runtime.lastError;
      if (err?.message) reject(new Error(err.message));
      else resolve();
    });
  });
}

/** One-time: default panel document for the extension. */
export function enableGlobalSidePanel(): void {
  if (!isSidePanelApiAvailable()) return;
  chrome.sidePanel.setOptions(
    { path: SEARCH_SHELL_PATH, enabled: true },
    () => void chrome.runtime.lastError
  );
}

/** Allow sidePanel.open() on chrome://, edge://, etc. for this tab. */
export function enableSidePanelForRestrictedTab(
  tabId: number,
  url: string | undefined
): void {
  if (!isSidePanelApiAvailable()) return;
  if (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  ) {
    return;
  }
  chrome.sidePanel.setOptions(
    {
      tabId,
      path: SEARCH_SHELL_PATH,
      enabled: true,
    },
    () => void chrome.runtime.lastError
  );
}

/**
 * Open side panel on chrome:// and other non-injectable pages.
 * Falls back to a single popup window only if the panel cannot open.
 */
export async function openSearchSidePanelReliable(
  windowId: number,
  tabId?: number,
  url?: string
): Promise<void> {
  if (tabId != null) {
    enableSidePanelForRestrictedTab(tabId, url);
  }

  if (!isSidePanelApiAvailable()) {
    await openFallbackWindow();
    return;
  }

  const panelOpts: chrome.sidePanel.OpenOptions = { windowId };
  if (tabId != null) panelOpts.tabId = tabId;

  const setOpts: chrome.sidePanel.PanelOptions = {
    path: SEARCH_SHELL_PATH,
    enabled: true,
  };
  if (tabId != null) setOpts.tabId = tabId;

  try {
    await sidePanelOpen(panelOpts);
    return;
  } catch (e) {
    devLog.warn("[Cortex] sidePanel open:", e);
  }

  try {
    await sidePanelSetOptions(setOpts);
    await sidePanelOpen(panelOpts);
    return;
  } catch (e) {
    devLog.warn("[Cortex] sidePanel configure:", e);
  }

  await openFallbackWindow();
}

/** @deprecated Use openSearchSidePanelReliable — kept for sync call sites */
export function openSearchSidePanelSync(
  windowId: number,
  tabId?: number
): void {
  void openSearchSidePanelReliable(windowId, tabId);
}
