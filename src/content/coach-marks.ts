/**
 * Lightweight first-run coach marks on overlay controls.
 * Dismissals persist in chrome.storage.local via ux-local.
 */
import {
  COACH_COPY,
  dismissCoachTip,
  loadUxLocalState,
  nextCoachTip,
  type CoachTipId,
} from "../shared/ux-local";

export interface CoachMarkTarget {
  id: CoachTipId;
  /** Element the tip points at (tab button, gear, etc.). */
  anchor: HTMLElement;
}

export interface CoachMarksController {
  refresh: (targets: CoachMarkTarget[]) => void;
  destroy: () => void;
}

export function installCoachMarks(host: HTMLElement): CoachMarksController {
  let tipEl: HTMLElement | null = null;
  let currentId: CoachTipId | null = null;
  let destroyed = false;

  const clear = (): void => {
    tipEl?.remove();
    tipEl = null;
    currentId = null;
  };

  const show = (target: CoachMarkTarget): void => {
    clear();
    currentId = target.id;
    const copy = COACH_COPY[target.id];
    const tip = document.createElement("div");
    tip.className = "cortex-coach";
    tip.setAttribute("role", "dialog");
    tip.setAttribute("aria-label", copy.title);
    tip.dataset.coachId = target.id;

    const arrow = document.createElement("div");
    arrow.className = "cortex-coach-arrow";
    arrow.setAttribute("aria-hidden", "true");

    const title = document.createElement("p");
    title.className = "cortex-coach-title";
    title.textContent = copy.title;

    const body = document.createElement("p");
    body.className = "cortex-coach-body";
    body.textContent = copy.body;

    const actions = document.createElement("div");
    actions.className = "cortex-coach-actions";
    const gotIt = document.createElement("button");
    gotIt.type = "button";
    gotIt.className = "cortex-coach-dismiss";
    gotIt.textContent = "Got it";
    gotIt.addEventListener("click", () => {
      void dismissCoachTip(target.id).then(() => {
        if (destroyed) return;
        clear();
      });
    });
    actions.appendChild(gotIt);

    tip.append(arrow, title, body, actions);
    host.appendChild(tip);
    tipEl = tip;

    // Position below the anchor when possible; otherwise above.
    const hostRect = host.getBoundingClientRect();
    const a = target.anchor.getBoundingClientRect();
    const tipW = Math.min(280, hostRect.width - 24);
    tip.style.width = `${tipW}px`;
    const tipH = tip.offsetHeight || 96;
    let left = a.left - hostRect.left + a.width / 2 - tipW / 2;
    left = Math.max(12, Math.min(left, hostRect.width - tipW - 12));
    const below = a.bottom - hostRect.top + 10;
    const above = a.top - hostRect.top - tipH - 10;
    const placeBelow = below + tipH < hostRect.height - 8 || above < 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${placeBelow ? below : Math.max(8, above)}px`;
    tip.classList.toggle("cortex-coach--above", !placeBelow);
    const arrowLeft = a.left - hostRect.left + a.width / 2 - left - 6;
    arrow.style.left = `${Math.max(12, Math.min(arrowLeft, tipW - 18))}px`;
  };

  const refresh = (targets: CoachMarkTarget[]): void => {
    if (destroyed) return;
    void loadUxLocalState().then((state) => {
      if (destroyed) return;
      const available = targets.map((t) => t.id);
      const next = nextCoachTip(state, available);
      if (!next) {
        clear();
        return;
      }
      if (currentId === next && tipEl) return;
      const target = targets.find((t) => t.id === next);
      if (target) show(target);
    });
  };

  return {
    refresh,
    destroy: () => {
      destroyed = true;
      clear();
    },
  };
}
