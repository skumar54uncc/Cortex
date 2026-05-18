/** Last focused tab — read synchronously from chrome.commands (no async tabs.query). */

export interface ActiveTabSnapshot {
  tabId?: number;
  windowId?: number;
  url?: string;
}

let snapshot: ActiveTabSnapshot = {};

export function getActiveTabSnapshot(): Readonly<ActiveTabSnapshot> {
  return snapshot;
}

export function setActiveTabSnapshot(tab: chrome.tabs.Tab): void {
  const next: ActiveTabSnapshot = {};
  if (tab.id != null) next.tabId = tab.id;
  if (tab.windowId != null) next.windowId = tab.windowId;
  if (typeof tab.url === "string") next.url = tab.url;
  snapshot = next;
}

export function seedActiveTabSnapshot(): void {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    const tab = tabs[0];
    if (tab) setActiveTabSnapshot(tab);
  });
}

export function installActiveTabCacheListeners(): void {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    snapshot = {
      tabId: activeInfo.tabId,
      windowId: snapshot.windowId,
    };
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      setActiveTabSnapshot(tab);
    });
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!tab.active) return;
    if (changeInfo.url != null || changeInfo.status === "complete") {
      setActiveTabSnapshot(tab);
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    snapshot = { ...snapshot, windowId };
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (chrome.runtime.lastError) return;
      const tab = tabs[0];
      if (tab) setActiveTabSnapshot(tab);
    });
  });

  seedActiveTabSnapshot();
}
