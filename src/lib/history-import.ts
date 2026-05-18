import {
  HISTORY_FETCH_MAX_BYTES,
  isHistoryFetchAllowedUrl,
} from "./history-fetch-security";
import { storageLocalGet, storageLocalSet } from "../shared/storage-local";

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
  const r = await storageLocalGet([HISTORY_IMPORT_STORAGE_KEY]);
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
  await storageLocalSet({ [HISTORY_IMPORT_STORAGE_KEY]: next });
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
  if (!isHistoryFetchAllowedUrl(url)) return null;

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

    const lenHeader = r.headers.get("content-length");
    if (lenHeader) {
      const declared = Number(lenHeader);
      if (Number.isFinite(declared) && declared > HISTORY_FETCH_MAX_BYTES) {
        return null;
      }
    }

    const body = r.body;
    if (!body) return null;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > HISTORY_FETCH_MAX_BYTES) {
        await reader.cancel().catch(() => {
          /* ignore */
        });
        return null;
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(merged);
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
/** Minimum composed text length to index a history row (title + URL + any extract). */
export const MIN_HISTORY_IMPORT_TEXT_CHARS = 12;

/** Searchable body when fetch/Readability yield little — uses history title + URL as-is. */
export function composeHistoryIndexText(
  item: { url: string; title: string },
  extractedText?: string
): string {
  const title = item.title.trim();
  const body = (extractedText ?? "").trim();
  const lines: string[] = [];
  if (title) lines.push(title);
  if (body) lines.push(body);
  try {
    const u = new URL(item.url);
    lines.push(u.hostname);
    const path = `${u.pathname}${u.search}`.trim();
    if (path && path !== "/") {
      lines.push(path.replace(/\//g, " ").replace(/\?/g, " ").trim());
    }
  } catch {
    /* ignore */
  }
  lines.push(item.url);
  return lines.join("\n\n");
}

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
