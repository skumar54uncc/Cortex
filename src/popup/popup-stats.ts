import type { StatsSnapshot } from "../lib/stats-snapshot-types";

export interface PopupDomRefs {
  pages: HTMLElement;
  chunks: HTMLElement;
  visits: HTMLElement;
  indexingState: HTMLElement;
  indexingDetail: HTMLElement;
  currentTab: HTMLElement;
  storageWrap: HTMLElement;
  storageBar: HTMLElement;
  storageText: HTMLElement;
  statsDl: HTMLElement;
  statsError: HTMLElement;
  librarySection: HTMLElement;
  emptyState: HTMLElement;
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function applySnapshotToDom(
  snap: StatsSnapshot,
  refs: PopupDomRefs,
  activeTab?: { url?: string; incognito?: boolean }
): void {
  refs.statsError.hidden = true;
  refs.statsDl.classList.remove("cx-stats--dimmed");
  refs.emptyState.hidden = true;
  refs.librarySection.hidden = false;

  refs.pages.textContent = String(snap.pageCount);
  refs.chunks.textContent = String(snap.chunkCount);
  refs.visits.textContent = String(snap.visitCount);

  if (snap.indexingPaused) {
    refs.indexingState.textContent = "Paused";
    refs.indexingState.className = "cx-indexing-state cx-indexing-state--paused";
    refs.indexingDetail.textContent = " · Search works; new saves off.";
  } else {
    refs.indexingState.textContent = "Active";
    refs.indexingState.className = "cx-indexing-state cx-indexing-state--active";
    refs.indexingDetail.textContent = "";
  }

  const ct = snap.currentTab;
  const tabUrl = activeTab?.url;
  if (
    ct?.line &&
    tabUrl &&
    tabUrl.startsWith("http") &&
    ct.tabUrl === tabUrl &&
    ct.tabIncognito === Boolean(activeTab.incognito)
  ) {
    refs.currentTab.textContent = ct.line;
    refs.currentTab.hidden = false;
  } else {
    refs.currentTab.hidden = true;
    refs.currentTab.textContent = "";
  }

  const bytes = snap.storageBytes;
  const quota = snap.storageQuotaBytes;
  if (
    typeof bytes === "number" &&
    Number.isFinite(bytes) &&
    typeof quota === "number" &&
    Number.isFinite(quota) &&
    quota > 0
  ) {
    refs.storageWrap.hidden = false;
    const pct = Math.min(100, Math.max(0, (bytes / quota) * 100));
    refs.storageBar.style.width = `${pct}%`;
    refs.storageText.textContent = `${fmtBytes(bytes)} / ${fmtBytes(quota)}`;
  } else if (typeof bytes === "number" && Number.isFinite(bytes)) {
    refs.storageWrap.hidden = false;
    refs.storageBar.style.width = "2%";
    refs.storageText.textContent = `${fmtBytes(bytes)} in use`;
  } else {
    refs.storageWrap.hidden = true;
  }
}

export function showEmptyState(refs: PopupDomRefs): void {
  refs.emptyState.hidden = false;
  refs.librarySection.hidden = true;
  refs.statsError.hidden = true;
  refs.currentTab.hidden = true;
  refs.storageWrap.hidden = true;
  refs.indexingState.textContent = "Active";
  refs.indexingState.className = "cx-indexing-state cx-indexing-state--active";
  refs.indexingDetail.textContent = "";
}

export function showRefreshError(refs: PopupDomRefs, message: string): void {
  refs.statsError.hidden = false;
  const msg = refs.statsError.querySelector("#cx-stats-error-msg");
  if (msg) msg.textContent = message;
}
