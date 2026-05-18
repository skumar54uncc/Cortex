import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import type { StatsSnapshot } from "../lib/stats-snapshot-types";
import {
  isSnapshotStale,
  readSnapshot,
} from "../lib/stats-snapshot-storage";
import { sendRuntimeMessage } from "../shared/extension-runtime";
import { storageLocalGet, storageLocalSet } from "../shared/storage-local";
import {
  applySnapshotToDom,
  showEmptyState,
  showRefreshError,
  type PopupDomRefs,
} from "./popup-stats";

const POPUP_PRIVACY_ACK_KEY = "cortex_popup_privacy_ack_v1";

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(sel);
  return el as T;
}

function popupRefs(): PopupDomRefs {
  return {
    pages: qs("#cx-pages"),
    chunks: qs("#cx-chunks"),
    visits: qs("#cx-visits"),
    indexingState: qs("#cx-indexing-state"),
    indexingDetail: qs("#cx-indexing-detail"),
    currentTab: qs("#cx-current-tab"),
    storageWrap: qs("#cx-storage-wrap"),
    storageBar: qs("#cx-storage-bar"),
    storageText: qs("#cx-storage-text"),
    statsDl: qs("#cx-stats-dl"),
    statsError: qs("#cx-stats-error"),
    librarySection: qs("#cx-popup-library"),
    emptyState: qs("#cx-empty-state"),
  };
}

async function activeTabInfo(): Promise<
  { url?: string; incognito?: boolean } | undefined
> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tab ? { url: tab.url, incognito: tab.incognito } : undefined;
  } catch {
    return undefined;
  }
}

async function refreshPrivacyBlurb(): Promise<void> {
  const wrap = document.querySelector<HTMLElement>("#cx-privacy-blurb");
  if (!wrap) return;
  try {
    const r = await storageLocalGet([POPUP_PRIVACY_ACK_KEY]);
    wrap.hidden = Boolean(r[POPUP_PRIVACY_ACK_KEY]);
  } catch {
    wrap.hidden = false;
  }
}

function setRefreshSpinning(spinning: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>("#cx-stats-refresh");
  if (!btn) return;
  btn.disabled = spinning;
  btn.classList.toggle("cx-stats-refresh--busy", spinning);
  btn.setAttribute("aria-busy", spinning ? "true" : "false");
}

async function refreshSnapshotFromBackground(): Promise<StatsSnapshot> {
  const tab = await activeTabInfo();
  const res = (await sendRuntimeMessage({
    type: "CORTEX_STATS_REFRESH",
    tabUrl: tab?.url,
    tabIncognito: tab?.incognito,
  })) as
    | { ok?: boolean; snapshot?: StatsSnapshot; error?: string }
    | undefined;

  if (res?.ok && res.snapshot) return res.snapshot;
  throw new Error(
    typeof res?.error === "string" && res.error.trim()
      ? res.error
      : "Couldn’t refresh stats"
  );
}

export async function loadPopup(): Promise<void> {
  const refs = popupRefs();
  const snap = await readSnapshot();

  if (snap == null) {
    showEmptyState(refs);
    return;
  }

  const tab = await activeTabInfo();
  applySnapshotToDom(snap, refs, tab);

  if (isSnapshotStale(snap)) {
    void (async () => {
      try {
        const fresh = await refreshSnapshotFromBackground();
        const t = await activeTabInfo();
        applySnapshotToDom(fresh, refs, t);
      } catch {
        /* keep last good snapshot */
      }
    })();
  }
}

async function onManualRefresh(): Promise<void> {
  const refs = popupRefs();
  setRefreshSpinning(true);
  refs.statsError.hidden = true;
  try {
    const fresh = await refreshSnapshotFromBackground();
    const tab = await activeTabInfo();
    applySnapshotToDom(fresh, refs, tab);
  } catch (e: unknown) {
    showRefreshError(
      refs,
      e instanceof Error && e.message ? e.message : "Couldn’t refresh stats."
    );
  } finally {
    setRefreshSpinning(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  injectBrandFontFacesInto(document.head);
  void refreshPrivacyBlurb();
  void loadPopup();

  qs("#cx-privacy-ack").addEventListener("click", () => {
    void storageLocalSet({ [POPUP_PRIVACY_ACK_KEY]: true });
    qs<HTMLElement>("#cx-privacy-blurb").hidden = true;
  });

  qs("#cx-open-settings").addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  qs("#cx-open-search").addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "CORTEX_POPUP_OPEN_SEARCH" });
    window.close();
  });

  qs("#cx-stats-refresh").addEventListener("click", () => {
    void onManualRefresh();
  });

  qs("#cx-empty-get-started").addEventListener("click", () => {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html"),
      active: true,
    });
    window.close();
  });
});
