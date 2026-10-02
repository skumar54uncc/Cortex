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

/** Flags that drive the Indexing · Status line (aligned with SW gate). */
export interface IndexingStatusFlags {
  /** Affirmative INDEXING_CONSENT_KEY present. */
  indexingConsented: boolean;
  /** User/settings pause (or managed indexingDisabled → paused). */
  indexingPaused: boolean;
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

/**
 * Honest indexing line: never claim Active when consent is missing or indexing
 * is paused. Order matches service-worker shouldSkipIndexing (consent before pause).
 */
export function applyIndexingStatus(
  refs: Pick<PopupDomRefs, "indexingState" | "indexingDetail">,
  flags: IndexingStatusFlags
): void {
  if (!flags.indexingConsented) {
    refs.indexingState.textContent = "Off";
    refs.indexingState.className = "cx-indexing-state cx-indexing-state--off";
    refs.indexingDetail.textContent = "";
    return;
  }
  if (flags.indexingPaused) {
    refs.indexingState.textContent = "Paused";
    refs.indexingState.className = "cx-indexing-state cx-indexing-state--paused";
    refs.indexingDetail.textContent = " · Search works; new saves off.";
    return;
  }
  refs.indexingState.textContent = "Active";
  refs.indexingState.className = "cx-indexing-state cx-indexing-state--active";
  refs.indexingDetail.textContent = "";
}

export function applySnapshotToDom(
  snap: StatsSnapshot,
  refs: PopupDomRefs,
  activeTab: { url?: string; incognito?: boolean } | undefined,
  indexingConsented: boolean
): void {
  refs.statsError.hidden = true;
  refs.statsDl.classList.remove("cx-stats--dimmed");
  refs.emptyState.hidden = true;
  refs.librarySection.hidden = false;

  refs.pages.textContent = String(snap.pageCount);
  refs.chunks.textContent = String(snap.chunkCount);
  refs.visits.textContent = String(snap.visitCount);

  applyIndexingStatus(refs, {
    indexingConsented,
    indexingPaused: snap.indexingPaused,
  });

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

export function showEmptyState(
  refs: PopupDomRefs,
  indexingConsented: boolean
): void {
  refs.emptyState.hidden = false;
  refs.librarySection.hidden = true;
  refs.statsError.hidden = true;
  refs.currentTab.hidden = true;
  refs.storageWrap.hidden = true;
  applyIndexingStatus(refs, {
    indexingConsented,
    indexingPaused: false,
  });
}

export function showRefreshError(refs: PopupDomRefs, message: string): void {
  refs.statsError.hidden = false;
  const msg = refs.statsError.querySelector("#cx-stats-error-msg");
  if (msg) msg.textContent = message;
}
