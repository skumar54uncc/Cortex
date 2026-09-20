/**
 * Typing repair for the in-page panel.
 *
 * Sites bind their own keys to the document: YouTube plays or pauses on
 * Space, others jump on "/" or a single letter. Many call preventDefault,
 * which cancels the character before it is typed, so Space never reached the
 * Cortex question box.
 *
 * A content script cannot stop that. It runs in an isolated world, where
 * stopPropagation only affects listeners of its own world, so the page's
 * handlers always run (verified in a real browser: e2e/keys.spec.ts). What
 * the panel can do is put the character back.
 *
 * The listener sits on window in the bubble phase, the last step of the
 * dispatch, so every page handler (capture and bubble) has already had its
 * say. If a typing key that started inside the panel was cancelled, the
 * character is inserted into the field and an `input` event is dispatched, so
 * the panel reacts exactly as if it had been typed.
 */
const TYPING_KEY = /^.$/u;

function isTypingKey(ev: KeyboardEvent): boolean {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  return ev.key === " " || ev.key === "Spacebar" || TYPING_KEY.test(ev.key);
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editableTarget(node: EventTarget | undefined): Editable | null {
  const el = node as Editable | null;
  if (!el || typeof el.setRangeText !== "function") return null;
  const tag = (el as unknown as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" ? el : null;
}

/** Types the character the page refused to let through. */
function insertCharacter(el: Editable, ev: KeyboardEvent): void {
  const char = ev.key === "Spacebar" ? " " : ev.key;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.setRangeText(char, start, end, "end");
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
}

export function installKeyShield(host: Element): () => void {
  const repair = (ev: Event): void => {
    const key = ev as KeyboardEvent;
    if (!key.defaultPrevented || !isTypingKey(key)) return;
    // With a closed shadow root the event is retargeted to the host.
    const path = ev.composedPath();
    if (!(ev.target === host || path.includes(host))) return;
    const el = editableTarget(path[0]);
    if (el) insertCharacter(el, key);
  };

  window.addEventListener("keydown", repair);
  return () => window.removeEventListener("keydown", repair);
}
