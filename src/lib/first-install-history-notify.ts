import type { HistoryImportProgress } from "./history-import";

const NOTIFY_ID_START = "cortex-first-history-scan";
const NOTIFY_ID_DONE = "cortex-first-history-scan-done";

function iconUrl(): string {
  return chrome.runtime.getURL("icons/icon-128.png");
}

function safeCreate(
  id: string,
  options: chrome.notifications.NotificationOptions<true>
): void {
  try {
    chrome.notifications.create(id, options, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* notifications unavailable */
  }
}

export function notifyFirstInstallHistoryScanStarted(): void {
  safeCreate(NOTIFY_ID_START, {
    type: "basic",
    iconUrl: iconUrl(),
    title: "Cortex — building your library",
    message:
      "Scanning the last 30 days of browser history on this device. Privacy rules still apply. We'll notify you when it's done.",
    priority: 1,
  });
}

export function notifyFirstInstallHistoryScanFinished(
  progress: HistoryImportProgress
): void {
  try {
    chrome.notifications.clear(NOTIFY_ID_START, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* ignore */
  }

  let message: string;
  if (progress.error) {
    message = `History scan stopped: ${progress.error}. Open Settings to try again.`;
  } else if (progress.indexed > 0) {
    message = `Indexed ${progress.indexed} page${progress.indexed === 1 ? "" : "s"} from your last 30 days (${progress.skipped} skipped). Press Ctrl+Shift+K to search.`;
  } else {
    message = `Scan finished (${progress.processed} URLs tried, ${progress.indexed} indexed). Many sites need a live visit — browse normally and Cortex will index as you read.`;
  }

  safeCreate(NOTIFY_ID_DONE, {
    type: "basic",
    iconUrl: iconUrl(),
    title: "Cortex — history scan complete",
    message,
    priority: 1,
  });
}
