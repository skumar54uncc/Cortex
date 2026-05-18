/** Tab id used when Search/Ask/Digest runs in search-shell.html (side panel / extension page). */

export const CORTEX_SHELL_TAB_ID = -1;

export function isExtensionShellSender(
  sender: chrome.runtime.MessageSender
): boolean {
  const url = sender.url ?? "";
  return url.includes("search-shell.html");
}

/** Content-script tab id, or shell sentinel when the UI runs in search-shell.html. */
export function resolveOverlayTabId(
  sender: chrome.runtime.MessageSender,
  explicitShell?: boolean
): number | null {
  if (sender.tab?.id != null) return sender.tab.id;
  if (explicitShell || isExtensionShellSender(sender)) {
    return CORTEX_SHELL_TAB_ID;
  }
  return null;
}

async function deliverToSearchShell(message: object): Promise<boolean> {
  try {
    await chrome.runtime.sendMessage(message);
    return true;
  } catch {
    /* fall through */
  }

  try {
    const getContexts = chrome.runtime.getContexts;
    if (typeof getContexts !== "function") return false;
    const contexts = await getContexts({
      contextTypes: [
        chrome.runtime.ContextType.SIDE_PANEL,
        chrome.runtime.ContextType.TAB,
      ],
    });
    const shell = contexts.find((c) =>
      c.documentUrl?.includes("search-shell.html")
    );
    if (shell?.tabId == null) return false;
    await chrome.tabs.sendMessage(shell.tabId, message);
    return true;
  } catch {
    return false;
  }
}

export function deliverOverlayMessage(tabId: number, message: object): void {
  if (tabId === CORTEX_SHELL_TAB_ID) {
    void deliverToSearchShell(message);
    return;
  }
  void chrome.tabs.sendMessage(tabId, message).catch(() => {
    /* tab may not have content script */
  });
}
