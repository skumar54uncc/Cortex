/// <reference types="chrome"/>
import { FetchDriveApi, getDriveToken, trashMemory, type DriveApi, type StoredMemoryIds } from "./drive-api";
import { enableAssistantSync, runSyncTick, type HistoryPerson, type HistoryVisit } from "./sync-engine";
import { readSyncEngineState } from "./db";
import { loadTopicVectors } from "./topics";

export const ASSISTANT_SYNC_FOLDER_ID = "cortex_assistant_sync_folder_id";
export const ASSISTANT_SYNC_FILE_ID = "cortex_assistant_sync_file_id";

export interface MemoryIdStore {
  getIds(): Promise<StoredMemoryIds>;
  setIds(ids: StoredMemoryIds): Promise<void>;
  clearIds(): Promise<void>;
}

/** Pulls the int8 label chunk. Called when a visit needs topics. */
export function preloadTopicVectors(): Promise<unknown> {
  return loadTopicVectors();
}

export async function trashStoredMemory(store: MemoryIdStore, api: DriveApi): Promise<{ ok: true; skipped?: boolean }> {
  const ids = await store.getIds();
  if (!ids.folderId && !ids.fileId) return { ok: true, skipped: true };
  await trashMemory(api, ids);
  await store.clearIds();
  return { ok: true };
}

function chromeIdStore(): MemoryIdStore {
  return {
    async getIds() {
      const data = await chrome.storage.local.get([ASSISTANT_SYNC_FOLDER_ID, ASSISTANT_SYNC_FILE_ID]);
      const folder = data[ASSISTANT_SYNC_FOLDER_ID];
      const file = data[ASSISTANT_SYNC_FILE_ID];
      return {
        folderId: typeof folder === "string" ? folder : null,
        fileId: typeof file === "string" ? file : null,
      };
    },
    async setIds(ids: StoredMemoryIds) {
      await chrome.storage.local.set({
        [ASSISTANT_SYNC_FOLDER_ID]: ids.folderId,
        [ASSISTANT_SYNC_FILE_ID]: ids.fileId,
      });
    },
    async clearIds() {
      await chrome.storage.local.remove([ASSISTANT_SYNC_FOLDER_ID, ASSISTANT_SYNC_FILE_ID]);
    },
  };
}

/** Offscreen entry. Fetches Google only from this document. */
export async function trashStoredMemoryFromChrome(): Promise<{ ok: true; skipped?: boolean }> {
  const token = await getDriveToken(chrome.identity, () => chrome.runtime.lastError, false);
  return trashStoredMemory(chromeIdStore(), new FetchDriveApi(token));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadCortexHistory(cutoffMs: number): Promise<{ visits: HistoryVisit[]; people: HistoryPerson[] }> {
  const { db } = await import(/* webpackChunkName: "assistant-sync-history" */ "../db/schema");
  const rows = await db.visitLog.where("visitedAt").aboveOrEqual(cutoffMs).toArray();
  const people = await db.people.toArray();
  return {
    visits: rows
      .filter((row) => row.id != null)
      .map((row) => ({
        id: `visit:${row.id}`,
        url: row.url,
        title: row.title,
        visitedAt: row.visitedAt,
      })),
    people: people.map((person) => ({
      profileUrl: person.profileUrl,
      name: person.name,
      headline: person.headline,
      company: person.company,
      kind: person.kind,
      seenAt: person.lastSeen,
    })),
  };
}

export interface AssistantSyncWorkResult {
  ok: boolean;
  error?: string;
  status?: string;
  appended?: number;
  created?: boolean;
  warning?: string;
}

/** Token comes from the service worker. This function performs the Google fetches. */
export async function runAssistantSyncFromChrome(
  action: "alarm" | "now" | "enable",
  token: string
): Promise<AssistantSyncWorkResult> {
  const api = new FetchDriveApi(token);
  const store = chromeIdStore();
  const ids = await store.getIds();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = Date.now();
  if (action === "enable") {
    const result = await enableAssistantSync({
      api,
      ids,
      now,
      timeZone,
      saveIds: (next) => store.setIds(next),
      sleep,
      loadHistory: loadCortexHistory,
    });
    return {
      ok: result.tick.status === "ready",
      status: result.tick.status,
      appended: result.tick.appended,
      created: result.created,
      error: result.tick.error,
      warning: result.tick.warning,
    };
  }
  const tick = await runSyncTick({
    api,
    ids,
    now,
    timeZone,
    fromAlarm: action === "alarm",
    fromUser: action === "now",
    sleep,
  });
  return {
    ok: tick.status === "ready",
    status: tick.status,
    appended: tick.appended,
    created: false,
    error: tick.error,
    warning: tick.warning,
  };
}

/** Live visit hook. Dwell stays blank because the extension does not measure it yet. */
export async function captureVisitFromChrome(visit: {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}): Promise<{ ok: true; stored: boolean }> {
  const state = await readSyncEngineState();
  if (!state.syncEnabled) return { ok: true, stored: false };
  const { captureFinalizedVisit } = await import(/* webpackChunkName: "assistant-sync-capture" */ "./capture");
  const result = await captureFinalizedVisit({
    id: visit.id,
    visitedAt: visit.visitedAt,
    title: visit.title,
    url: visit.url,
    dwellMinutes: null,
    maxScrollPct: null,
    pageText: null,
    pageEmbedding: null,
    hasPasswordInput: false,
    userDenylist: state.userDenylist,
    referrer: null,
    linkedInDocument: null,
    syncEnabled: true,
  });
  return { ok: true, stored: result.stored };
}
