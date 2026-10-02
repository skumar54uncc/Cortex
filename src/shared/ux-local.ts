/**
 * First-run coach marks and delayed product feedback.
 * Local chrome.storage.local only. No telemetry backend.
 */

import { storageLocalGet, storageLocalSet } from "./storage-local";

export const UX_LOCAL_KEY = "cortex_ux_local_v1";

export const COACH_TIP_IDS = [
  "search",
  "ask",
  "people",
  "agents",
  "assistSync",
] as const;

export type CoachTipId = (typeof COACH_TIP_IDS)[number];

export interface UxLocalState {
  firstSeenAt: number;
  panelOpenCount: number;
  coachDismissed: Partial<Record<CoachTipId, true>>;
  /** When the feedback card was last shown (ms). */
  feedbackShownAt?: number;
  /** User dismissed without submitting. */
  feedbackDismissedAt?: number;
  /** User submitted thumbs / note (or opened external link). */
  feedbackSubmittedAt?: number;
  /** Last local note (optional). Never sent automatically. */
  feedbackNote?: string;
  feedbackThumb?: "up" | "down";
}

export const FEEDBACK_MIN_DAYS = 7;
export const FEEDBACK_MIN_PAGES = 20;
export const FEEDBACK_MIN_OPENS = 3;
/** Quiet period after dismiss or submit (90 days). */
export const FEEDBACK_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

export const FEEDBACK_GITHUB_NEW_ISSUE =
  "https://github.com/skumar54uncc/Cortex/issues/new";

export const FEEDBACK_MAILTO =
  "mailto:shailesh.entrant@gmail.com?subject=Cortex%20product%20feedback";

const EMPTY: UxLocalState = {
  firstSeenAt: 0,
  panelOpenCount: 0,
  coachDismissed: {},
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseUxLocalState(raw: unknown): UxLocalState {
  if (!isRecord(raw)) return { ...EMPTY, coachDismissed: {} };
  const coachDismissed: Partial<Record<CoachTipId, true>> = {};
  if (isRecord(raw.coachDismissed)) {
    for (const id of COACH_TIP_IDS) {
      if (raw.coachDismissed[id] === true) coachDismissed[id] = true;
    }
  }
  const state: UxLocalState = {
    firstSeenAt: typeof raw.firstSeenAt === "number" ? raw.firstSeenAt : 0,
    panelOpenCount: typeof raw.panelOpenCount === "number" ? raw.panelOpenCount : 0,
    coachDismissed,
  };
  if (typeof raw.feedbackShownAt === "number") state.feedbackShownAt = raw.feedbackShownAt;
  if (typeof raw.feedbackDismissedAt === "number") {
    state.feedbackDismissedAt = raw.feedbackDismissedAt;
  }
  if (typeof raw.feedbackSubmittedAt === "number") {
    state.feedbackSubmittedAt = raw.feedbackSubmittedAt;
  }
  if (typeof raw.feedbackNote === "string") state.feedbackNote = raw.feedbackNote.slice(0, 2000);
  if (raw.feedbackThumb === "up" || raw.feedbackThumb === "down") {
    state.feedbackThumb = raw.feedbackThumb;
  }
  return state;
}

export async function loadUxLocalState(): Promise<UxLocalState> {
  const bag = await storageLocalGet(UX_LOCAL_KEY);
  return parseUxLocalState(bag[UX_LOCAL_KEY]);
}

export async function saveUxLocalState(state: UxLocalState): Promise<void> {
  await storageLocalSet({ [UX_LOCAL_KEY]: state });
}

/** Record a panel open. Sets firstSeenAt on first call. */
export async function recordPanelOpen(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  if (!state.firstSeenAt) state.firstSeenAt = now;
  state.panelOpenCount = Math.max(0, state.panelOpenCount) + 1;
  await saveUxLocalState(state);
  return state;
}

export async function dismissCoachTip(id: CoachTipId): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  state.coachDismissed = { ...state.coachDismissed, [id]: true };
  await saveUxLocalState(state);
  return state;
}

export function nextCoachTip(
  state: UxLocalState,
  available: readonly CoachTipId[]
): CoachTipId | null {
  for (const id of available) {
    if (!state.coachDismissed[id]) return id;
  }
  return null;
}

export interface FeedbackGateInput {
  state: UxLocalState;
  /** Indexed page count from local stats snapshot (0 if unknown). */
  pageCount: number;
  now?: number;
}

/**
 * Show delayed feedback when the user has meaningful tenure or use,
 * and has not dismissed/submitted within the cooldown.
 */
export function shouldShowFeedback(input: FeedbackGateInput): boolean {
  const now = input.now ?? Date.now();
  const { state, pageCount } = input;
  const quietAt = Math.max(state.feedbackDismissedAt ?? 0, state.feedbackSubmittedAt ?? 0);
  if (quietAt > 0 && now - quietAt < FEEDBACK_COOLDOWN_MS) return false;

  const first = state.firstSeenAt;
  if (!first) return false;

  const days = (now - first) / (24 * 60 * 60 * 1000);
  const byDays = days >= FEEDBACK_MIN_DAYS;
  const byUse =
    pageCount >= FEEDBACK_MIN_PAGES && state.panelOpenCount >= FEEDBACK_MIN_OPENS;
  return byDays || byUse;
}

export async function markFeedbackShown(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  state.feedbackShownAt = now;
  await saveUxLocalState(state);
  return state;
}

export async function dismissFeedback(now = Date.now()): Promise<UxLocalState> {
  const state = await loadUxLocalState();
  state.feedbackDismissedAt = now;
  await saveUxLocalState(state);
  return state;
}

export async function submitFeedbackLocal(input: {
  thumb: "up" | "down";
  note?: string;
  now?: number;
}): Promise<UxLocalState> {
  const now = input.now ?? Date.now();
  const state = await loadUxLocalState();
  state.feedbackSubmittedAt = now;
  state.feedbackThumb = input.thumb;
  if (input.note != null) state.feedbackNote = input.note.slice(0, 2000);
  await saveUxLocalState(state);
  return state;
}

export const COACH_COPY: Record<CoachTipId, { title: string; body: string }> = {
  search: { title: "Search", body: "Find pages you already read by phrase, site, or topic." },
  ask: { title: "Ask", body: "Ask in plain language. Answers cite your local library." },
  people: { title: "People and companies", body: "LinkedIn profiles appear here when people memory is on." },
  agents: { title: "Connect AI agents", body: "Teach assistants to use your Cortex Memory sheet." },
  assistSync: { title: "Assist Sync", body: "Enable Assist Sync in Settings for the live sheet." },
};
