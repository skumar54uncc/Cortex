/** Local-only delayed feedback card. No telemetry. */
import {
  dismissFeedback,
  FEEDBACK_GITHUB_NEW_ISSUE,
  FEEDBACK_MAILTO,
  markFeedbackShown,
  shouldShowFeedback,
  submitFeedbackLocal,
  type UxLocalState,
} from "../shared/ux-local";
import { parseStatsSnapshot, STATS_SNAPSHOT_STORAGE_KEY } from "../lib/stats-snapshot-types";
import { storageLocalGet } from "../shared/storage-local";

export interface FeedbackCardController {
  maybeShow: (state: UxLocalState) => void;
  destroy: () => void;
}

async function pageCount(): Promise<number> {
  const bag = await storageLocalGet(STATS_SNAPSHOT_STORAGE_KEY);
  return parseStatsSnapshot(bag[STATS_SNAPSHOT_STORAGE_KEY])?.pageCount ?? 0;
}

export function installFeedbackCard(host: HTMLElement): FeedbackCardController {
  let card: HTMLElement | null = null;
  let dead = false;
  const clear = (): void => {
    card?.remove();
    card = null;
  };

  const open = (href: string): void => {
    if (href.startsWith("https://github.com/skumar54uncc/Cortex/")) {
      void chrome.runtime.sendMessage({ type: "CORTEX_OPEN_TAB", url: href });
      return;
    }
    if (!href.startsWith("mailto:")) return;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener noreferrer";
    host.appendChild(a);
    a.click();
    a.remove();
  };

  const render = (): void => {
    clear();
    const root = document.createElement("aside");
    root.className = "cortex-feedback";
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Product feedback");
    const title = document.createElement("p");
    title.className = "cortex-feedback-title";
    title.textContent = "How is Cortex working for you?";
    const hint = document.createElement("p");
    hint.className = "cortex-feedback-hint cortex-muted";
    hint.textContent = "Stays on this device unless you open email or GitHub. No telemetry.";
    const thumbs = document.createElement("div");
    thumbs.className = "cortex-feedback-thumbs";
    const up = document.createElement("button");
    up.type = "button";
    up.className = "cortex-feedback-thumb is-active";
    up.textContent = "Helpful";
    const down = document.createElement("button");
    down.type = "button";
    down.className = "cortex-feedback-thumb";
    down.textContent = "Needs work";
    thumbs.append(up, down);
    const note = document.createElement("textarea");
    note.className = "cortex-feedback-note";
    note.rows = 2;
    note.maxLength = 500;
    note.placeholder = "Optional note (local only)";
    note.setAttribute("aria-label", "Optional feedback note");
    const actions = document.createElement("div");
    actions.className = "cortex-feedback-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "cortex-feedback-primary";
    save.textContent = "Save locally";
    const gh = document.createElement("button");
    gh.type = "button";
    gh.className = "cortex-feedback-link";
    gh.textContent = "GitHub";
    const mail = document.createElement("button");
    mail.type = "button";
    mail.className = "cortex-feedback-link";
    mail.textContent = "Email";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "cortex-feedback-dismiss";
    dismiss.textContent = "Not now";
    actions.append(save, gh, mail, dismiss);
    root.append(title, hint, thumbs, note, actions);
    host.appendChild(root);
    card = root;

    let thumb: "up" | "down" = "up";
    const setThumb = (t: "up" | "down"): void => {
      thumb = t;
      up.classList.toggle("is-active", t === "up");
      down.classList.toggle("is-active", t === "down");
    };
    up.addEventListener("click", () => setThumb("up"));
    down.addEventListener("click", () => setThumb("down"));
    const finish = (fn: () => void): void => {
      void submitFeedbackLocal({ thumb, note: note.value.trim() }).then(() => {
        fn();
        clear();
      });
    };
    save.addEventListener("click", () => finish(() => undefined));
    gh.addEventListener("click", () => finish(() => open(FEEDBACK_GITHUB_NEW_ISSUE)));
    mail.addEventListener("click", () => finish(() => open(FEEDBACK_MAILTO)));
    dismiss.addEventListener("click", () => {
      void dismissFeedback().then(clear);
    });
  };

  return {
    maybeShow: (state) => {
      if (dead || card) return;
      void pageCount().then((n) => {
        if (dead || card || !shouldShowFeedback({ state, pageCount: n })) return;
        void markFeedbackShown().then(() => {
          if (!dead) render();
        });
      });
    },
    destroy: () => {
      dead = true;
      clear();
    },
  };
}
