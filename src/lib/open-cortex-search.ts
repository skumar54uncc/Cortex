import { isInjectableWebUrl } from "./injectable-url";
import {
  enableSidePanelForRestrictedTab,
  openSearchSidePanelReliable,
} from "./side-panel-launcher";

export type OpenSearchOnTabFn = (tabId: number) => Promise<boolean>;

/**
 * Open Cortex for the active tab: in-page overlay on http(s), side panel / popup on chrome://.
 */
export async function openCortexSearchForTab(
  tab: chrome.tabs.Tab,
  openSearchOnTab: OpenSearchOnTabFn
): Promise<void> {
  const windowId = tab.windowId;
  if (windowId == null) return;

  const tabId = tab.id;
  const url = tab.url ?? "";

  if (tabId != null && isInjectableWebUrl(url)) {
    await openSearchOnTab(tabId);
    return;
  }

  if (tabId != null) {
    enableSidePanelForRestrictedTab(tabId, url);
  }
  await openSearchSidePanelReliable(windowId, tabId, url);
}
