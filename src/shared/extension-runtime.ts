/** True while this browsing context can talk to `chrome.runtime` (reload invalidates). */
export function isExtensionRuntimeAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function messageFromUnknown(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.message;
  }
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(e);
  } catch {
    return "";
  }
}

/** Collect messages from Error causes / nested failures (Chrome sometimes nests). */
function combinedMessages(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur != null; i++) {
    const m = messageFromUnknown(cur);
    if (m) parts.push(m);
    if (cur && typeof cur === "object" && "cause" in cur) {
      cur = (cur as { cause?: unknown }).cause;
    } else break;
  }
  return parts.join(" ");
}

/**
 * Extension updated/reloaded or messaging torn down — safe to ignore once UI reconnects on refresh.
 * Chrome uses several strings (not only "Extension context invalidated").
 */
export function isInvalidatedExtensionError(e: unknown): boolean {
  const msg = combinedMessages(e);
  if (!msg) return false;
  return (
    /extension context invalidated|context invalidated/i.test(msg) ||
    /receiving end does not exist|message port closed|could not establish connection|establish connection|message channel closed|the extension context has|extension has been updated|couldn't establish connection|could not load manifest/i.test(
      msg
    ) ||
    /listener indicated an asynchronous response|message channel closed before/i.test(msg)
  );
}

/**
 * Content scripts should prefer this over raw `chrome.runtime.sendMessage(message)` — the promise
 * API can omit `lastError` details; the callback always sets `chrome.runtime.lastError` on failure.
 */
export function sendRuntimeMessage<T = unknown>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T | undefined) => {
        const last = chrome.runtime.lastError;
        if (last?.message) {
          reject(new Error(last.message));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
