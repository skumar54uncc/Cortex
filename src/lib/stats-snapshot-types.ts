import { CORTEX_DB_SCHEMA_VERSION } from "../shared/cortex-constants";

export const STATS_SNAPSHOT_STORAGE_KEY = "cortex:stats:v1";

export type StatsSnapshotTabBadge =
  | "active"
  | "paused"
  | "blocked"
  | "skipped"
  | "indexed"
  | "neutral";

export interface StatsSnapshotVisitRow {
  url: string;
  title: string;
  visitedAt: number;
  hostname: string;
}

export interface StatsSnapshotCurrentTab {
  line: string;
  badge: StatsSnapshotTabBadge;
  tabUrl: string;
  tabIncognito: boolean;
}

export interface StatsSnapshot {
  schemaVersion: number;
  updatedAt: number;
  pageCount: number;
  chunkCount: number;
  visitCount: number;
  storageBytes?: number;
  storageQuotaBytes?: number;
  indexingPaused: boolean;
  recent: StatsSnapshotVisitRow[];
  currentTab?: StatsSnapshotCurrentTab;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isVisitRow(v: unknown): v is StatsSnapshotVisitRow {
  if (!isRecord(v)) return false;
  return (
    typeof v.url === "string" &&
    typeof v.title === "string" &&
    typeof v.visitedAt === "number" &&
    typeof v.hostname === "string"
  );
}

export function parseStatsSnapshot(raw: unknown): StatsSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== CORTEX_DB_SCHEMA_VERSION) return null;
  if (typeof raw.updatedAt !== "number") return null;
  if (typeof raw.pageCount !== "number") return null;
  if (typeof raw.chunkCount !== "number") return null;
  if (typeof raw.visitCount !== "number") return null;
  if (typeof raw.indexingPaused !== "boolean") return null;
  if (!Array.isArray(raw.recent) || !raw.recent.every(isVisitRow)) return null;

  let currentTab: StatsSnapshotCurrentTab | undefined;
  if (raw.currentTab !== undefined) {
    const ct = raw.currentTab;
    if (!isRecord(ct)) return null;
    if (
      typeof ct.line !== "string" ||
      typeof ct.badge !== "string" ||
      typeof ct.tabUrl !== "string" ||
      typeof ct.tabIncognito !== "boolean"
    ) {
      return null;
    }
    currentTab = {
      line: ct.line,
      badge: ct.badge as StatsSnapshotTabBadge,
      tabUrl: ct.tabUrl,
      tabIncognito: ct.tabIncognito,
    };
  }

  const snap: StatsSnapshot = {
    schemaVersion: raw.schemaVersion,
    updatedAt: raw.updatedAt,
    pageCount: raw.pageCount,
    chunkCount: raw.chunkCount,
    visitCount: raw.visitCount,
    indexingPaused: raw.indexingPaused,
    recent: raw.recent,
    currentTab,
  };

  if (typeof raw.storageBytes === "number") snap.storageBytes = raw.storageBytes;
  if (typeof raw.storageQuotaBytes === "number") {
    snap.storageQuotaBytes = raw.storageQuotaBytes;
  }

  return snap;
}

export const STALE_SNAPSHOT_MS = 5 * 60_000;

export function isSnapshotStale(snap: StatsSnapshot, now = Date.now()): boolean {
  return now - snap.updatedAt > STALE_SNAPSHOT_MS;
}
