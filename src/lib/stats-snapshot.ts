import {
  chunkCount,
  db,
  documentCount,
  getRecentVisits,
} from "../db/schema";
import { getUserSettings } from "../shared/extension-settings";
import { describeTabForPopup } from "./stats-tab-context";
import { CORTEX_DB_SCHEMA_VERSION } from "../shared/cortex-constants";
import type { StatsSnapshot } from "./stats-snapshot-types";
import { writeSnapshot } from "./stats-snapshot-storage";

export type {
  StatsSnapshot,
  StatsSnapshotCurrentTab,
  StatsSnapshotVisitRow,
} from "./stats-snapshot-types";

export {
  STATS_SNAPSHOT_STORAGE_KEY,
  isSnapshotStale,
  parseStatsSnapshot,
} from "./stats-snapshot-types";

export { readSnapshot, writeSnapshot } from "./stats-snapshot-storage";

export interface ComputeFreshSnapshotOptions {
  tabUrl?: string;
  tabIncognito?: boolean;
}

const DEBOUNCE_MS = 30_000;

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<StatsSnapshot> | null = null;

async function storageEstimate(): Promise<StorageEstimate | undefined> {
  try {
    return await navigator.storage?.estimate?.();
  } catch {
    return undefined;
  }
}

export async function computeFreshSnapshot(
  opts?: ComputeFreshSnapshotOptions
): Promise<StatsSnapshot> {
  const [pages, chunksN, visitCount, recent, settings, est] = await Promise.all([
    documentCount(),
    chunkCount(),
    db.visitLog.count(),
    getRecentVisits(12),
    getUserSettings(),
    storageEstimate(),
  ]);

  let storageBytes: number | undefined;
  let storageQuotaBytes: number | undefined;
  if (est && typeof est.usage === "number") storageBytes = est.usage;
  if (est && typeof est.quota === "number") storageQuotaBytes = est.quota;

  const snap: StatsSnapshot = {
    schemaVersion: CORTEX_DB_SCHEMA_VERSION,
    updatedAt: Date.now(),
    pageCount: pages,
    chunkCount: chunksN,
    visitCount,
    storageBytes,
    storageQuotaBytes,
    indexingPaused: settings.indexingPaused,
    recent: recent.map((v) => ({
      url: v.url,
      title: v.title,
      visitedAt: v.visitedAt,
      hostname: v.hostname,
    })),
  };

  const tabUrl = opts?.tabUrl;
  if (typeof tabUrl === "string" && tabUrl.length > 0) {
    const tabIncognito = Boolean(opts?.tabIncognito);
    const ctx = await describeTabForPopup(tabUrl, tabIncognito, settings);
    snap.currentTab = {
      line: ctx.line,
      badge: ctx.badge,
      tabUrl,
      tabIncognito,
    };
  }

  return snap;
}

type SnapshotRefresher = () => Promise<void>;

let snapshotRefresher: SnapshotRefresher = async () => {
  const snap = await computeFreshSnapshot();
  await writeSnapshot(snap);
};

export function setSnapshotRefresherForTests(fn: SnapshotRefresher): void {
  snapshotRefresher = fn;
}

export function resetSnapshotRefresherForTests(): void {
  snapshotRefresher = async () => {
    const snap = await computeFreshSnapshot();
    await writeSnapshot(snap);
  };
}

async function runDebouncedRefresh(): Promise<void> {
  try {
    await snapshotRefresher();
  } catch {
    /* best-effort */
  }
}

export function scheduleSnapshotRefresh(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void runDebouncedRefresh();
  }, DEBOUNCE_MS);
}

export function onIndexCommitted(): void {
  scheduleSnapshotRefresh();
}

export async function refreshSnapshotNow(
  opts?: ComputeFreshSnapshotOptions
): Promise<StatsSnapshot> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const snap = await computeFreshSnapshot(opts);
    await writeSnapshot(snap);
    return snap;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function resetSnapshotRefreshDebounceForTests(): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
}

export async function flushSnapshotRefreshDebounceForTests(): Promise<void> {
  if (debounceTimer === undefined) return;
  clearTimeout(debounceTimer);
  debounceTimer = undefined;
  await runDebouncedRefresh();
}
