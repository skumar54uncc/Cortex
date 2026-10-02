/// <reference types="chrome"/>
import { FetchDriveApi, trashMemory, type DriveApi, type StoredMemoryIds } from "./drive-api";
import { enableAssistantSync, runSyncTick, type HistoryPerson, type HistoryVisit } from "./sync-engine";
import { readSyncEngineState, writeSyncEngineState } from "./db";
import { applyAssistantSyncPreferences } from "./preferences";
import { ASSISTANT_SYNC_FILE_ID, ASSISTANT_SYNC_FOLDER_ID } from "./preference-keys";
import { loadTopicVectors } from "./topics";

export { ASSISTANT_SYNC_FILE_ID, ASSISTANT_SYNC_FOLDER_ID };

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

function memoryIdStore(initial: StoredMemoryIds): MemoryIdStore & { current: () => StoredMemoryIds } {
  let ids: StoredMemoryIds = { folderId: initial.folderId, fileId: initial.fileId };
  return {
    async getIds() {
      return ids;
    },
    async setIds(next) {
      ids = { folderId: next.folderId, fileId: next.fileId };
    },
    async clearIds() {
      ids = { folderId: null, fileId: null };
    },
    current: () => ids,
  };
}

/** Offscreen entry. The service worker supplies the token and the stored ids. */
export async function trashStoredMemoryFromChrome(
  token: string,
  ids: StoredMemoryIds
): Promise<{ ok: true; skipped?: boolean }> {
  return trashStoredMemory(memoryIdStore(ids), new FetchDriveApi(token));
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
  ids?: StoredMemoryIds;
}

function plainSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "google_403" || message === "drive_folder_failed" || message === "drive_sheet_failed") {
    return "Google refused the Drive call. Enable the Google Drive API and the Google Sheets API in this Cloud project, then press Enable again.";
  }
  if (message === "google_401") {
    return "Google did not accept the sign-in. Press Enable and choose the test user account.";
  }
  if (/failed to fetch/i.test(message)) {
    return "Cortex could not reach Google. Reload the extension and press Enable again.";
  }
  return message || "Sync did not start.";
}

/** Token comes from the service worker. This function performs the Google fetches. */
export async function runAssistantSyncFromChrome(
  action: "alarm" | "now" | "enable",
  token: string,
  launch: {
    ids: StoredMemoryIds;
    retentionDays?: number;
    archivesEnabled?: boolean;
  }
): Promise<AssistantSyncWorkResult> {
  const store = memoryIdStore(launch.ids);
  try {
    const result = await runAssistantSyncWork(action, token, launch, store);
    return { ...result, ids: store.current() };
  } catch (error) {
    const message = plainSyncError(error);
    try {
      const state = await readSyncEngineState();
      await writeSyncEngineState({ ...state, lastError: message });
    } catch {
      /* The page still receives the message below. */
    }
    return { ok: false, error: message, ids: store.current() };
  }
}

async function runAssistantSyncWork(
  action: "alarm" | "now" | "enable",
  token: string,
  launch: { retentionDays?: number; archivesEnabled?: boolean },
  store: MemoryIdStore
): Promise<AssistantSyncWorkResult> {
  const api = new FetchDriveApi(token);
  const ids = await store.getIds();
  await applyAssistantSyncPreferences({
    retentionDays: launch.retentionDays,
    archivesEnabled: launch.archivesEnabled,
  });
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
