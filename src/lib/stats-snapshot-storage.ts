import {
  parseStatsSnapshot,
  STATS_SNAPSHOT_STORAGE_KEY,
  type StatsSnapshot,
} from "./stats-snapshot-types";
import { storageLocalGet, storageLocalSet } from "../shared/storage-local";

export { STATS_SNAPSHOT_STORAGE_KEY };
export type { StatsSnapshot } from "./stats-snapshot-types";
export { isSnapshotStale } from "./stats-snapshot-types";

export function readSnapshot(): Promise<StatsSnapshot | null> {
  return storageLocalGet([STATS_SNAPSHOT_STORAGE_KEY]).then((r) =>
    parseStatsSnapshot(r[STATS_SNAPSHOT_STORAGE_KEY])
  );
}

export function writeSnapshot(snap: StatsSnapshot): Promise<void> {
  return storageLocalSet({ [STATS_SNAPSHOT_STORAGE_KEY]: snap });
}
