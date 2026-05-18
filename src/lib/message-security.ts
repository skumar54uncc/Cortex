/** Trust-boundary helpers for extension messaging (Security Review 1). */

/** Service worker, offscreen, options, popup — not content scripts on web pages. */
export function isPrivilegedExtensionSender(
  sender: chrome.runtime.MessageSender
): boolean {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) {
    return false;
  }
  return sender.tab == null;
}

export function isOptionsPageSender(
  sender: chrome.runtime.MessageSender
): boolean {
  const u = sender.url ?? "";
  return u.startsWith(chrome.runtime.getURL("options.html"));
}

/** Live index payloads must match the tab that sent CORTEX_INDEX. */
export function indexPayloadUrlMatchesTab(
  payloadUrl: string,
  sender: chrome.runtime.MessageSender
): boolean {
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return false;

  try {
    const a = new URL(payloadUrl);
    const b = new URL(tabUrl);
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  } catch {
    return false;
  }
}
