import {
  parseStatsSnapshot,
  STATS_SNAPSHOT_STORAGE_KEY,
  type StatsSnapshot,
} from "./stats-snapshot-types";

export { STATS_SNAPSHOT_STORAGE_KEY };
export type { StatsSnapshot } from "./stats-snapshot-types";
export { isSnapshotStale } from "./stats-snapshot-types";

export function readSnapshot(): Promise<StatsSnapshot | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STATS_SNAPSHOT_STORAGE_KEY], (r) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(parseStatsSnapshot(r[STATS_SNAPSHOT_STORAGE_KEY]));
    });
  });
}

export function writeSnapshot(snap: StatsSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STATS_SNAPSHOT_STORAGE_KEY]: snap }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}
