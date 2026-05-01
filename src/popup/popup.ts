import "../styles/cortex-theme.css";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import { agentDebugLog } from "../lib/agent-debug-log";
import { sendRuntimeMessage } from "../shared/extension-runtime";

const POPUP_PRIVACY_ACK_KEY = "cortex_popup_privacy_ack_v1";

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

async function refreshPrivacyBlurb(): Promise<void> {
  const wrap = document.querySelector<HTMLElement>("#cx-privacy-blurb");
  if (!wrap) return;
  try {
    const r = await chrome.storage.local.get(POPUP_PRIVACY_ACK_KEY);
    wrap.hidden = Boolean(r[POPUP_PRIVACY_ACK_KEY]);
  } catch {
    wrap.hidden = false;
  }
}

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(sel);
  return el as T;
}

async function loadPopup(): Promise<void> {
  const errBox = qs<HTMLElement>("#cx-stats-error");
  const errMsg = qs<HTMLElement>("#cx-stats-error-msg");
  const retry = qs<HTMLButtonElement>("#cx-retry-stats");
  const statsDl = qs<HTMLElement>("#cx-stats-dl");
  const indexingState = qs<HTMLElement>("#cx-indexing-state");
  const indexingDetail = qs<HTMLElement>("#cx-indexing-detail");
  const currentTabEl = qs<HTMLElement>("#cx-current-tab");

  errBox.hidden = true;
  statsDl.classList.remove("cx-stats--dimmed");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const res = (await sendRuntimeMessage({
      type: "CORTEX_STATS",
      tabUrl: tab?.url,
      tabIncognito: tab?.incognito,
    })) as
      | {
          ok?: boolean;
          error?: string;
          pageCount?: number;
          chunkCount?: number;
          visitCount?: number;
          indexingPaused?: boolean;
          storageBytes?: number;
          storageQuotaBytes?: number;
          currentTab?: {
            line: string;
            badge: string;
          };
        }
      | undefined;

    if (res == null) {
      throw new Error(
        "Background did not respond — open chrome://extensions and reload Cortex."
      );
    }

    if (!res.ok) {
      throw new Error(
        typeof res.error === "string" && res.error.trim()
          ? res.error
          : "Stats unavailable"
      );
    }

    qs("#cx-pages").textContent =
      typeof res.pageCount === "number" ? String(res.pageCount) : "—";
    qs("#cx-chunks").textContent =
      typeof res.chunkCount === "number" ? String(res.chunkCount) : "—";
    qs("#cx-visits").textContent =
      typeof res.visitCount === "number" ? String(res.visitCount) : "—";

    if (res.indexingPaused) {
      indexingState.textContent = "Paused";
      indexingState.className = "cx-indexing-state cx-indexing-state--paused";
      indexingDetail.textContent = " · Search works; new saves off.";
    } else {
      indexingState.textContent = "Active";
      indexingState.className = "cx-indexing-state cx-indexing-state--active";
      indexingDetail.textContent = "";
    }

    if (res.currentTab?.line && tab?.url?.startsWith("http")) {
      currentTabEl.textContent = res.currentTab.line;
      currentTabEl.hidden = false;
    } else {
      currentTabEl.hidden = true;
      currentTabEl.textContent = "";
    }

    const storageWrap = qs<HTMLElement>("#cx-storage-wrap");
    const storageBar = qs<HTMLElement>("#cx-storage-bar");
    const storageText = qs<HTMLElement>("#cx-storage-text");
    const bytes = res.storageBytes;
    const quota = res.storageQuotaBytes;
    if (
      typeof bytes === "number" &&
      Number.isFinite(bytes) &&
      typeof quota === "number" &&
      Number.isFinite(quota) &&
      quota > 0
    ) {
      storageWrap.hidden = false;
      const pct = Math.min(100, Math.max(0, (bytes / quota) * 100));
      storageBar.style.width = `${pct}%`;
      storageText.textContent = `${fmtBytes(bytes)} / ${fmtBytes(quota)}`;
    } else if (typeof bytes === "number" && Number.isFinite(bytes)) {
      storageWrap.hidden = false;
      storageBar.style.width = "2%";
      storageText.textContent = `${fmtBytes(bytes)} in use`;
    } else {
      storageWrap.hidden = true;
    }
  } catch (e: unknown) {
    // #region agent log
    agentDebugLog({
      hypothesisId: "H3",
      location: "popup.ts:loadPopup",
      message: "popup_stats_failed",
      data: {
        lastError: chrome.runtime.lastError?.message,
        err: e instanceof Error ? e.message : String(e),
      },
    });
    // #endregion
    qs("#cx-pages").textContent = "—";
    qs("#cx-chunks").textContent = "—";
    qs("#cx-visits").textContent = "—";
    errMsg.textContent =
      e instanceof Error && e.message && e.message !== "Stats unavailable"
        ? e.message
        : "Couldn’t load library stats.";
    errBox.hidden = false;
    retry.hidden = false;
    statsDl.classList.add("cx-stats--dimmed");
    indexingState.textContent = "—";
    indexingState.className = "cx-indexing-state";
    indexingDetail.textContent = " Couldn’t load status.";
    currentTabEl.hidden = true;
    qs<HTMLElement>("#cx-storage-wrap").hidden = true;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  qs("#cx-privacy-ack").addEventListener("click", () => {
    void chrome.storage.local.set({ [POPUP_PRIVACY_ACK_KEY]: true });
    const wrap = qs<HTMLElement>("#cx-privacy-blurb");
    wrap.hidden = true;
  });

  qs("#cx-open-settings").addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  qs("#cx-open-search").addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "CORTEX_POPUP_OPEN_SEARCH" });
    window.close();
  });

  qs("#cx-retry-stats").addEventListener("click", () => {
    void loadPopup();
  });

  // Defer font injection + async stats until after first paint so the popup
  // shell appears immediately (MV3 SW wake-up still affects round-trip time).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      injectBrandFontFacesInto(document.head);
      void refreshPrivacyBlurb();
      void loadPopup();
    });
  });
});
