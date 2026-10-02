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

class AssistantSyncDB extends Dexie {
  visits!: EntityTable<SyncVisitRecord, "id">;
  content!: EntityTable<SyncContentRecord, "id">;
  searches!: EntityTable<SyncSearchRecord, "id">;
  people!: EntityTable<SyncPersonRecord, "id">;
  companies!: EntityTable<SyncCompanyRecord, "id">;

  constructor() {
    super("cortex-assistant-sync");
    this.version(1).stores({
      visits: "id, visitedAt, domain",
      content: "id, visitedAt",
      searches: "id, visitedAt",
      people: "id, visitedAt",
      companies: "id, visitedAt",
    });
  }
}

export const assistantSyncDb = new AssistantSyncDB();

export async function clearAssistantSyncDatabase(): Promise<void> {
  await assistantSyncDb.transaction(
    "rw",
    [assistantSyncDb.visits, assistantSyncDb.content, assistantSyncDb.searches, assistantSyncDb.people, assistantSyncDb.companies],
    async () => {
      await assistantSyncDb.visits.clear();
      await assistantSyncDb.content.clear();
      await assistantSyncDb.searches.clear();
      await assistantSyncDb.people.clear();
      await assistantSyncDb.companies.clear();
    }
  );
}

/** Registered by the Drive client in a later phase. Until then this does nothing. */
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
