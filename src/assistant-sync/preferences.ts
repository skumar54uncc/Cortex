import { clampRetentionDays, readSyncEngineState, writeSyncEngineState } from "./db";
import { ASSISTANT_SYNC_ARCHIVES_KEY, ASSISTANT_SYNC_RETENTION_KEY } from "./preference-keys";

export { ASSISTANT_SYNC_ARCHIVES_KEY, ASSISTANT_SYNC_RETENTION_KEY };

/** Copies the options-page choices into the sync database before a pass runs. */
export async function applyAssistantSyncPreferences(stored: {
  retentionDays?: unknown;
  archivesEnabled?: unknown;
}): Promise<void> {
  const state = await readSyncEngineState();
  if (typeof stored.retentionDays === "number") state.retentionDays = clampRetentionDays(stored.retentionDays);
  if (typeof stored.archivesEnabled === "boolean") state.archivesEnabled = stored.archivesEnabled;
  await writeSyncEngineState(state);
}
