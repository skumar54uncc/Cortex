import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import {
  assistantSyncDb,
  clampRetentionDays,
  MAX_CONSECUTIVE_SYNC_FAILURES,
  readSyncEngineState,
  writeSyncEngineState,
  type BackfillPhase,
  type SyncCompanyRecord,
  type SyncContentRecord,
  type SyncEngineState,
  type SyncPersonRecord,
  type SyncSearchRecord,
  type SyncVisitRecord,
} from "./db";
import { syncDenyReason } from "./denylist";
import {
  appendNewRows,
  googleStatus,
  inspectMemory,
  reenableMemory,
  syncedKey,
  writeWorkbook,
  type DriveApi,
  type DriveMemoryStatus,
  type RowRange,
  type StoredMemoryIds,
} from "./drive-api";
import { localVisitStamp } from "./local-time";
import { pageTypeForUrl } from "./page-type";
import { redactForSync } from "./redact-sync";
import { parseSearchQuery } from "./search-capture";
import {
  aboutRows,
  archiveTitle,
  buildArchiveWorkbook,
  buildWorkbook,
  cellWarning,
  companyRows,
  contentRows,
  dailyRows,
  peopleRows,
  searchRows,
  visitRows,
  workbookCellCount,
  type SheetTabName,
} from "./sheet";

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 60_000;
export const APPEND_BATCH = 200;
export const DAY_MS = 86_400_000;

export const SYNC_STOPPED_MESSAGE =
  "Sync paused after 10 failed attempts. Cortex will try again on the next 15 minute check.";
export const SYNC_MISSING_MESSAGE =
  "The Cortex Memory file is missing from Drive. Sync will stay paused until you turn it on again.";
export const SYNC_TRASHED_MESSAGE =
  "The Cortex Memory file is in the trash. Sync will stay paused until you turn it on again.";
export const SYNC_ABSENT_MESSAGE =
  "Cortex Memory has not been created in Drive yet. Turn sync on to create it.";

const DATA_TABS: SheetTabName[] = ["Visits", "Content", "Searches", "People", "Companies", "Daily"];

export interface HistoryVisit {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface HistoryPerson {
  profileUrl: string;
  name: string;
  headline: string;
  company: string;
  kind: "person" | "company";
  seenAt: number;
}

export interface BackfillProgress {
  done: number;
  total: number;
  phase: BackfillPhase;
}

export interface SyncTickResult {
  status: DriveMemoryStatus | "disabled" | "stopped" | "error";
  appended: number;
  created: false;
  error?: string;
  warning?: string;
}

export interface SyncClock {
  api: DriveApi;
  ids: StoredMemoryIds;
  now: number;
  timeZone: string;
  fromAlarm: boolean;
  fromUser: boolean;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Exponential delay with jitter in [0.5, 1]. `failureCount` starts at 1. */
export function backoffDelayMs(failureCount: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, failureCount - 1);
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const unit = Math.min(1, Math.max(0, random()));
  return Math.floor(exp * (0.5 + unit * 0.5));
}

export function isRetryableGoogleStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function retentionCutoffMs(now: number, retentionDays: number): number {
  return now - clampRetentionDays(retentionDays) * DAY_MS;
}

export function contiguousRanges(indexes: number[]): RowRange[] {
  const sorted = [...new Set(indexes)].filter((n) => n > 0).sort((a, b) => a - b);
  const ranges: RowRange[] = [];
  for (const index of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.endIndex === index) last.endIndex = index + 1;
    else ranges.push({ startIndex: index, endIndex: index + 1 });
  }
  return ranges;
}

/** 0-based sheet indexes, header at 0. `dateCol` is 1 on visit tabs and 0 on Daily. */
export function staleRowIndexes(rows: string[][], dateCol: number, cutoffDate: string): number[] {
  const indexes: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const date = rows[i]?.[dateCol] ?? "";
    if (date && date < cutoffDate) indexes.push(i);
  }
  return indexes;
}

function statusMessage(status: DriveMemoryStatus): string {
  if (status === "missing") return SYNC_MISSING_MESSAGE;
  if (status === "trashed") return SYNC_TRASHED_MESSAGE;
  return SYNC_ABSENT_MESSAGE;
}

function dateOf(visitedAt: number, timeZone: string): string {
  return localVisitStamp(visitedAt, timeZone).date;
}

function headerLabel(tab: SheetTabName): string {
  if (tab === "About") return "Cortex Memory";
  if (tab === "Daily") return "date";
  return "id";
}

function dateColumn(tab: SheetTabName): number {
  return tab === "Daily" ? 0 : 1;
}

async function loadMemory(): Promise<{
  visits: SyncVisitRecord[];
  content: SyncContentRecord[];
  searches: SyncSearchRecord[];
  people: SyncPersonRecord[];
  companies: SyncCompanyRecord[];
}> {
  const [visits, content, searches, people, companies] = await Promise.all([
    assistantSyncDb.visits.toArray(),
    assistantSyncDb.content.toArray(),
    assistantSyncDb.searches.toArray(),
    assistantSyncDb.people.toArray(),
    assistantSyncDb.companies.toArray(),
  ]);
  return { visits, content, searches, people, companies };
}

async function syncedSet(): Promise<Set<string>> {
  const keys = await assistantSyncDb.synced.toCollection().primaryKeys();
  return new Set(keys.map(String));
}

class SyncStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncStopped";
  }
}

async function withBackoff<T>(state: SyncEngineState, deps: SyncClock, op: () => Promise<T>): Promise<T> {
  const random = deps.random ?? Math.random;
  for (;;) {
    try {
      const value = await op();
      if (state.consecutiveFailures !== 0) {
        state.consecutiveFailures = 0;
        await writeSyncEngineState(state);
      }
      return value;
    } catch (error) {
      if (error instanceof SyncStopped) throw error;
      const status = googleStatus(error);
      if (status == null || !isRetryableGoogleStatus(status)) throw error;
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_SYNC_FAILURES) {
        state.stoppedUntilAlarm = true;
        state.lastError = SYNC_STOPPED_MESSAGE;
        await writeSyncEngineState(state);
        throw new SyncStopped(SYNC_STOPPED_MESSAGE);
      }
      await writeSyncEngineState(state);
      await deps.sleep(backoffDelayMs(state.consecutiveFailures, random));
    }
  }
}

async function markSynced(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await assistantSyncDb.synced.bulkPut(keys.map((key) => ({ key })));
  await assistantSyncDb.pending.bulkDelete(keys);
}

async function ensureHeaders(deps: SyncClock, state: SyncEngineState, fileId: string): Promise<void> {
  for (const tab of DATA_TABS) {
    const rows = await withBackoff(state, deps, () => deps.api.readTab(fileId, tab));
    if (rows.length === 0) {
      const header = headerRow(tab);
      await withBackoff(state, deps, () => deps.api.writeTab(fileId, tab, [header]));
    }
  }
}

function headerRow(tab: SheetTabName): string[] {
  if (tab === "Visits") return [...visitRows([], "UTC")[0]!];
  if (tab === "Content") return [...contentRows([], "UTC")[0]!];
  if (tab === "Searches") return [...searchRows([], "UTC")[0]!];
  if (tab === "People") return [...peopleRows([], "UTC")[0]!];
  if (tab === "Companies") return [...companyRows([], "UTC")[0]!];
  return [...dailyRows({ visits: [], content: [], searches: [], people: [], companies: [] }, "UTC")[0]!];
}

async function reconcileSheet(deps: SyncClock, state: SyncEngineState, fileId: string, synced: Set<string>): Promise<void> {
  for (const tab of DATA_TABS) {
    const rows = await withBackoff(state, deps, () => deps.api.readTab(fileId, tab));
    const header = headerLabel(tab);
    const found: string[] = [];
    for (const row of rows) {
      const id = row[0] ?? "";
      if (!id || id === header) continue;
      const key = syncedKey(tab, id);
      synced.add(key);
      found.push(key);
    }
    await markSynced(found);
  }
}

async function dropKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await assistantSyncDb.synced.bulkDelete(keys);
  await assistantSyncDb.pending.bulkDelete(keys);
}

async function purgeRetention(deps: SyncClock, state: SyncEngineState, fileId: string): Promise<void> {
  const cutoffDate = dateOf(retentionCutoffMs(deps.now, state.retentionDays), deps.timeZone);
  const memory = await loadMemory();
  const removed = {
    visits: memory.visits.filter((row) => dateOf(row.visitedAt, deps.timeZone) < cutoffDate),
    content: memory.content.filter((row) => dateOf(row.visitedAt, deps.timeZone) < cutoffDate),
    searches: memory.searches.filter((row) => dateOf(row.visitedAt, deps.timeZone) < cutoffDate),
    people: memory.people.filter((row) => dateOf(row.visitedAt, deps.timeZone) < cutoffDate),
    companies: memory.companies.filter((row) => dateOf(row.visitedAt, deps.timeZone) < cutoffDate),
  };
  const removedAny =
    removed.visits.length +
      removed.content.length +
      removed.searches.length +
      removed.people.length +
      removed.companies.length >
    0;

  if (state.archivesEnabled && removedAny && deps.ids.folderId) {
    const months = new Set(removed.visits.map((row) => dateOf(row.visitedAt, deps.timeZone).slice(0, 7)));
    for (const content of removed.content) months.add(dateOf(content.visitedAt, deps.timeZone).slice(0, 7));
    for (const month of months) {
      const slice = {
        visits: removed.visits.filter((row) => dateOf(row.visitedAt, deps.timeZone).startsWith(month)),
        content: removed.content.filter((row) => dateOf(row.visitedAt, deps.timeZone).startsWith(month)),
        searches: removed.searches.filter((row) => dateOf(row.visitedAt, deps.timeZone).startsWith(month)),
        people: removed.people.filter((row) => dateOf(row.visitedAt, deps.timeZone).startsWith(month)),
        companies: removed.companies.filter((row) => dateOf(row.visitedAt, deps.timeZone).startsWith(month)),
      };
      const workbook = buildArchiveWorkbook(month, slice, {
        enabled: true,
        timeZone: deps.timeZone,
        syncedAt: syncedAtLabel(deps.now, deps.timeZone),
      });
      if (!workbook) continue;
      const archiveId = await withBackoff(state, deps, () =>
        deps.api.createSpreadsheet(archiveTitle(month), deps.ids.folderId ?? "")
      );
      await withBackoff(state, deps, () => writeWorkbook(deps.api, archiveId, workbook));
    }
  }

  const keys: string[] = [];
  for (const row of removed.visits) keys.push(syncedKey("Visits", row.id), syncedKey("Content", row.id), syncedKey("Searches", row.id), syncedKey("People", row.id), syncedKey("Companies", row.id));
  const dailyDates = new Set([
    ...removed.visits.map((row) => dateOf(row.visitedAt, deps.timeZone)),
    ...removed.content.map((row) => dateOf(row.visitedAt, deps.timeZone)),
  ]);
  for (const date of dailyDates) keys.push(syncedKey("Daily", date));
  await assistantSyncDb.visits.bulkDelete(removed.visits.map((row) => row.id));
  await assistantSyncDb.content.bulkDelete(removed.content.map((row) => row.id));
  await assistantSyncDb.searches.bulkDelete(removed.searches.map((row) => row.id));
  await assistantSyncDb.people.bulkDelete(removed.people.map((row) => row.id));
  await assistantSyncDb.companies.bulkDelete(removed.companies.map((row) => row.id));
  await dropKeys(keys);

  for (const tab of DATA_TABS) {
    const rows = await withBackoff(state, deps, () => deps.api.readTab(fileId, tab));
    const ranges = contiguousRanges(staleRowIndexes(rows, dateColumn(tab), cutoffDate));
    if (ranges.length) await withBackoff(state, deps, () => deps.api.deleteRows(fileId, tab, ranges));
  }
}

async function enqueueUnsynced(timeZone: string, now: number, synced: Set<string>): Promise<void> {
  const memory = await loadMemory();
  const pending = await assistantSyncDb.pending.toArray();
  const queued = new Set(pending.map((row) => row.key));
  const batches: { key: string; tab: SheetTabName; rowId: string; cells: string[]; enqueuedAt: number }[] = [];
  const consider = (tab: SheetTabName, rows: string[][]) => {
    for (const cells of rows.slice(1)) {
      const rowId = cells[0] ?? "";
      if (!rowId) continue;
      const key = syncedKey(tab, rowId);
      if (synced.has(key) || queued.has(key)) continue;
      queued.add(key);
      batches.push({ key, tab, rowId, cells, enqueuedAt: now });
    }
  };
  consider("Visits", visitRows(memory.visits, timeZone));
  consider("Content", contentRows(memory.content, timeZone));
  consider("Searches", searchRows(memory.searches, timeZone));
  consider("People", peopleRows(memory.people, timeZone));
  consider("Companies", companyRows(memory.companies, timeZone));
  if (batches.length) await assistantSyncDb.pending.bulkPut(batches);
}

async function flushPending(deps: SyncClock, state: SyncEngineState, fileId: string, synced: Set<string>): Promise<number> {
  const pending = (await assistantSyncDb.pending.toArray()).filter((row) => !synced.has(row.key));
  const stale = (await assistantSyncDb.pending.toArray()).filter((row) => synced.has(row.key)).map((row) => row.key);
  await assistantSyncDb.pending.bulkDelete(stale);
  let appended = 0;
  const byTab = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byTab.get(row.tab) ?? [];
    list.push(row);
    byTab.set(row.tab, list);
  }
  for (const [tab, rows] of byTab) {
    if (!DATA_TABS.includes(tab as SheetTabName) || tab === "Daily") continue;
    for (let i = 0; i < rows.length; i += APPEND_BATCH) {
      const batch = rows.slice(i, i + APPEND_BATCH);
      const keys = await withBackoff(state, deps, () =>
        appendNewRows(
          deps.api,
          fileId,
          tab as SheetTabName,
          batch.map((row) => row.cells),
          synced
        )
      );
      await markSynced(keys);
      for (const key of keys) synced.add(key);
      appended += keys.length;
    }
  }
  return appended;
}

function syncedAtLabel(now: number, timeZone: string): string {
  const stamp = localVisitStamp(now, timeZone);
  return `${stamp.date} ${stamp.time}`;
}

async function upsertDaily(deps: SyncClock, state: SyncEngineState, fileId: string, synced: Set<string>): Promise<void> {
  const memory = await loadMemory();
  const rows = dailyRows(memory, deps.timeZone).slice(1);
  const existing = await withBackoff(state, deps, () => deps.api.readTab(fileId, "Daily"));
  const indexByDate = new Map<string, number>();
  existing.forEach((row, index) => {
    if (index > 0 && row[0]) indexByDate.set(row[0], index);
  });
  for (const row of rows) {
    const date = row[0] ?? "";
    if (!date) continue;
    const found = indexByDate.get(date);
    if (found != null) {
      await withBackoff(state, deps, () => deps.api.updateRow(fileId, "Daily", found + 1, row));
      const key = syncedKey("Daily", date);
      synced.add(key);
      await markSynced([key]);
      continue;
    }
    const key = syncedKey("Daily", date);
    if (synced.has(key)) continue;
    const keys = await withBackoff(state, deps, () => appendNewRows(deps.api, fileId, "Daily", [row], synced));
    await markSynced(keys);
    for (const saved of keys) synced.add(saved);
  }
}

async function rewriteAbout(deps: SyncClock, state: SyncEngineState, fileId: string): Promise<string | undefined> {
  const memory = await loadMemory();
  const label = syncedAtLabel(deps.now, deps.timeZone);
  const workbook = buildWorkbook(memory, { title: "Cortex Memory", timeZone: deps.timeZone, syncedAt: label });
  const about = workbook.tabs[0]?.rows ?? aboutRows({
    firstDate: "",
    lastDate: "",
    syncedAt: label,
    timeZone: deps.timeZone,
    visits: 0,
    content: 0,
    searches: 0,
    people: 0,
    companies: 0,
  });
  await withBackoff(state, deps, () => deps.api.writeTab(fileId, "About", about));
  const warning = cellWarning(workbookCellCount(workbook));
  return warning ?? undefined;
}

/**
 * One sync pass. Never creates a Drive file.
 * `fromAlarm` and `fromUser` clear a 10-failure stop. A silent retry does not.
 */
export async function runSyncTick(deps: SyncClock): Promise<SyncTickResult> {
  const state = await readSyncEngineState();
  if (!state.syncEnabled) return { status: "disabled", appended: 0, created: false };
  if (state.stoppedUntilAlarm && !deps.fromAlarm && !deps.fromUser) {
    return { status: "stopped", appended: 0, created: false, error: state.lastError || SYNC_STOPPED_MESSAGE };
  }
  if (deps.fromAlarm || deps.fromUser) {
    state.stoppedUntilAlarm = false;
    state.consecutiveFailures = 0;
    state.lastError = "";
    await writeSyncEngineState(state);
  }

  try {
    const status = await withBackoff(state, deps, () => inspectMemory(deps.api, deps.ids));
    if (status !== "ready" || !deps.ids.fileId) {
      state.lastError = statusMessage(status === "ready" ? "absent" : status);
      await writeSyncEngineState(state);
      return { status: status === "ready" ? "absent" : status, appended: 0, created: false, error: state.lastError };
    }
    const fileId = deps.ids.fileId;
    await ensureHeaders(deps, state, fileId);
    const synced = await syncedSet();
    await reconcileSheet(deps, state, fileId, synced);
    await purgeRetention(deps, state, fileId);
    await enqueueUnsynced(deps.timeZone, deps.now, synced);
    const appended = await flushPending(deps, state, fileId, synced);
    await upsertDaily(deps, state, fileId, synced);
    const warning = await rewriteAbout(deps, state, fileId);
    state.consecutiveFailures = 0;
    state.stoppedUntilAlarm = false;
    state.lastError = "";
    state.lastSyncedAt = deps.now;
    await writeSyncEngineState(state);
    return { status: "ready", appended, created: false, ...(warning ? { warning } : {}) };
  } catch (error) {
    if (error instanceof SyncStopped) {
      return { status: "stopped", appended: 0, created: false, error: SYNC_STOPPED_MESSAGE };
    }
    const message = error instanceof Error ? error.message : "Sync failed.";
    state.lastError = message;
    await writeSyncEngineState(state);
    return { status: "error", appended: 0, created: false, error: message };
  }
}

export async function backfillHistory(input: {
  history: HistoryVisit[];
  people: HistoryPerson[];
  now: number;
  retentionDays: number;
  timeZone: string;
  userDenylist?: string[];
  onProgress?: (progress: BackfillProgress) => Promise<void> | void;
}): Promise<{ stored: number; skipped: number; total: number }> {
  const cutoff = retentionCutoffMs(input.now, input.retentionDays);
  const inWindow = input.history.filter((visit) => visit.visitedAt >= cutoff);
  const progress: BackfillProgress = { done: 0, total: inWindow.length, phase: "reading" };
  const report = async (phase: BackfillPhase) => {
    progress.phase = phase;
    const state = await readSyncEngineState();
    state.backfillDone = progress.done;
    state.backfillTotal = progress.total;
    state.backfillPhase = phase;
    await writeSyncEngineState(state);
    await input.onProgress?.({ ...progress });
  };
  await report("reading");
  const existing = await assistantSyncDb.visits.toArray();
  const seen = new Set(existing.map((row) => `${row.url}\t${row.visitedAt}`));
  const peopleByUrl = new Map(input.people.map((person) => [canonicalizeUrl(person.profileUrl) ?? person.profileUrl, person]));
  let stored = 0;
  let skipped = 0;
  for (const visit of inWindow) {
    const canonical = canonicalizeUrl(visit.url);
    const denied = !canonical || syncDenyReason(visit.url, { userDomains: input.userDenylist }) != null;
    const duplicate = canonical != null && seen.has(`${canonical}\t${visit.visitedAt}`);
    if (denied || duplicate || !canonical) {
      skipped += 1;
    } else {
      const title = redactForSync(visit.title.replace(/\s+/g, " ").trim());
      await assistantSyncDb.visits.put({
        id: visit.id,
        visitedAt: visit.visitedAt,
        title,
        url: canonical,
        domain: domainFromUrl(canonical),
        dwellMinutes: null,
        maxScrollPct: null,
        pageType: pageTypeForUrl(canonical),
        topics: [],
      });
      const search = parseSearchQuery(visit.url);
      if (search) {
        await assistantSyncDb.searches.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          engine: search.engine,
          query: redactForSync(search.query),
        });
      }
      const linked = peopleByUrl.get(canonical);
      if (linked?.kind === "person" && linked.name.trim()) {
        await assistantSyncDb.people.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          name: redactForSync(linked.name),
          headline: redactForSync(linked.headline),
          company: redactForSync(linked.company),
          profileUrl: canonical,
          howFound: "",
          dwellMinutes: null,
          maxScrollPct: null,
        });
      } else if (linked?.kind === "company" && linked.company.trim()) {
        await assistantSyncDb.companies.put({
          id: visit.id,
          visitedAt: visit.visitedAt,
          company: redactForSync(linked.company),
          sectionViewed: "",
          linkedinUrl: canonical,
          dwellMinutes: null,
        });
      }
      seen.add(`${canonical}\t${visit.visitedAt}`);
      stored += 1;
    }
    progress.done += 1;
    await report("writing");
  }
  await report("done");
  return { stored, skipped, total: inWindow.length };
}

export async function enableAssistantSync(input: {
  api: DriveApi;
  ids: StoredMemoryIds;
  now: number;
  timeZone: string;
  retentionDays?: number;
  archivesEnabled?: boolean;
  history?: HistoryVisit[];
  people?: HistoryPerson[];
  loadHistory?: (cutoffMs: number) => Promise<{ visits: HistoryVisit[]; people: HistoryPerson[] }>;
  saveIds: (ids: StoredMemoryIds) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
  onProgress?: (progress: BackfillProgress) => Promise<void> | void;
}): Promise<{ ids: StoredMemoryIds; created: boolean; backfill: { stored: number; skipped: number; total: number }; tick: SyncTickResult }> {
  const previous = await readSyncEngineState();
  const retentionDays = clampRetentionDays(input.retentionDays ?? previous.retentionDays);
  const state: SyncEngineState = {
    ...previous,
    syncEnabled: true,
    retentionDays,
    archivesEnabled: input.archivesEnabled ?? previous.archivesEnabled,
    stoppedUntilAlarm: false,
    consecutiveFailures: 0,
    lastError: "",
  };
  await writeSyncEngineState(state);
  const ids = await reenableMemory(input.api, input.ids);
  const created = ids.fileId !== input.ids.fileId || ids.folderId !== input.ids.folderId;
  await input.saveIds(ids);
  const loaded = input.history
    ? { visits: input.history, people: input.people ?? [] }
    : await input.loadHistory?.(retentionCutoffMs(input.now, retentionDays)) ?? { visits: [], people: [] };
  const backfill = await backfillHistory({
    history: loaded.visits,
    people: loaded.people,
    now: input.now,
    retentionDays,
    timeZone: input.timeZone,
    userDenylist: previous.userDenylist,
    onProgress: input.onProgress,
  });
  const tick = await runSyncTick({
    api: input.api,
    ids,
    now: input.now,
    timeZone: input.timeZone,
    fromAlarm: false,
    fromUser: true,
    sleep: input.sleep,
    random: input.random,
  });
  return { ids, created, backfill, tick };
}
