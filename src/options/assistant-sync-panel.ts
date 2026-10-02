/// <reference types="chrome"/>
import type { SyncEngineState } from "../assistant-sync/db";
import { ASSISTANT_SYNC_ARCHIVES_KEY, ASSISTANT_SYNC_RETENTION_KEY } from "../assistant-sync/preference-keys";

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 90;
  return Math.max(7, Math.min(365, Math.round(days)));
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showFeedback(text: string, isError: boolean): void {
  const el = byId<HTMLElement>("cx-assistant-feedback");
  if (!el) return;
  el.hidden = text.length === 0;
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

let poll = 0;
let syncOn = false;

function schedule(phase: string): void {
  window.clearInterval(poll);
  poll = 0;
  if (phase === "reading" || phase === "writing") {
    poll = window.setInterval(() => {
      void refresh();
    }, 2000);
  }
}

function paint(state: SyncEngineState): void {
  syncOn = state.syncEnabled;
  const enabled = byId<HTMLElement>("cx-assistant-enabled");
  const last = byId<HTMLElement>("cx-assistant-last");
  const error = byId<HTMLElement>("cx-assistant-error");
  const backfill = byId<HTMLElement>("cx-assistant-backfill");
  const enable = byId<HTMLButtonElement>("cx-assistant-enable");
  const disable = byId<HTMLButtonElement>("cx-assistant-disable");
  const now = byId<HTMLButtonElement>("cx-assistant-now");
  if (enabled) enabled.textContent = state.syncEnabled ? "On" : "Off";
  if (last) last.textContent = state.lastSyncedAt > 0 ? new Date(state.lastSyncedAt).toLocaleString() : "Not yet";
  if (error) error.textContent = state.lastError || "None";
  if (backfill) {
    backfill.textContent = state.backfillTotal
      ? `${state.backfillDone}/${state.backfillTotal}, ${state.backfillPhase}`
      : state.backfillPhase;
  }
  if (enable) {
    enable.hidden = state.syncEnabled;
    enable.disabled = false;
  }
  if (disable) {
    disable.hidden = !state.syncEnabled;
    disable.disabled = false;
  }
  if (now) {
    now.disabled = !state.syncEnabled;
    now.title = state.syncEnabled ? "Sync Cortex Memory now" : "Turn Assist Sync on before syncing";
  }
  schedule(state.backfillPhase);
}

async function refresh(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "status" })) as {
    state?: SyncEngineState;
  };
  if (res?.state) paint(res.state);
}

/** Interactive sign-in. Called only from the Enable click, which is the user gesture. */
export function driveTokenFromClick(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (value) => {
      const err = chrome.runtime.lastError;
      if (err?.message || !value) {
        reject(new Error(err?.message || "Sign in to Google is needed before Cortex can sync."));
        return;
      }
      resolve(value);
    });
  });
}

async function savePrefs(patch: { retentionDays?: number; archivesEnabled?: boolean }): Promise<void> {
  const current = await chrome.storage.local.get([ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_ARCHIVES_KEY]);
  await chrome.storage.local.set({
    [ASSISTANT_SYNC_RETENTION_KEY]:
      patch.retentionDays ?? (typeof current[ASSISTANT_SYNC_RETENTION_KEY] === "number" ? current[ASSISTANT_SYNC_RETENTION_KEY] : 90),
    [ASSISTANT_SYNC_ARCHIVES_KEY]:
      patch.archivesEnabled ?? current[ASSISTANT_SYNC_ARCHIVES_KEY] === true,
  });
}

export function mountAssistantSyncPanel(): void {
  const enable = byId<HTMLButtonElement>("cx-assistant-enable");
  const disable = byId<HTMLButtonElement>("cx-assistant-disable");
  const now = byId<HTMLButtonElement>("cx-assistant-now");
  const retention = byId<HTMLInputElement>("cx-assistant-retention");
  const archives = byId<HTMLInputElement>("cx-assistant-archives");
  if (!enable || !now) return;

  enable.addEventListener("click", () => {
    enable.disabled = true;
    showFeedback("", false);
    void driveTokenFromClick()
      .then((token) => chrome.runtime.sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "enable", token }))
      .then((res: { ok?: boolean; error?: string; status?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Sync did not start.", true);
        else showFeedback("Sync is on.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(
          error instanceof Error ? error.message : "Sign in to Google is needed before Cortex can sync.",
          true
        );
      })
      .finally(() => {
        enable.disabled = syncOn;
      });
  });

  disable?.addEventListener("click", () => {
    disable.disabled = true;
    showFeedback("", false);
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "disable" })
      .then((res: { ok?: boolean; error?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Sync could not be turned off.", true);
        else showFeedback("Sync is off. Drive files were left in place.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(error instanceof Error ? error.message : "Sync could not be turned off.", true);
      })
      .finally(() => {
        disable.disabled = !syncOn;
      });
  });

  now.addEventListener("click", () => {
    if (!syncOn) {
      showFeedback("Turn Assist Sync on before syncing.", true);
      return;
    }
    now.disabled = true;
    void chrome.runtime
      .sendMessage({ type: "CORTEX_ASSISTANT_SYNC", action: "now" })
      .then((res: { ok?: boolean; error?: string } | undefined) => {
        if (!res?.ok) showFeedback(res?.error || "Sync did not finish.", true);
        else showFeedback("Sync finished.", false);
        return refresh();
      })
      .catch((error: unknown) => {
        showFeedback(error instanceof Error ? error.message : "Sync did not finish.", true);
      })
      .finally(() => {
        now.disabled = !syncOn;
      });
  });

  retention?.addEventListener("change", () => {
    const days = clampDays(Number(retention.value));
    retention.value = String(days);
    void savePrefs({ retentionDays: days });
  });

  archives?.addEventListener("change", () => {
    void savePrefs({ archivesEnabled: archives.checked });
  });

  void chrome.storage.local.get([ASSISTANT_SYNC_RETENTION_KEY, ASSISTANT_SYNC_ARCHIVES_KEY]).then((stored) => {
    const days = stored[ASSISTANT_SYNC_RETENTION_KEY];
    if (retention && typeof days === "number") retention.value = String(clampDays(days));
    if (archives) archives.checked = stored[ASSISTANT_SYNC_ARCHIVES_KEY] === true;
  });
  void refresh();
}
