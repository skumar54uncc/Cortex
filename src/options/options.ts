import { initBackupUi, saveBlob } from "./backup-ui";
import { normalizePanelPreference } from "../lib/panel-mode";
import {
  getUserSettings,
  setUserSettings,
  type CortexUserSettings,
  type FeatureToggle,
} from "../shared/extension-settings";
import { getEffectiveSettings } from "../shared/managed-policy";
import { applyManagedLockout, stripLockedFields } from "./managed-ui";
import type { HistoryImportProgress } from "../lib/history-import";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import { siteBadgeColors, siteInitial } from "../lib/site-badge";

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
  if (n == null || !Number.isFinite(n)) return "-";
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
    el.textContent = "-";
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
    // Drawn here, never fetched: a favicon service would be told every
    // domain in this list (core value 1).
    const colors = siteBadgeColors(r.host);
    const fav = document.createElement("span");
    fav.className = "cx-recent-favicon cx-recent-fallback";
    fav.setAttribute("aria-hidden", "true");
    fav.style.background = colors.background;
    fav.style.color = colors.text;
    fav.textContent = siteInitial(r.host);

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
      cap !== "-"
        ? `Approximate storage (browser quota): ${used} of ${cap}`
        : `Approximate storage in use: ${used}`;

    renderRecentList(res.recent ?? []);
    statsAnimatedOnce = true;
  } catch {
    pagesEl.textContent = "-";
    chunksEl.textContent = "-";
    visitsEl.textContent = "-";
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

/** Saves only the fields the user may change under the current policy. */
async function saveUserSettings(partial: Partial<CortexUserSettings>): Promise<void> {
  const [user, eff] = await Promise.all([getUserSettings(), getEffectiveSettings()]);
  await setUserSettings(stripLockedFields(partial, eff, user));
}

async function loadSettingsUi(): Promise<void> {
  try {
    const v = chrome.runtime.getManifest().version;
    const el = document.getElementById("cx-about-version");
    if (el && v) el.textContent = v;
  } catch {
    /* not in an extension context */
  }
  const s = await getUserSettings();
  syncPauseToggle(s.indexingPaused);
  qs<HTMLTextAreaElement>("#cx-opt-blocklist").value = s.blocklist.join("\n");

  const mode = s.chatMode ?? "auto";
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-chat-mode"]')
    .forEach((r) => {
      r.checked = r.value === mode;
    });
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-theme"]')
    .forEach((r) => {
      r.checked = r.value === (s.theme ?? "system");
    });
  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-panel-mode"]')
    .forEach((r) => {
      r.checked = r.value === (s.panelPreference ?? "auto");
    });
  (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked = s.cloudChatEnabled;
  (qs("#cx-opt-gemini-key") as HTMLInputElement).value = s.geminiApiKey ?? "";
  qs<HTMLSelectElement>("#cx-opt-retention").value = String(s.retentionDays ?? 0);
  document.querySelectorAll<HTMLInputElement>("input[data-feature]").forEach((box) => {
    const key = box.dataset.feature as FeatureToggle;
    box.checked = Boolean(s[key]);
  });

  renderBlocklistChips();

  // Enterprise policy: lock and label managed fields (Phase 4.1).
  applyManagedLockout(document, await getEffectiveSettings());
}

type CollectionRow = { id: number; name: string; count: number };

async function renderCollections(): Promise<void> {
  const ul = qs<HTMLUListElement>("#cx-collection-list");
  const res = (await chrome.runtime.sendMessage({ type: "CORTEX_COLLECTIONS_LIST" })) as
    | { ok?: boolean; collections?: CollectionRow[] }
    | undefined;
  const rows = res?.ok ? res.collections ?? [] : [];
  ul.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "cx-field-hint";
    li.textContent = "No collections yet.";
    ul.appendChild(li);
    return;
  }
  for (const c of rows) {
    const li = document.createElement("li");
    li.className = "cx-collection-row";
    const name = document.createElement("span");
    name.className = "cx-collection-name";
    name.textContent = c.name;
    const count = document.createElement("span");
    count.className = "cx-field-hint";
    count.textContent = `${c.count} page${c.count === 1 ? "" : "s"}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "cx-btn cx-btn-ghost cx-btn-sm";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete collection ${c.name}`);
    del.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CORTEX_COLLECTION_DELETE", id: c.id });
      void renderCollections();
    });
    li.append(name, count, del);
    ul.appendChild(li);
  }
}

async function createCollectionFromForm(): Promise<void> {
  const input = qs<HTMLInputElement>("#cx-collection-name");
  const fb = qs<HTMLElement>("#cx-collection-feedback");
  const res = (await chrome.runtime.sendMessage({
    type: "CORTEX_COLLECTION_CREATE",
    name: input.value,
  })) as { ok?: boolean; error?: string } | undefined;
  fb.classList.toggle("is-error", !res?.ok);
  fb.textContent = res?.ok ? "Collection created." : res?.error ?? "Could not create the collection.";
  fb.hidden = false;
  if (res?.ok) input.value = "";
  void renderCollections();
}

async function runForget(scope: "site" | "hour" | "day", hostname?: string): Promise<void> {
  const fb = qs<HTMLElement>("#cx-forget-feedback");
  fb.classList.remove("is-error");
  fb.hidden = true;
  const res = (await chrome.runtime.sendMessage({
    type: "CORTEX_FORGET",
    scope,
    hostname,
  })) as
    | { ok?: boolean; error?: string; site?: string; counts?: { documents?: number; messages?: number } }
    | undefined;
  if (res?.ok) {
    const pages = res.counts?.documents ?? 0;
    const what =
      scope === "site" ? `${res.site}` : scope === "hour" ? "the last hour" : "the last day";
    fb.textContent = `Forgot ${what}: ${pages} page${pages === 1 ? "" : "s"} removed.`;
    fb.hidden = false;
    void refreshStats();
  } else {
    fb.textContent =
      res?.error === "bad_hostname" ? "Enter a site like example.com." : "Could not forget that data.";
    fb.classList.add("is-error");
    fb.hidden = false;
  }
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

/**
 * Sticky section nav: marks the section the reader is in with aria-current so
 * it is announced as well as highlighted. Links stay plain anchors, so jumping
 * works with the keyboard and without this script.
 */
function initSectionNav(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".cx-nav-link")];
  const pairs: { id: string; link: HTMLAnchorElement; section: HTMLElement }[] = [];
  for (const link of links) {
    const id = link.getAttribute("href")?.slice(1) ?? "";
    const section = id ? document.getElementById(id) : null;
    if (section) pairs.push({ id, link, section });
  }
  if (!pairs.length) return;

  const setCurrent = (id: string): void => {
    for (const p of pairs) {
      if (p.id === id) p.link.setAttribute("aria-current", "true");
      else p.link.removeAttribute("aria-current");
    }
  };

  // Move focus to the section so the keyboard lands where the eye does.
  for (const p of pairs) {
    p.link.addEventListener("click", () => {
      setCurrent(p.id);
      window.setTimeout(() => p.section.focus({ preventScroll: true }), 0);
    });
  }

  // The section whose top has passed just under the sticky bar wins. At the
  // very bottom the last section is short and never gets there, so pin it.
  const LINE = 140;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    const doc = document.documentElement;
    const atBottom =
      window.innerHeight + Math.ceil(window.scrollY) >= doc.scrollHeight - 2;
    let id = pairs[pairs.length - 1].id;
    if (!atBottom) {
      id = pairs[0].id;
      for (const p of pairs) {
        if (p.section.getBoundingClientRect().top <= LINE) id = p.id;
      }
    }
    setCurrent(id);
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();
}

function updateDeleteConfirmEnabled(): void {
  const input = qs<HTMLInputElement>("#cx-delete-input");
  const btn = qs<HTMLButtonElement>("#cx-delete-confirm-btn");
  const typed = input.value.trim().toUpperCase() === "DELETE";
  btn.disabled = !(typed || (deleteOpenAt > 0 && Date.now() - deleteOpenAt < 5000));
}

document.addEventListener("DOMContentLoaded", () => {
  initBackupUi(document, {
    send: (m) => chrome.runtime.sendMessage(m),
    download: saveBlob,
    onRestored: () => void refreshStats(),
  });
  initSectionNav();
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

  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-theme"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const theme =
          r.value === "light" || r.value === "dark" ? r.value : "system";
        void setUserSettings({ theme });
      });
    });

  document
    .querySelectorAll<HTMLInputElement>('input[name="cx-panel-mode"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        void setUserSettings({ panelPreference: normalizePanelPreference(r.value) });
      });
    });

  qs<HTMLButtonElement>("#cx-opt-retry-stats").addEventListener("click", () => {
    void refreshStats();
  });

  document.querySelectorAll<HTMLInputElement>("input[data-feature]").forEach((box) => {
    box.addEventListener("change", () => {
      const key = box.dataset.feature as FeatureToggle;
      void saveUserSettings({ [key]: box.checked } as Partial<CortexUserSettings>);
    });
  });

  qs<HTMLSelectElement>("#cx-opt-retention").addEventListener("change", (e) => {
    const v = Number((e.target as HTMLSelectElement).value);
    void saveUserSettings({ retentionDays: Number.isFinite(v) && v >= 1 ? v : 0 });
  });

  void renderCollections();
  qs<HTMLButtonElement>("#cx-collection-create").addEventListener("click", () => void createCollectionFromForm());
  qs<HTMLInputElement>("#cx-collection-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void createCollectionFromForm();
  });

  qs<HTMLButtonElement>("#cx-forget-site-btn").addEventListener("click", () => {
    const host = qs<HTMLInputElement>("#cx-forget-site").value.trim();
    void runForget("site", host);
  });
  qs<HTMLButtonElement>("#cx-forget-hour").addEventListener("click", () => void runForget("hour"));
  qs<HTMLButtonElement>("#cx-forget-day").addEventListener("click", () => void runForget("day"));

  // Policy pushed while the page is open: re-apply the lockout.
  chrome.storage?.onChanged?.addListener((_changes, area) => {
    if (area === "managed") void loadSettingsUi();
  });

  qs<HTMLButtonElement>("#cx-opt-chat-save").addEventListener("click", () => {
    void runSave("#cx-opt-chat-save", "#cx-opt-chat-save-msg", "Save chat settings", () =>
      saveUserSettings({
        chatMode: readChatModeFromForm(),
        cloudChatEnabled: (qs("#cx-opt-cloud-chat") as HTMLInputElement).checked,
        geminiApiKey: (qs("#cx-opt-gemini-key") as HTMLInputElement).value.trim(),
      })
    );
  });

  qs<HTMLButtonElement>("#cx-opt-save").addEventListener("click", () => {
    void runSave("#cx-opt-save", "#cx-opt-save-msg", "Save privacy settings", async () => {
      await saveUserSettings({
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
