import {
  getUserSettings,
  setUserSettings,
} from "../shared/extension-settings";
import {
  HISTORY_IMPORT_IDLE,
  type HistoryImportProgress,
} from "../lib/history-import";
import "../styles/cortex-theme.css";
import "../popup/popup.css";
import "./options.css";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";

injectBrandFontFacesInto(document.head);

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(sel);
  return el as T;
}

function fmtBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function domainsFromTextarea(ta: HTMLTextAreaElement): string[] {
  return ta.value
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderBlocklistChips(): void {
  const ta = qs<HTMLTextAreaElement>("#cx-opt-blocklist");
  const row = qs<HTMLElement>("#cx-opt-blocklist-chips");
  row.innerHTML = "";
  const domains = domainsFromTextarea(ta);
  for (const d of domains) {
    const chip = document.createElement("span");
    chip.className = "cx-chip";
    chip.append(document.createTextNode(d));
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "cx-chip-remove";
    rm.setAttribute("aria-label", `Remove ${d}`);
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      const next = domainsFromTextarea(ta).filter((x) => x !== d);
      ta.value = next.join("\n");
      renderBlocklistChips();
    });
    chip.appendChild(rm);
    row.appendChild(chip);
  }
}

async function refreshStats(): Promise<void> {
  const errEl = qs<HTMLElement>("#cx-opt-stats-error");
  errEl.hidden = true;

  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_STATS",
    })) as {
      ok?: boolean;
      pageCount?: number;
      chunkCount?: number;
      visitCount?: number;
      storageBytes?: number;
      storageQuotaBytes?: number;
      recent?: {
        url: string;
        title: string;
        visitedAt: number;
        hostname: string;
      }[];
    };

    if (!res?.ok) throw new Error("unavailable");

    qs("#cx-opt-pages").textContent =
      typeof res.pageCount === "number" ? String(res.pageCount) : "—";
    qs("#cx-opt-chunks").textContent =
      typeof res.chunkCount === "number" ? String(res.chunkCount) : "—";
    qs("#cx-opt-visits").textContent =
      typeof res.visitCount === "number" ? String(res.visitCount) : "—";

    const used = fmtBytes(res.storageBytes);
    const cap = fmtBytes(res.storageQuotaBytes);
    qs("#cx-opt-storage-line").textContent =
      cap !== "—"
        ? `Approximate storage (browser quota): ${used} of ${cap}`
        : `Approximate storage in use: ${used}`;

    const ul = qs("#cx-opt-recent");
    const empty = qs<HTMLElement>("#cx-opt-recent-empty");
    ul.innerHTML = "";

    const recent = res.recent ?? [];
    if (!recent.length) {
      empty.hidden = false;
    } else {
      empty.hidden = true;
      for (const r of recent) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = r.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = (r.title || r.url).slice(0, 80);
        const meta = document.createElement("div");
        meta.className = "cx-recent-meta";
        meta.textContent = `${r.hostname} · ${new Date(r.visitedAt).toLocaleString()}`;
        li.appendChild(a);
        li.appendChild(meta);
        ul.appendChild(li);
      }
    }
  } catch {
    qs("#cx-opt-pages").textContent = "—";
    qs("#cx-opt-chunks").textContent = "—";
    qs("#cx-opt-visits").textContent = "—";
    qs("#cx-opt-storage-line").textContent = "Storage: unavailable";
    errEl.hidden = false;
  }
}

async function fetchHistoryProgress(): Promise<HistoryImportProgress> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_HISTORY_IMPORT_STATUS",
    })) as { ok?: boolean; progress?: HistoryImportProgress };
    if (res?.ok && res.progress) {
      return { ...HISTORY_IMPORT_IDLE, ...res.progress };
    }
  } catch {
    /* ignore */
  }
  return { ...HISTORY_IMPORT_IDLE };
}

let historyPollId: number | undefined;

function stopHistoryPolling(): void {
  if (historyPollId != null) {
    window.clearInterval(historyPollId);
    historyPollId = undefined;
  }
}

function readChatModeFromForm():
  | "auto"
  | "on-device-only"
  | "cloud-only" {
  const modeRadio = document.querySelector<HTMLInputElement>(
    'input[name="cx-chat-mode"]:checked'
  );
  return modeRadio?.value === "on-device-only" ||
    modeRadio?.value === "cloud-only"
    ? modeRadio.value
    : "auto";
}

async function saveChatSettingsOnly(): Promise<void> {
  const msg = qs<HTMLElement>("#cx-opt-chat-save-msg");
  msg.hidden = true;
  try {
    await setUserSettings({
      chatMode: readChatModeFromForm(),
      cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked,
      geminiApiKey: (qs("#cx-opt-gemini-key") as HTMLInputElement).value.trim(),
    });
    msg.textContent = "Chat settings saved.";
    msg.hidden = false;
  } catch {
    msg.textContent = "Could not save chat settings.";
    msg.hidden = false;
  }
}

function truncateUrl(u: string, max = 72): string {
  if (u.length <= max) return u;
  return `${u.slice(0, max - 1)}…`;
}

function applyHistoryUi(p: HistoryImportProgress): void {
  const status = qs<HTMLElement>("#cx-opt-history-status");
  const startBtn = qs<HTMLButtonElement>("#cx-opt-history-start");
  const cancelBtn = qs<HTMLButtonElement>("#cx-opt-history-cancel");
  const daysSel = qs<HTMLSelectElement>("#cx-opt-history-days");
  const capSel = qs<HTMLSelectElement>("#cx-opt-history-cap");

  if (p.running) {
    startBtn.disabled = true;
    cancelBtn.hidden = false;
    daysSel.disabled = true;
    capSel.disabled = true;
    const pct =
      p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 0;
    let line = `Scanning… ${p.processed} / ${p.total} (${pct}%). Indexed ${p.indexed}, skipped ${p.skipped}, fetch failed ${p.fetchFailed}.`;
    if (p.lastUrl) line += ` Last: ${truncateUrl(p.lastUrl)}`;
    status.textContent = line;
  } else {
    startBtn.disabled = false;
    cancelBtn.hidden = true;
    daysSel.disabled = false;
    capSel.disabled = false;
    if (p.error) {
      status.textContent = `Stopped with error: ${p.error}`;
    } else if (p.finishedAt && p.processed > 0) {
      status.textContent = `Finished. Attempted ${p.processed}, indexed ${p.indexed}, skipped ${p.skipped}, fetch failed ${p.fetchFailed}.`;
    } else if (!p.running && p.processed === 0 && !p.error && !p.finishedAt) {
      status.textContent = "";
    }
  }
}

async function tickHistoryPoll(): Promise<void> {
  const p = await fetchHistoryProgress();
  applyHistoryUi(p);
  if (!p.running) {
    stopHistoryPolling();
    await refreshStats();
  }
}

function startHistoryPolling(): void {
  stopHistoryPolling();
  void tickHistoryPoll();
  historyPollId = window.setInterval(() => void tickHistoryPoll(), 750);
}

async function loadSettingsUi(): Promise<void> {
  const s = await getUserSettings();
  (qs("#cx-opt-pause") as HTMLInputElement).checked = s.indexingPaused;
  (qs("#cx-opt-blocklist") as HTMLTextAreaElement).value =
    s.blocklist.join("\n");

  const mode = s.chatMode ?? "auto";
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-chat-mode"]')
    .forEach((r) => {
      r.checked = r.value === mode;
    });
  (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked =
    s.cloudChatEnabled;
  (qs("#cx-opt-gemini-key") as HTMLInputElement).value = s.geminiApiKey ?? "";

  renderBlocklistChips();
}

document.addEventListener("DOMContentLoaded", () => {
  void refreshStats();
  void loadSettingsUi();
  void (async () => {
    const p = await fetchHistoryProgress();
    applyHistoryUi(p);
    if (p.running) startHistoryPolling();
  })();

  qs("#cx-opt-blocklist").addEventListener("input", () => {
    renderBlocklistChips();
  });

  qs("#cx-opt-retry-stats").addEventListener("click", () => {
    void refreshStats();
  });

  qs("#cx-opt-chat-save").addEventListener("click", () => {
    void saveChatSettingsOnly();
  });

  qs("#cx-opt-save").addEventListener("click", async () => {
    const msg = qs("#cx-opt-save-msg");
    msg.hidden = true;
    try {
      const lines = domainsFromTextarea(qs("#cx-opt-blocklist"));
      await setUserSettings({
        indexingPaused: (qs("#cx-opt-pause") as HTMLInputElement).checked,
        blocklist: lines,
        chatMode: readChatModeFromForm(),
        cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement)
          .checked,
        geminiApiKey: (
          qs("#cx-opt-gemini-key") as HTMLInputElement
        ).value.trim(),
      });
      msg.textContent = "Saved.";
      msg.hidden = false;
      renderBlocklistChips();
    } catch {
      msg.textContent = "Could not save.";
      msg.hidden = false;
    }
  });

  qs("#cx-opt-delete-all").addEventListener("click", async () => {
    const ok = confirm(
      "Delete all indexed pages, chunks, and visit history from this browser?\n\nThis cannot be undone. Blocklist and settings are kept."
    );
    if (!ok) return;

    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_CLEAR_ALL_DATA",
    })) as { ok?: boolean; error?: string };

    if (res?.ok) {
      void refreshStats();
      alert("Indexed data removed.");
    } else {
      alert(res?.error ?? "Could not delete data.");
    }
  });

  qs("#cx-opt-history-start").addEventListener("click", async () => {
    qs<HTMLElement>("#cx-opt-history-status").textContent = "";
    const days = Number(qs<HTMLSelectElement>("#cx-opt-history-days").value);
    const maxUrls = Number(qs<HTMLSelectElement>("#cx-opt-history-cap").value);
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_HISTORY_IMPORT_START",
      daysBack: days,
      maxUrls,
    })) as { ok?: boolean; error?: string };

    if (!res?.ok) {
      qs<HTMLElement>("#cx-opt-history-status").textContent =
        res?.error === "already_running"
          ? "A scan is already running."
          : "Could not start scan.";
      return;
    }
    startHistoryPolling();
  });

  qs("#cx-opt-history-cancel").addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "CORTEX_HISTORY_IMPORT_CANCEL" });
  });
});
