/** chrome.storage.local progress for options UI polling */

/** Concurrent HTTPS fetches during history backfill (bounded). */
export const HISTORY_IMPORT_FETCH_CONCURRENCY = 8;

export const HISTORY_IMPORT_STORAGE_KEY = "cortex_history_import_v1";

export interface HistoryImportProgress {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  total: number;
  processed: number;
  indexed: number;
  skipped: number;
  fetchFailed: number;
  lastUrl?: string;
  error?: string;
}

export const HISTORY_IMPORT_IDLE: HistoryImportProgress = {
  running: false,
  total: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  fetchFailed: 0,
};

export async function readHistoryImportProgress(): Promise<HistoryImportProgress> {
  const r = await chrome.storage.local.get(HISTORY_IMPORT_STORAGE_KEY);
  const v = r[HISTORY_IMPORT_STORAGE_KEY] as HistoryImportProgress | undefined;
  if (!v || typeof v !== "object") return { ...HISTORY_IMPORT_IDLE };
  return {
    ...HISTORY_IMPORT_IDLE,
    ...v,
  };
}

export async function writeHistoryImportProgress(
  patch: Partial<HistoryImportProgress>
): Promise<void> {
  const cur = await readHistoryImportProgress();
  const next: HistoryImportProgress = { ...cur, ...patch };
  await chrome.storage.local.set({ [HISTORY_IMPORT_STORAGE_KEY]: next });
}

export function historySearch(
  query: chrome.history.HistoryQuery
): Promise<chrome.history.HistoryItem[]> {
  return new Promise((resolve) => {
    chrome.history.search(query, (items) => {
      resolve(items ?? []);
    });
  });
}

export async function fetchHtmlForHistory(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/\btext\/html\b|\bapplication\/xhtml/i.test(ct)) return null;
    return await r.text();
  } catch {
    return null;
  }
}

export function normalizeWebUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Dedupe by normalized URL; keep latest visit time and best title. */
export function dedupeHistoryItems(
  items: chrome.history.HistoryItem[]
): { url: string; title: string; visitedAt: number }[] {
  const map = new Map<
    string,
    { url: string; title: string; visitedAt: number }
  >();

  for (const it of items) {
    const rawUrl = it.url;
    if (!rawUrl) continue;
    const url = normalizeWebUrl(rawUrl);
    if (!url) continue;
    const visitedAt = it.lastVisitTime ?? Date.now();
    const title = (it.title || "").trim();
    const prev = map.get(url);
    if (!prev || visitedAt >= prev.visitedAt) {
      map.set(url, {
        url,
        title:
          title ||
          prev?.title ||
          (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return url;
            }
          })(),
        visitedAt,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.visitedAt - a.visitedAt);
}
