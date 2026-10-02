import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assistantSyncDb,
  defaultSyncEngineState,
  writeSyncEngineState,
  type SyncVisitRecord,
} from "../src/assistant-sync/db";
import { FetchDriveApi, type DriveApi, type RowRange, type StoredMemoryIds } from "../src/assistant-sync/drive-api";
import { visitRows } from "../src/assistant-sync/sheet";
import {
  backfillHistory,
  DAY_MS,
  enableAssistantSync,
  runSyncTick,
  SYNC_MISSING_MESSAGE,
  SYNC_STOPPED_MESSAGE,
  type SyncClock,
} from "../src/assistant-sync/sync-engine";

const NOW = Date.parse("2026-10-02T16:00:00.000Z");
const ZONE = "America/New_York";

class Sheets implements DriveApi {
  files = new Map<string, { name: string; trashed: boolean }>();
  tabs = new Map<string, Map<string, string[][]>>();
  appends: { tab: string; rows: string[][] }[] = [];
  deletes: { tab: string; ranges: RowRange[] }[] = [];
  attempts = 0;
  failUntil = 0;
  hardStatus: number | null = null;
  creates = 0;

  constructor() {
    this.files.set("folder", { name: "Cortex Memory", trashed: false });
    this.files.set("file", { name: "Cortex Memory", trashed: false });
    this.tabs.set("file", new Map());
  }

  private next(): string {
    return `new-${this.files.size + 1}`;
  }

  async createFolder(name: string): Promise<string> {
    this.creates += 1;
    const id = this.next();
    this.files.set(id, { name, trashed: false });
    return id;
  }

  async createSpreadsheet(name: string, _parentId: string): Promise<string> {
    this.creates += 1;
    const id = this.next();
    this.files.set(id, { name, trashed: false });
    this.tabs.set(id, new Map());
    return id;
  }

  async getFile(id: string) {
    const file = this.files.get(id);
    if (!file) return null;
    return { id, name: file.name, trashed: file.trashed };
  }

  async trashFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (file) file.trashed = true;
  }

  async writeTab(fileId: string, tab: string, rows: string[][]): Promise<void> {
    this.tabs.get(fileId)?.set(tab, rows.map((row) => [...row]));
  }

  async appendTab(fileId: string, tab: string, rows: string[][]): Promise<void> {
    this.attempts += 1;
    if (this.hardStatus != null) throw new Error(`google_${this.hardStatus}`);
    if (this.attempts <= this.failUntil) throw new Error("google_429");
    this.appends.push({ tab, rows: rows.map((row) => [...row]) });
    const map = this.tabs.get(fileId);
    const existing = map?.get(tab) ?? [];
    map?.set(tab, [...existing, ...rows.map((row) => [...row])]);
  }

  async formatHeaders(): Promise<void> {}

  async readTab(fileId: string, tab: string): Promise<string[][]> {
    return (this.tabs.get(fileId)?.get(tab) ?? []).map((row) => [...row]);
  }

  async updateRow(fileId: string, tab: string, rowIndex: number, values: string[]): Promise<void> {
    const rows = this.tabs.get(fileId)?.get(tab);
    if (rows && rowIndex >= 1) rows[rowIndex - 1] = [...values];
  }

  async deleteRows(fileId: string, tab: string, ranges: RowRange[]): Promise<void> {
    const ordered = [...ranges].sort((a, b) => b.startIndex - a.startIndex);
    this.deletes.push({ tab, ranges: ordered });
    const rows = this.tabs.get(fileId)?.get(tab) ?? [];
    for (const range of ordered) rows.splice(range.startIndex, range.endIndex - range.startIndex);
  }
}

function visit(id: string, visitedAt: number): SyncVisitRecord {
  return {
    id,
    visitedAt,
    title: id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    dwellMinutes: 12,
    maxScrollPct: 40,
    pageType: "Article",
    topics: ["vector databases"],
  };
}

function clock(sheets: Sheets, ids: StoredMemoryIds, extra: Partial<SyncClock> = {}): SyncClock {
  return {
    api: sheets,
    ids,
    now: NOW,
    timeZone: ZONE,
    fromAlarm: true,
    fromUser: false,
    sleep: async () => {},
    random: () => 0,
    ...extra,
  };
}

const READY: StoredMemoryIds = { folderId: "folder", fileId: "file" };

beforeEach(async () => {
  await assistantSyncDb.visits.clear();
  await assistantSyncDb.content.clear();
  await assistantSyncDb.searches.clear();
  await assistantSyncDb.people.clear();
  await assistantSyncDb.companies.clear();
  await assistantSyncDb.synced.clear();
  await assistantSyncDb.pending.clear();
  await assistantSyncDb.state.clear();
});

describe("sync engine", () => {
  it("appends an id once across a restart and a crash before the synced key is saved", async () => {
    const sheets = new Sheets();
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    await assistantSyncDb.visits.put(visit("v1", NOW));
    const first = await runSyncTick(clock(sheets, READY));
    expect(first.status).toBe("ready");
    expect(first.created).toBe(false);
    const second = await runSyncTick(clock(sheets, READY));
    expect(second.appended).toBe(0);
    await assistantSyncDb.synced.clear();
    await assistantSyncDb.pending.clear();
    const third = await runSyncTick(clock(sheets, READY));
    expect(third.appended).toBe(0);
    const visitAppends = sheets.appends.filter((call) => call.tab === "Visits").flatMap((call) => call.rows);
    expect(visitAppends.filter((row) => row[0] === "v1")).toHaveLength(1);
    expect(visitAppends[0]?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const daily = sheets.tabs.get("file")?.get("Daily") ?? [];
    expect(daily.filter((row) => row[0] === "2026-10-02")).toHaveLength(1);
    expect(await assistantSyncDb.pending.count()).toBe(0);
  });

  it("backs off on 429, keeps the pending row, and stops after 10 failures until the next alarm", async () => {
    const sheets = new Sheets();
    sheets.failUntil = 100;
    const sleeps: number[] = [];
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    await assistantSyncDb.visits.put(visit("v1", NOW));
    const stopped = await runSyncTick(
      clock(sheets, READY, {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      })
    );
    expect(stopped.status).toBe("stopped");
    expect(stopped.error).toBe(SYNC_STOPPED_MESSAGE);
    expect(sheets.attempts).toBe(10);
    expect(sleeps).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(await assistantSyncDb.pending.count()).toBe(1);
    const quiet = await runSyncTick(clock(sheets, READY, { fromAlarm: false, fromUser: false }));
    expect(quiet.status).toBe("stopped");
    expect(sheets.attempts).toBe(10);
    sheets.failUntil = sheets.attempts;
    const again = await runSyncTick(clock(sheets, READY, { fromAlarm: true }));
    expect(again.status).toBe("ready");
    expect(sheets.appends.filter((call) => call.tab === "Visits").flatMap((call) => call.rows)).toHaveLength(1);
    expect(await assistantSyncDb.pending.count()).toBe(0);
  });

  it("does not retry a non retryable status", async () => {
    const sheets = new Sheets();
    sheets.hardStatus = 403;
    const sleeps: number[] = [];
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    await assistantSyncDb.visits.put(visit("v1", NOW));
    const result = await runSyncTick(clock(sheets, READY, { sleep: async (ms) => { sleeps.push(ms); } }));
    expect(result.status).toBe("error");
    expect(sleeps).toEqual([]);
    expect(sheets.attempts).toBe(1);
    const state = await assistantSyncDb.state.get("engine");
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.stoppedUntilAlarm).toBe(false);
  });

  it("purges sheet rows older than the retention window and skips archives unless enabled", async () => {
    const sheets = new Sheets();
    const old = visit("old", Date.parse("2026-06-01T16:00:00.000Z"));
    const kept = visit("kept", Date.parse("2026-09-15T16:00:00.000Z"));
    await assistantSyncDb.visits.bulkPut([old, kept]);
    await assistantSyncDb.synced.bulkPut([{ key: "Visits:old" }, { key: "Visits:kept" }]);
    await sheets.writeTab("file", "Visits", visitRows([old, kept], ZONE));
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true, retentionDays: 90 });
    const result = await runSyncTick(clock(sheets, READY));
    expect(result.status).toBe("ready");
    const visits = sheets.tabs.get("file")?.get("Visits") ?? [];
    expect(visits.map((row) => row[0])).toEqual(["id", "kept"]);
    expect(sheets.deletes.find((call) => call.tab === "Visits")?.ranges).toEqual([{ startIndex: 1, endIndex: 2 }]);
    expect(await assistantSyncDb.visits.get("old")).toBeUndefined();
    expect(await assistantSyncDb.visits.get("kept")).toBeTruthy();
    const about = (sheets.tabs.get("file")?.get("About") ?? []).map((row) => row[0]);
    expect(about.at(-1)).toBe("schema_version: 3");
    expect(about.some((line) => line?.includes("Rows: 1 visits"))).toBe(true);
    expect([...sheets.files.values()].some((file) => file.name.startsWith("Cortex Memory Archive"))).toBe(false);
  });

  it("writes an archive only when the toggle is on", async () => {
    const sheets = new Sheets();
    const old = visit("old", Date.parse("2026-06-01T16:00:00.000Z"));
    await assistantSyncDb.visits.put(old);
    await assistantSyncDb.synced.put({ key: "Visits:old" });
    await sheets.writeTab("file", "Visits", visitRows([old], ZONE));
    await writeSyncEngineState({
      ...defaultSyncEngineState(),
      syncEnabled: true,
      retentionDays: 90,
      archivesEnabled: true,
    });
    await runSyncTick(clock(sheets, READY));
    expect([...sheets.files.values()].some((file) => file.name === "Cortex Memory Archive 2026-06")).toBe(true);
  });

  it("reports a missing file and does not create a replacement", async () => {
    const sheets = new Sheets();
    sheets.files.delete("file");
    await writeSyncEngineState({ ...defaultSyncEngineState(), syncEnabled: true });
    const result = await runSyncTick(clock(sheets, READY));
    expect(result.status).toBe("missing");
    expect(result.created).toBe(false);
    expect(result.error).toBe(SYNC_MISSING_MESSAGE);
    expect(sheets.creates).toBe(0);
  });

  it("accounts for backfill progress and leaves dwell and excerpts blank", async () => {
    const events: { done: number; total: number; phase: string }[] = [];
    const result = await backfillHistory({
      now: NOW,
      retentionDays: 90,
      timeZone: ZONE,
      history: [
        { id: "old", url: "https://example.com/old", title: "Old", visitedAt: NOW - 200 * DAY_MS },
        { id: "bank", url: "https://www.chase.com/account", title: "Bank", visitedAt: NOW - DAY_MS },
        { id: "a", url: "https://example.com/a?utm=1", title: "Alpha", visitedAt: NOW - 2 * DAY_MS },
        { id: "b", url: "https://www.linkedin.com/in/ada-marin/", title: "Ada", visitedAt: NOW - DAY_MS },
      ],
      people: [
        {
          profileUrl: "https://www.linkedin.com/in/ada-marin/",
          name: "Ada Marin",
          headline: "Factory software",
          company: "Tesla",
          kind: "person",
          seenAt: NOW,
        },
      ],
      onProgress: (progress) => {
        events.push(progress);
      },
    });
    expect(result).toEqual({ stored: 2, skipped: 1, total: 3 });
    expect(events[0]).toEqual({ done: 0, total: 3, phase: "reading" });
    expect(events.at(-1)).toEqual({ done: 3, total: 3, phase: "done" });
    const dones = events.map((event) => event.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(await assistantSyncDb.content.count()).toBe(0);
    expect(await assistantSyncDb.visits.get("old")).toBeUndefined();
    expect(await assistantSyncDb.visits.get("bank")).toBeUndefined();
    expect((await assistantSyncDb.visits.get("a"))?.dwellMinutes).toBeNull();
    const person = await assistantSyncDb.people.get("b");
    expect(person?.howFound).toBe("");
    expect(person?.company).toBe("Tesla");
    expect(person?.dwellMinutes).toBeNull();
  });

  it("creates a file on enable and appends each backfilled id once", async () => {
    const sheets = new Sheets();
    let ids: StoredMemoryIds = { folderId: null, fileId: null };
    const enabled = await enableAssistantSync({
      api: sheets,
      ids,
      now: NOW,
      timeZone: ZONE,
      history: [{ id: "h1", url: "https://example.com/h1", title: "History", visitedAt: NOW - DAY_MS }],
      saveIds: async (next) => {
        ids = next;
      },
      sleep: async () => {},
      random: () => 0,
    });
    expect(enabled.created).toBe(true);
    expect(enabled.tick.status).toBe("ready");
    expect(enabled.tick.appended).toBe(1);
    const again = await runSyncTick(clock(sheets, ids));
    expect(again.appended).toBe(0);
    const rows = sheets.appends.filter((call) => call.tab === "Visits").flatMap((call) => call.rows);
    expect(rows.filter((row) => row[0] === "h1")).toHaveLength(1);
    expect((await assistantSyncDb.visits.get("h1"))?.dwellMinutes).toBeNull();
  });

  it("asks Sheets to delete older rows from the bottom", async () => {
    let body = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };
    const api = new FetchDriveApi("token", fetchImpl);
    await api.deleteRows("file", "Visits", [
      { startIndex: 1, endIndex: 3 },
      { startIndex: 5, endIndex: 6 },
    ]);
    const json = JSON.parse(body) as {
      requests: { deleteDimension: { range: { sheetId: number; dimension: string; startIndex: number; endIndex: number } } }[];
    };
    expect(json.requests[0]?.deleteDimension.range.startIndex).toBe(5);
    expect(json.requests[1]?.deleteDimension.range).toMatchObject({
      sheetId: 1,
      dimension: "ROWS",
      startIndex: 1,
      endIndex: 3,
    });
  });

  it("keeps Google fetches out of the service worker", () => {
    const source = readFileSync(join(__dirname, "..", "src", "background", "service-worker.ts"), "utf8");
    expect(source).not.toContain("assistant-sync/drive-api");
    expect(source).not.toContain("assistant-sync/sync-engine");
    expect(source).not.toContain("sheets.googleapis.com");
    expect(source).toContain("CORTEX_ASSISTANT_SYNC");
    expect(source).toContain("ASSISTANT_SYNC_ALARM");
  });
});
