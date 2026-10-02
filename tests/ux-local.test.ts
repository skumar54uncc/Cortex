import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installChromeStorageMock } from "./helpers/chrome-storage-mock";
import {
  dismissCoachTip,
  FEEDBACK_COOLDOWN_MS,
  FEEDBACK_MIN_DAYS,
  FEEDBACK_MIN_OPENS,
  FEEDBACK_MIN_PAGES,
  loadUxLocalState,
  nextCoachTip,
  parseUxLocalState,
  recordPanelOpen,
  shouldShowFeedback,
  submitFeedbackLocal,
  type UxLocalState,
} from "../src/shared/ux-local";

describe("ux-local feedback gate", () => {
  it("parses empty and partial state safely", () => {
    expect(parseUxLocalState(null).panelOpenCount).toBe(0);
    expect(parseUxLocalState({ panelOpenCount: 2, coachDismissed: { search: true } }).coachDismissed.search).toBe(
      true
    );
  });

  it("requires tenure or meaningful use", () => {
    const base: UxLocalState = {
      firstSeenAt: Date.parse("2026-09-01T12:00:00Z"),
      panelOpenCount: 1,
      coachDismissed: {},
    };
    const now = Date.parse("2026-09-03T12:00:00Z"); // 2 days
    expect(
      shouldShowFeedback({ state: base, pageCount: 100, now })
    ).toBe(false);

    expect(
      shouldShowFeedback({
        state: { ...base, panelOpenCount: FEEDBACK_MIN_OPENS },
        pageCount: FEEDBACK_MIN_PAGES,
        now,
      })
    ).toBe(true);

    const later = base.firstSeenAt + FEEDBACK_MIN_DAYS * 24 * 60 * 60 * 1000 + 1000;
    expect(shouldShowFeedback({ state: base, pageCount: 0, now: later })).toBe(true);
  });

  it("stays quiet after dismiss or submit for the cooldown", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const state: UxLocalState = {
      firstSeenAt: now - FEEDBACK_MIN_DAYS * 24 * 60 * 60 * 1000 - 1,
      panelOpenCount: 10,
      coachDismissed: {},
      feedbackDismissedAt: now - 1000,
    };
    expect(shouldShowFeedback({ state, pageCount: 50, now })).toBe(false);
    expect(
      shouldShowFeedback({
        state: {
          ...state,
          feedbackDismissedAt: now - FEEDBACK_COOLDOWN_MS - 1,
        },
        pageCount: 50,
        now,
      })
    ).toBe(true);
  });

  it("returns the first undismissed coach tip", () => {
    const state: UxLocalState = {
      firstSeenAt: 1,
      panelOpenCount: 1,
      coachDismissed: { search: true, ask: true },
    };
    expect(nextCoachTip(state, ["search", "ask", "agents"])).toBe("agents");
    expect(nextCoachTip(state, ["search", "ask"])).toBeNull();
  });
});

describe("ux-local storage", () => {
  let restore: (() => void) | undefined;

  beforeEach(() => {
    restore = installChromeStorageMock();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("records panel opens and persists coach dismissals", async () => {
    const t0 = Date.parse("2026-09-20T10:00:00Z");
    const a = await recordPanelOpen(t0);
    expect(a.firstSeenAt).toBe(t0);
    expect(a.panelOpenCount).toBe(1);
    const b = await recordPanelOpen(t0 + 1000);
    expect(b.firstSeenAt).toBe(t0);
    expect(b.panelOpenCount).toBe(2);
    await dismissCoachTip("agents");
    const loaded = await loadUxLocalState();
    expect(loaded.coachDismissed.agents).toBe(true);
    await submitFeedbackLocal({ thumb: "up", note: "solid", now: t0 + 2000 });
    const after = await loadUxLocalState();
    expect(after.feedbackThumb).toBe("up");
    expect(after.feedbackNote).toBe("solid");
    expect(after.feedbackSubmittedAt).toBe(t0 + 2000);
  });
});
