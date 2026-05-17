import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CORTEX_DB_SCHEMA_VERSION } from "../shared/cortex-constants";
import { installChromeStorageMock } from "../../tests/helpers/chrome-storage-mock";
import {
  flushSnapshotRefreshDebounceForTests,
  onIndexCommitted,
  parseStatsSnapshot,
  resetSnapshotRefreshDebounceForTests,
  resetSnapshotRefresherForTests,
  scheduleSnapshotRefresh,
  setSnapshotRefresherForTests,
  type StatsSnapshot,
} from "./stats-snapshot";
import {
  readSnapshot,
  STATS_SNAPSHOT_STORAGE_KEY,
  writeSnapshot,
} from "./stats-snapshot-storage";

const sampleSnap: StatsSnapshot = {
  schemaVersion: CORTEX_DB_SCHEMA_VERSION,
  updatedAt: 1_700_000_000_000,
  pageCount: 42,
  chunkCount: 180,
  visitCount: 99,
  indexingPaused: false,
  recent: [
    {
      url: "https://example.com",
      title: "Example",
      visitedAt: 1_700_000_000_000,
      hostname: "example.com",
    },
  ],
};

describe("stats-snapshot storage", () => {
  let restoreChrome: () => void;

  beforeEach(() => {
    restoreChrome = installChromeStorageMock();
  });

  afterEach(() => {
    restoreChrome();
    resetSnapshotRefreshDebounceForTests();
    resetSnapshotRefresherForTests();
    vi.useRealTimers();
  });

  it("read/write round-trip", async () => {
    await writeSnapshot(sampleSnap);
    const read = await readSnapshot();
    expect(read).toEqual(sampleSnap);
  });

  it("returns null on empty storage", async () => {
    expect(await readSnapshot()).toBeNull();
  });

  it("returns null when schema version mismatches", async () => {
    await writeSnapshot({
      ...sampleSnap,
      schemaVersion: CORTEX_DB_SCHEMA_VERSION + 1,
    });
    expect(await readSnapshot()).toBeNull();
  });

  it("parseStatsSnapshot rejects invalid rows", () => {
    expect(parseStatsSnapshot({ ...sampleSnap, recent: [{}] })).toBeNull();
  });
});

describe("scheduleSnapshotRefresh debounce", () => {
  let restoreChrome: () => void;

  beforeEach(() => {
    restoreChrome = installChromeStorageMock();
    vi.useFakeTimers();
    resetSnapshotRefreshDebounceForTests();
    resetSnapshotRefresherForTests();
  });

  afterEach(() => {
    restoreChrome();
    resetSnapshotRefreshDebounceForTests();
    resetSnapshotRefresherForTests();
    vi.useRealTimers();
  });

  it("coalesces multiple calls within 30s into one refresh", async () => {
    const refresher = vi.fn().mockResolvedValue(undefined);
    setSnapshotRefresherForTests(refresher);

    scheduleSnapshotRefresh();
    scheduleSnapshotRefresh();
    scheduleSnapshotRefresh();

    expect(refresher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("onIndexCommitted schedules debounced refresh", async () => {
    const refresher = vi.fn().mockResolvedValue(undefined);
    setSnapshotRefresherForTests(refresher);

    onIndexCommitted();

    expect(refresher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("flushSnapshotRefreshDebounceForTests runs pending refresh", async () => {
    const refresher = vi.fn().mockResolvedValue(undefined);
    setSnapshotRefresherForTests(refresher);

    scheduleSnapshotRefresh();
    await flushSnapshotRefreshDebounceForTests();

    expect(refresher).toHaveBeenCalledTimes(1);
  });
});
