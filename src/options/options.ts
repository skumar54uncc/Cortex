import {
  getUserSettings,
  setUserSettings,
} from "../shared/extension-settings";
import type { HistoryImportProgress } from "../lib/history-import";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";

const HISTORY_IDLE: HistoryImportProgress = {
  running: false,
  total: 0,
  processed: 0,
  indexed: 0,
  skipped: 0,
  fetchFailed: 0,
};

type RecentRow = {
  url: string;
  title: string;
  hostname: string;
  visitedAt: number;
};

let statsAnimatedOnce = false;
let deleteOpenAt = 0;

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

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(ts).toLocaleDateString();
}

function openTab(url: string): void {
  try {
    const u = new URL(url.trim());
    if (u.protocol === "http:" || u.protocol === "https:") {
      void chrome.runtime.sendMessage({ type: "CORTEX_OPEN_TAB", url: u.href });
    }
  } catch {
    /* ignore */
  }
}

function animateStat(el: HTMLElement, target: number): void {
  el.querySelector(".cx-stat-skeleton")?.remove();
  el.classList.add("is-loaded");
  if (!Number.isFinite(target)) {
    el.textContent = "—";
    return;
  }
  const n = Math.round(target);
  if (statsAnimatedOnce) {
    el.textContent = String(n);
    return;
  }
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / 300);
    el.textContent = String(Math.round(n * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function syncPauseToggle(checked: boolean): void {
  const toggle = qs<HTMLButtonElement>("#cx-opt-pause-toggle");
  const input = qs<HTMLInputElement>("#cx-opt-pause");
  input.checked = checked;
  toggle.setAttribute("aria-checked", String(checked));
}

function renderBlocklistChips(): void {
  const ta = qs<HTMLTextAreaElement>("#cx-opt-blocklist");
  const row = qs<HTMLElement>("#cx-opt-blocklist-chips");
  row.replaceChildren();
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

function renderRecentList(recent: RecentRow[]): void {
  const ul = qs<HTMLUListElement>("#cx-opt-recent");
  const empty = qs<HTMLElement>("#cx-opt-recent-empty");
  const badge = qs<HTMLElement>("#cx-recent-count");
  ul.replaceChildren();

  const map = new Map<
    string,
    { url: string; title: string; host: string; at: number; n: number }
  >();
  for (const row of recent) {
    const e = map.get(row.url);
    if (!e) {
      map.set(row.url, {
        url: row.url,
        title: row.title,
        host: row.hostname,
        at: row.visitedAt,
        n: 1,
      });
    } else {
      e.n++;
      if (row.visitedAt > e.at) {
        e.at = row.visitedAt;
        e.title = row.title || e.title;
        e.host = row.hostname || e.host;
      }
    }
  }
  const deduped = [...map.values()].sort((a, b) => b.at - a.at).slice(0, 20);
  badge.textContent = `(${deduped.length})`;
  empty.hidden = deduped.length > 0;

  for (const r of deduped) {
    const li = document.createElement("li");
    li.className = "cx-recent-item";
    li.tabIndex = 0;
    const letter = (r.host || "?").charAt(0).toUpperCase();
    const fav = document.createElement("img");
    fav.className = "cx-recent-favicon";
    fav.width = 16;
    fav.height = 16;
    fav.alt = "";
    fav.src = `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(r.host)}`;
    fav.onerror = () => {
      const fb = document.createElement("span");
      fb.className = "cx-recent-fallback";
      fb.textContent = letter;
      fav.replaceWith(fb);
    };

    const main = document.createElement("div");
    main.className = "cx-recent-main";
    const title = document.createElement("span");
    title.className = "cx-recent-title";
    title.textContent = r.title || r.host || r.url;
    const host = document.createElement("span");
    host.className = "cx-recent-host";
    host.textContent = r.host;
    main.append(title, host);

    const meta = document.createElement("div");
    meta.className = "cx-recent-meta";
    if (r.n > 1) {
      const pill = document.createElement("span");
      pill.className = "cx-recent-count-pill";
      pill.textContent = `${r.n} visits`;
      meta.appendChild(pill);
    }
    const when = document.createElement("span");
    when.textContent = relativeTime(r.at);
    meta.appendChild(when);
    const go = () => openTab(r.url);
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });

    li.append(fav, main, meta);
    ul.appendChild(li);
  }
}

async function refreshStats(): Promise<void> {
  const errEl = qs<HTMLElement>("#cx-opt-stats-error");
  errEl.hidden = true;

  const pagesEl = qs<HTMLElement>("#cx-opt-pages");
  const chunksEl = qs<HTMLElement>("#cx-opt-chunks");
  const visitsEl = qs<HTMLElement>("#cx-opt-visits");

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
      recent?: RecentRow[];
    };

    if (!res?.ok) throw new Error("unavailable");

    animateStat(
      pagesEl,
      typeof res.pageCount === "number" ? res.pageCount : NaN
    );
    animateStat(
      chunksEl,
      typeof res.chunkCount === "number" ? res.chunkCount : NaN
    );
    animateStat(
      visitsEl,
      typeof res.visitCount === "number" ? res.visitCount : NaN
    );

    const used = fmtBytes(res.storageBytes);
    const cap = fmtBytes(res.storageQuotaBytes);
    qs("#cx-opt-storage-line").textContent =
      cap !== "—"
        ? `Approximate storage (browser quota): ${used} of ${cap}`
        : `Approximate storage in use: ${used}`;

    renderRecentList(res.recent ?? []);
    statsAnimatedOnce = true;
  } catch {
    pagesEl.textContent = "—";
    chunksEl.textContent = "—";
    visitsEl.textContent = "—";
    pagesEl.classList.add("is-loaded");
    chunksEl.classList.add("is-loaded");
    visitsEl.classList.add("is-loaded");
    qs("#cx-opt-storage-line").textContent = "Storage: unavailable";
    errEl.hidden = false;
    renderRecentList([]);
  }
}

async function fetchHistoryProgress(): Promise<HistoryImportProgress> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_HISTORY_IMPORT_STATUS",
    })) as { ok?: boolean; progress?: HistoryImportProgress };
    if (res?.ok && res.progress) {
      return { ...HISTORY_IDLE, ...res.progress };
    }
  } catch {
    /* ignore */
  }
  return { ...HISTORY_IDLE };
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

async function runSave(
  btnId: string,
  msgId: string,
  idle: string,
  saveFn: () => Promise<void>
): Promise<void> {
  const btn = qs<HTMLButtonElement>(btnId);
  const feedback = qs<HTMLElement>(msgId);
  const label = btn.querySelector(".cx-btn-label");
  feedback.hidden = true;
  feedback.classList.remove("is-error", "is-success");
  btn.classList.remove("shake", "is-success");
  btn.classList.add("is-loading");
  btn.disabled = true;
  if (label) label.textContent = "Saving…";
  try {
    await saveFn();
    btn.classList.remove("is-loading");
    btn.classList.add("is-success");
    if (label) label.textContent = "Saved";
    feedback.textContent = "Saved";
    feedback.classList.add("is-success");
    feedback.hidden = false;
    window.setTimeout(() => {
      btn.classList.remove("is-success");
      btn.disabled = false;
      if (label) label.textContent = idle;
      feedback.hidden = true;
    }, 2000);
  } catch {
    btn.classList.remove("is-loading");
    btn.classList.add("shake");
    btn.disabled = false;
    if (label) label.textContent = idle;
    feedback.textContent = "Could not save. Try again.";
    feedback.classList.add("is-error");
    feedback.hidden = false;
  }
}

function applyHistoryUi(p: HistoryImportProgress): void {
  const status = qs<HTMLElement>("#cx-opt-history-status");
  const startBtn = qs<HTMLButtonElement>("#cx-opt-history-start");
  const cancelBtn = qs<HTMLButtonElement>("#cx-opt-history-cancel");
  const daysSel = qs<HTMLSelectElement>("#cx-opt-history-days");
  const capSel = qs<HTMLSelectElement>("#cx-opt-history-cap");

  status.classList.remove("is-running");

  if (p.running) {
    startBtn.disabled = true;
    cancelBtn.hidden = false;
    daysSel.disabled = true;
    capSel.disabled = true;
    status.classList.add("is-running");
    status.textContent = "Scanning…";
    qs<HTMLElement>("#cx-history-result-card").hidden = true;
  } else {
    startBtn.disabled = false;
    cancelBtn.hidden = true;
    daysSel.disabled = false;
    capSel.disabled = false;
    if (p.error) {
      status.textContent = `Stopped with error: ${p.error}`;
    } else if (p.finishedAt && p.processed > 0) {
      status.textContent = "";
      qs<HTMLElement>("#cx-history-result-card").hidden = false;
      qs("#cx-h-attempted").textContent = String(p.processed);
      qs("#cx-h-indexed").textContent = String(p.indexed);
      qs("#cx-h-skipped").textContent = String(p.skipped);
      qs("#cx-h-failed").textContent = String(p.fetchFailed);
    } else {
      status.textContent = "";
      qs<HTMLElement>("#cx-history-result-card").hidden = true;
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
  syncPauseToggle(s.indexingPaused);
  qs<HTMLTextAreaElement>("#cx-opt-blocklist").value = s.blocklist.join("\n");

  const mode = s.chatMode ?? "auto";
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-chat-mode"]')
    .forEach((r) => {
      r.checked = r.value === mode;
    });
  (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked = s.cloudChatEnabled;
  (qs("#cx-opt-gemini-key") as HTMLInputElement).value = s.geminiApiKey ?? "";

  renderBlocklistChips();
}

function hideDeleteConfirm(): void {
  qs<HTMLElement>("#cx-delete-confirm").hidden = true;
  qs<HTMLInputElement>("#cx-delete-input").value = "";
  qs<HTMLButtonElement>("#cx-delete-confirm-btn").disabled = true;
  qs<HTMLElement>("#cx-delete-feedback").hidden = true;
  deleteOpenAt = 0;
}

function showDeleteConfirm(): void {
  deleteOpenAt = Date.now();
  qs<HTMLElement>("#cx-delete-confirm").hidden = false;
  qs<HTMLInputElement>("#cx-delete-input").focus();
  updateDeleteConfirmEnabled();
}

function updateDeleteConfirmEnabled(): void {
  const input = qs<HTMLInputElement>("#cx-delete-input");
  const btn = qs<HTMLButtonElement>("#cx-delete-confirm-btn");
  const typed = input.value.trim().toUpperCase() === "DELETE";
  btn.disabled = !(typed || (deleteOpenAt > 0 && Date.now() - deleteOpenAt < 5000));
}

document.addEventListener("DOMContentLoaded", () => {
  void refreshStats();
  void loadSettingsUi();
  void (async () => {
    const p = await fetchHistoryProgress();
    applyHistoryUi(p);
    if (p.running) startHistoryPolling();
  })();

  qs<HTMLButtonElement>("#cx-opt-pause-toggle").addEventListener("click", () => {
    const input = qs<HTMLInputElement>("#cx-opt-pause");
    input.checked = !input.checked;
    syncPauseToggle(input.checked);
  });

  qs<HTMLTextAreaElement>("#cx-opt-blocklist").addEventListener("input", () => {
    renderBlocklistChips();
  });

  qs<HTMLButtonElement>("#cx-opt-retry-stats").addEventListener("click", () => {
    void refreshStats();
  });

  qs<HTMLButtonElement>("#cx-opt-chat-save").addEventListener("click", () => {
    void runSave("#cx-opt-chat-save", "#cx-opt-chat-save-msg", "Save chat settings", () =>
      setUserSettings({
        chatMode: readChatModeFromForm(),
        cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked,
        geminiApiKey: (qs("#cx-opt-gemini-key") as HTMLInputElement).value.trim(),
      })
    );
  });

  qs<HTMLButtonElement>("#cx-opt-save").addEventListener("click", () => {
    void runSave("#cx-opt-save", "#cx-opt-save-msg", "Save privacy settings", async () => {
      await setUserSettings({
        indexingPaused: (qs("#cx-opt-pause") as HTMLInputElement).checked,
        blocklist: domainsFromTextarea(qs("#cx-opt-blocklist")),
        chatMode: readChatModeFromForm(),
        cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked,
        geminiApiKey: (qs("#cx-opt-gemini-key") as HTMLInputElement).value.trim(),
      });
      renderBlocklistChips();
    });
  });

  qs<HTMLButtonElement>("#cx-opt-delete-all").addEventListener("click", () => {
    const panel = qs<HTMLElement>("#cx-delete-confirm");
    if (!panel.hidden) return;
    showDeleteConfirm();
  });

  qs<HTMLInputElement>("#cx-delete-input").addEventListener("input", () => {
    updateDeleteConfirmEnabled();
  });

  qs<HTMLButtonElement>("#cx-delete-cancel-btn").addEventListener("click", () => {
    hideDeleteConfirm();
  });

  qs<HTMLButtonElement>("#cx-delete-confirm-btn").addEventListener("click", async () => {
    const feedback = qs<HTMLElement>("#cx-delete-feedback");
    feedback.hidden = true;
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_CLEAR_ALL_DATA",
    })) as { ok?: boolean; error?: string };

    if (res?.ok) {
      hideDeleteConfirm();
      void refreshStats();
    } else {
      feedback.textContent = res?.error ?? "Could not delete data.";
      feedback.classList.add("is-error");
      feedback.hidden = false;
    }
  });

  qs<HTMLButtonElement>("#cx-opt-history-start").addEventListener("click", async () => {
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

  qs<HTMLButtonElement>("#cx-opt-history-cancel").addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "CORTEX_HISTORY_IMPORT_CANCEL" });
  });
});
