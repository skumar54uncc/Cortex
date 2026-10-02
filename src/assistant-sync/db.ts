import Dexie, { type EntityTable } from "dexie";
import type { PageType } from "./page-type";
import type { CompanySection, HowFound } from "./linkedin-selectors";
import type { SearchEngine } from "./search-capture";

export interface SyncVisitRecord {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  domain: string;
  dwellMinutes: number | null;
  maxScrollPct: number | null;
  pageType: PageType;
  topics: string[];
}

export interface SyncContentRecord {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  topics: string[];
  excerpt: string;
}

export interface SyncSearchRecord {
  id: string;
  visitedAt: number;
  engine: SearchEngine;
  query: string;
}

export interface SyncPersonRecord {
  id: string;
  visitedAt: number;
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  howFound: HowFound | "";
  dwellMinutes: number | null;
  maxScrollPct: number | null;
}

export interface SyncCompanyRecord {
  id: string;
  visitedAt: number;
  company: string;
  sectionViewed: CompanySection | "";
  linkedinUrl: string;
  dwellMinutes: number | null;
}

/** One unsynced sheet row. Survives a restart until the append succeeds. */
export interface PendingSyncRow {
  key: string;
  tab: string;
  rowId: string;
  cells: string[];
  enqueuedAt: number;
}

export const SYNC_ENGINE_STATE_ID = "engine";
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;
export const ASSISTANT_SYNC_ALARM = "cortex-assistant-sync";
export const ASSISTANT_SYNC_ALARM_PERIOD_MIN = 15;
export const MAX_CONSECUTIVE_SYNC_FAILURES = 10;

export type BackfillPhase = "idle" | "reading" | "writing" | "done";

export interface SyncEngineState {
  id: typeof SYNC_ENGINE_STATE_ID;
  syncEnabled: boolean;
  retentionDays: number;
  archivesEnabled: boolean;
  userDenylist: string[];
  consecutiveFailures: number;
  stoppedUntilAlarm: boolean;
  lastError: string;
  backfillDone: number;
  backfillTotal: number;
  backfillPhase: BackfillPhase;
}

export function clampRetentionDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.round(days)));
}

export function defaultSyncEngineState(): SyncEngineState {
  return {
    id: SYNC_ENGINE_STATE_ID,
    syncEnabled: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    archivesEnabled: false,
    userDenylist: [],
    consecutiveFailures: 0,
    stoppedUntilAlarm: false,
    lastError: "",
    backfillDone: 0,
    backfillTotal: 0,
    backfillPhase: "idle",
  };
}

class AssistantSyncDB extends Dexie {
  visits!: EntityTable<SyncVisitRecord, "id">;
  content!: EntityTable<SyncContentRecord, "id">;
  searches!: EntityTable<SyncSearchRecord, "id">;
  people!: EntityTable<SyncPersonRecord, "id">;
  companies!: EntityTable<SyncCompanyRecord, "id">;
  /** Keys are `Tab:id`. Cleared on a full local delete. */
  synced!: EntityTable<{ key: string }, "key">;
  pending!: EntityTable<PendingSyncRow, "key">;
  state!: EntityTable<SyncEngineState, "id">;

  constructor() {
    super("cortex-assistant-sync");
    this.version(1).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
    });
    this.version(2).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
      synced: "key",
    });
    this.version(3).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
      synced: "key",
      pending: "key, tab, enqueuedAt",
      state: "id",
    });
  }
}

export const assistantSyncDb = new AssistantSyncDB();

export async function clearAssistantSyncDatabase(): Promise<void> {
  await assistantSyncDb.transaction(
    "rw",
    [
      assistantSyncDb.visits,
      assistantSyncDb.content,
      assistantSyncDb.searches,
      assistantSyncDb.people,
      assistantSyncDb.companies,
      assistantSyncDb.synced,
      assistantSyncDb.pending,
      assistantSyncDb.state,
    ],
    async () => {
      await assistantSyncDb.visits.clear();
      await assistantSyncDb.content.clear();
      await assistantSyncDb.searches.clear();
      await assistantSyncDb.people.clear();
      await assistantSyncDb.companies.clear();
      await assistantSyncDb.synced.clear();
      await assistantSyncDb.pending.clear();
      await assistantSyncDb.state.clear();
    }
  );
}

export async function readSyncEngineState(): Promise<SyncEngineState> {
  const row = await assistantSyncDb.state.get(SYNC_ENGINE_STATE_ID);
  return row ?? defaultSyncEngineState();
}

export async function writeSyncEngineState(state: SyncEngineState): Promise<void> {
  await assistantSyncDb.state.put({ ...state, id: SYNC_ENGINE_STATE_ID });
}

/** The service worker points this at the offscreen Drive client. Tests replace it. */
export type DriveFolderTrash = () => Promise<void>;

let trashDriveFolder: DriveFolderTrash = async () => {};

export function setDriveFolderTrashHandler(handler: DriveFolderTrash): void {
  trashDriveFolder = handler;
}

/**
 * Full local delete. Clears synced id tracking, then trashes the Drive folder
 * when a handler is registered. If the trash call fails, the local rows are
 * already gone and the error propagates so the caller can say Drive may remain.
 */
export async function wipeAssistantSyncOnLocalDelete(): Promise<void> {
  await clearAssistantSyncDatabase();
  await trashDriveFolder();
}
