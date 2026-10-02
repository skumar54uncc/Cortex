import { headerFormatRequests, SHEET_TABS, type SheetTabName, type Workbook } from "./sheet";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFileInfo {
  id: string;
  name: string;
  trashed: boolean;
}

export const DRIVE_JSON_BACKUP_NAME = "Cortex Memory Backup.json";

export interface DriveApi {
  createFolder(name: string): Promise<string>;
  createSpreadsheet(name: string, parentId: string): Promise<string>;
  getFile(id: string): Promise<DriveFileInfo | null>;
  trashFile(id: string): Promise<void>;
  writeTab(fileId: string, tab: SheetTabName, rows: string[][]): Promise<void>;
  appendTab(fileId: string, tab: SheetTabName, rows: string[][]): Promise<void>;
  formatHeaders(fileId: string): Promise<void>;
  readTab(fileId: string, tab: SheetTabName): Promise<string[][]>;
  updateRow(fileId: string, tab: SheetTabName, rowIndex: number, values: string[]): Promise<void>;
  deleteRows(fileId: string, tab: SheetTabName, ranges: RowRange[]): Promise<void>;
  /** Create or replace the JSON backup file in the Cortex Memory folder. */
  upsertJsonFile(name: string, parentId: string, body: string, existingId: string | null): Promise<string>;
}

export interface RowRange {
  startIndex: number;
  endIndex: number;
}

export type DriveMemoryStatus = "absent" | "ready" | "missing" | "trashed";

export interface StoredMemoryIds {
  folderId: string | null;
  fileId: string | null;
}

/** Never creates a file. A missing or trashed id stays missing until the user asks. */
export async function inspectMemory(api: DriveApi, ids: StoredMemoryIds): Promise<DriveMemoryStatus> {
  if (!ids.folderId || !ids.fileId) return "absent";
  const folder = await api.getFile(ids.folderId);
  const file = await api.getFile(ids.fileId);
  if (!folder || !file) return "missing";
  if (folder.trashed || file.trashed) return "trashed";
  return "ready";
}

/** Explicit create. Used on first enable and on re-enable after a delete. Not used by a timer. */
export async function createMemoryFile(
  api: DriveApi,
  title: string,
  folderName = "Cortex Memory"
): Promise<StoredMemoryIds> {
  const folderId = await api.createFolder(folderName);
  const fileId = await api.createSpreadsheet(title, folderId);
  await api.formatHeaders(fileId);
  return { folderId, fileId };
}

export async function writeWorkbook(api: DriveApi, fileId: string, workbook: Workbook): Promise<void> {
  for (const tab of workbook.tabs) {
    await api.writeTab(fileId, tab.title, tab.rows);
  }
}

/**
 * Append data rows whose id is not already in `synced`.
 * Header rows are not appended. The caller stores the returned keys.
 */
export function rowsToAppend(tab: SheetTabName, rows: string[][], synced: ReadonlySet<string>): string[][] {
  const header = tab === "Daily" ? "date" : "id";
  const fresh: string[][] = [];
  for (const row of rows) {
    const id = row[0] ?? "";
    if (!id || id === header) continue;
    if (synced.has(syncedKey(tab, id))) continue;
    fresh.push(row);
  }
  return fresh;
}

export function syncedKey(tab: SheetTabName, id: string): string {
  return `${tab}:${id}`;
}

export async function appendNewRows(
  api: DriveApi,
  fileId: string,
  tab: SheetTabName,
  rows: string[][],
  synced: ReadonlySet<string>
): Promise<string[]> {
  const fresh = rowsToAppend(tab, rows, synced);
  if (fresh.length) await api.appendTab(fileId, tab, fresh);
  return fresh.map((row) => syncedKey(tab, row[0] ?? ""));
}

/** User asked to turn sync on again. Creates a new folder when the old one is gone or trashed. */
export async function reenableMemory(api: DriveApi, previous: StoredMemoryIds): Promise<StoredMemoryIds> {
  const status = await inspectMemory(api, previous);
  if (status === "ready" && previous.folderId && previous.fileId) return previous;
  return createMemoryFile(api, "Cortex Memory");
}

/**
 * Timer path. Refuses to create a replacement file.
 * The caller must ask the user when the status is missing or trashed.
 */
export async function syncIfReady(
  api: DriveApi,
  ids: StoredMemoryIds
): Promise<{ status: DriveMemoryStatus; ids: StoredMemoryIds }> {
  const status = await inspectMemory(api, ids);
  return { status, ids };
}

export async function trashMemory(api: DriveApi, ids: StoredMemoryIds): Promise<void> {
  if (ids.fileId) await api.trashFile(ids.fileId);
  if (ids.folderId && ids.folderId !== ids.fileId) await api.trashFile(ids.folderId);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`google_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Sheets and Drive calls. Constructed in the offscreen document, never in the service worker. */
export class FetchDriveApi implements DriveApi {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly token: string,
    fetchImpl?: FetchLike
  ) {
    // Calling window.fetch without its receiver throws "Illegal invocation".
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  async createFolder(name: string): Promise<string> {
    const res = await this.send("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
    });
    const json = await readJson(res);
    const id = json.id;
    if (typeof id !== "string") throw new Error("drive_folder_failed");
    return id;
  }

  async createSpreadsheet(name: string, parentId: string): Promise<string> {
    const res = await this.send("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      body: JSON.stringify({
        properties: { title: name },
        sheets: SHEET_TABS.map((title, index) => ({ properties: { title, index, sheetId: index } })),
      }),
    });
    const json = await readJson(res);
    const id = (json.spreadsheetId as string | undefined) ?? (json.id as string | undefined);
    if (typeof id !== "string") throw new Error("drive_sheet_failed");
    const moved = await this.send(
      `https://www.googleapis.com/drive/v3/files/${id}?addParents=${encodeURIComponent(parentId)}`,
      { method: "PATCH", body: JSON.stringify({}) }
    );
    if (!moved.ok) throw new Error(`google_${moved.status}`);
    return id;
  }

  async getFile(id: string): Promise<DriveFileInfo | null> {
    const res = await this.send(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,trashed`,
      { method: "GET" }
    );
    if (res.status === 404) return null;
    const json = await readJson(res);
    if (typeof json.id !== "string") return null;
    return { id: json.id, name: String(json.name ?? ""), trashed: json.trashed === true };
  }

  async trashFile(id: string): Promise<void> {
    const res = await this.send(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async writeTab(fileId: string, tab: SheetTabName, rows: string[][]): Promise<void> {
    const range = encodeURIComponent(`${tab}!A1`);
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: rows }) }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async appendTab(fileId: string, tab: SheetTabName, rows: string[][]): Promise<void> {
    const range = encodeURIComponent(`${tab}!A1`);
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: rows }) }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async formatHeaders(fileId: string): Promise<void> {
    const res = await this.send(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: headerFormatRequests() }),
    });
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async readTab(fileId: string, tab: SheetTabName): Promise<string[][]> {
    const range = encodeURIComponent(tab);
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
      { method: "GET" }
    );
    if (res.status === 400 || res.status === 404) return [];
    const json = await readJson(res);
    if (!Array.isArray(json.values)) return [];
    return json.values.map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : []
    );
  }

  async updateRow(fileId: string, tab: SheetTabName, rowIndex: number, values: string[]): Promise<void> {
    const range = encodeURIComponent(`${tab}!A${rowIndex}`);
    const res = await this.send(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: [values] }) }
    );
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async deleteRows(fileId: string, tab: SheetTabName, ranges: RowRange[]): Promise<void> {
    if (!ranges.length) return;
    const sheetId = SHEET_TABS.indexOf(tab);
    const ordered = [...ranges].sort((a, b) => b.startIndex - a.startIndex);
    const res = await this.send(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: ordered.map((range) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: range.startIndex,
              endIndex: range.endIndex,
            },
          },
        })),
      }),
    });
    if (!res.ok) throw new Error(`google_${res.status}`);
  }

  async upsertJsonFile(name: string, parentId: string, body: string, existingId: string | null): Promise<string> {
    if (existingId) {
      const existing = await this.getFile(existingId);
      if (existing && !existing.trashed) {
        const res = await this.fetchImpl(
          `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=media`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${this.token}`,
              "Content-Type": "application/json",
            },
            body,
          }
        );
        if (!res.ok) throw new Error(`google_${res.status}`);
        return existingId;
      }
    }
    const meta = JSON.stringify({
      name,
      parents: [parentId],
      mimeType: "application/json",
    });
    const boundary = "cortex_backup_boundary";
    const multipart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${meta}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${body}\r\n` +
      `--${boundary}--`;
    const res = await this.fetchImpl(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
      }
    );
    const json = await readJson(res);
    const id = json.id;
    if (typeof id !== "string") throw new Error("drive_backup_failed");
    return id;
  }
}


export function googleStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : "";
  const match = /^google_(\d+)$/.exec(message);
  return match ? Number(match[1]) : null;
}

export async function getDriveToken(
  identity: {
    getAuthToken: (details: { interactive: boolean }, callback: (token?: string) => void) => void;
  },
  lastError: () => { message?: string } | undefined,
  interactive: boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    identity.getAuthToken({ interactive }, (token) => {
      const err = lastError();
      if (err?.message || !token) reject(new Error(err?.message || "drive_auth_failed"));
      else resolve(token);
    });
  });
}
