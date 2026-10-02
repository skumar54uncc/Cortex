import { describe, expect, it } from "vitest";
import {
  appendNewRows,
  createMemoryFile,
  DRIVE_FILE_SCOPE,
  FetchDriveApi,
  inspectMemory,
  reenableMemory,
  syncIfReady,
  trashMemory,
  type DriveApi,
} from "../src/assistant-sync/drive-api";
import { buildSeed, SEED_DAYS, SEED_VISITS_PER_WEEKDAY } from "../src/assistant-sync/seed";
import {
  archiveTitle,
  buildArchiveWorkbook,
  CELL_WARN_AT,
  cellWarning,
  headerFormatRequests,
  LIVE_FOLDER_NAME,
  SHEET_TABS,
  VISIT_HEADERS,
} from "../src/assistant-sync/sheet";

class MemoryDrive implements DriveApi {
  files = new Map<string, { name: string; trashed: boolean }>();
  tabs = new Map<string, Map<string, string[][]>>();
  private n = 1;

  private next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }

  async createFolder(name: string): Promise<string> {
    const id = this.next();
    this.files.set(id, { name, trashed: false });
    return id;
  }

  async createSpreadsheet(name: string, _parentId: string): Promise<string> {
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
    if (!file) throw new Error("missing");
    file.trashed = true;
  }

  async writeTab(fileId: string, tab: string, rows: string[][]): Promise<void> {
    this.tabs.get(fileId)?.set(tab, rows.map((row) => [...row]));
  }

  async appendTab(fileId: string, tab: string, rows: string[][]): Promise<void> {
    const map = this.tabs.get(fileId);
    const existing = map?.get(tab) ?? [];
    map?.set(tab, [...existing, ...rows.map((row) => [...row])]);
  }

  async formatHeaders(): Promise<void> {}

  async readTab(): Promise<string[][]> {
    return [];
  }

  async updateRow(): Promise<void> {}

  async deleteRows(): Promise<void> {}
}

const VISIT = [
  "v1",
  "2026-10-01",
  "Thursday",
  "11:30",
  "Pinecone pricing",
  "https://example.com/articles/pinecone",
  "example.com",
  "12",
  "80",
  "Article",
  "vector databases",
];

describe("sheet layout", () => {
  it("builds the seven tabs in order with text dates and schema version 3", () => {
    expect(SEED_DAYS).toBe(90);
    expect(SEED_VISITS_PER_WEEKDAY).toBe(150);
    const { workbook, needles } = buildSeed({ days: 12, visitsPerWeekday: 2, now: Date.parse("2026-10-02T16:00:00.000Z") });
    expect(workbook.title).toBe("Cortex Memory Seed");
    expect(workbook.tabs.map((tab) => tab.title)).toEqual([...SHEET_TABS]);
    expect(workbook.tabs[0]?.rows[0]).toEqual(["Cortex Memory"]);
    expect(workbook.tabs[0]?.rows.at(-1)).toEqual(["schema_version: 3"]);
    expect(workbook.tabs[0]?.rows.some((row) => row[0]?.includes("not for assistant queries"))).toBe(true);
    expect(workbook.tabs[1]?.rows[0]).toEqual([...VISIT_HEADERS]);
    const dates = workbook.tabs[1]?.rows.slice(1).map((row) => row[1]) ?? [];
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))).toBe(true);
    const ids = workbook.tabs.flatMap((tab) => tab.rows.slice(1).map((row) => row[0]));
    for (const needle of needles) expect(ids).toContain(needle);
    expect(cellWarning(CELL_WARN_AT)).toContain("10 million");
    expect(cellWarning(10)).toBeNull();
    expect(headerFormatRequests()).toHaveLength(14);
  });

  it("skips the archive unless the toggle is on", () => {
    const { workbook } = buildSeed({ days: 3, visitsPerWeekday: 1 });
    const memory = {
      visits: [],
      content: [],
      searches: [],
      people: [],
      companies: [],
    };
    expect(buildArchiveWorkbook("2026-09", memory, { enabled: false, timeZone: "UTC", syncedAt: "2026-10-02 12:00" })).toBeNull();
    const archive = buildArchiveWorkbook("2026-09", memory, { enabled: true, timeZone: "UTC", syncedAt: "2026-10-02 12:00" });
    expect(archive?.title).toBe(archiveTitle("2026-09"));
    expect(archive?.tabs[0]?.rows[1]).toEqual(["Personal backup only. Not for assistant queries."]);
    expect(workbook.tabs[0]?.rows[2]?.[0]).toMatch(/^Rows: /);
  });
});

describe("drive memory", () => {
  it("trashes the folder, re-enables into a fresh folder, and does not duplicate rows", async () => {
    const api = new MemoryDrive();
    const created = await createMemoryFile(api, "Cortex Memory");
    expect(created.folderId && api.files.get(created.folderId)?.name).toBe(LIVE_FOLDER_NAME);
    expect(await inspectMemory(api, created)).toBe("ready");

    const synced = new Set<string>();
    const table = [["id", "date"], VISIT];
    for (const key of await appendNewRows(api, created.fileId ?? "", "Visits", table, synced)) synced.add(key);
    expect(await appendNewRows(api, created.fileId ?? "", "Visits", table, synced)).toEqual([]);

    await trashMemory(api, created);
    expect(await inspectMemory(api, created)).toBe("trashed");
    const silent = await syncIfReady(api, created);
    expect(silent.status).toBe("trashed");
    expect(silent.ids.fileId).toBe(created.fileId);

    synced.clear();
    const fresh = await reenableMemory(api, created);
    expect(fresh.fileId).not.toBe(created.fileId);
    expect(fresh.folderId).not.toBe(created.folderId);
    const appended = await appendNewRows(api, fresh.fileId ?? "", "Visits", table, synced);
    expect(appended).toEqual(["Visits:v1"]);
    for (const key of appended) synced.add(key);
    expect(await appendNewRows(api, fresh.fileId ?? "", "Visits", table, synced)).toEqual([]);
    const live = api.tabs.get(fresh.fileId ?? "")?.get("Visits") ?? [];
    expect(live.filter((row) => row[0] === "v1")).toHaveLength(1);
    expect(api.files.get(created.fileId ?? "")?.trashed).toBe(true);
    expect(api.files.get(created.folderId ?? "")?.trashed).toBe(true);
  });

  it("writes dates with RAW so Sheets does not convert them", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const body =
        url.includes("spreadsheets") && init?.method === "POST" && !url.includes("values")
          ? { spreadsheetId: "sheet-1" }
          : { id: "folder-1" };
      return new Response(JSON.stringify(body), { status: url.includes("/missing") ? 404 : 200 });
    };
    const api = new FetchDriveApi("token", fetchImpl);
    expect(await api.getFile("missing")).toBeNull();
    const ids = await api.createSpreadsheet("Cortex Memory", "folder-1");
    await api.writeTab(ids, "Visits", [["id"], ["v1", "2026-10-01"]]);
    expect(calls.some((line) => line.includes("valueInputOption=RAW"))).toBe(true);
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
});
