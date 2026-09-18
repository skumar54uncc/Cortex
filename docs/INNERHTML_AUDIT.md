# InnerHTML / XSS audit (Cortex)

Automated grep targets: `innerHTML`, `outerHTML`, `document.write`, `eval(`.

## Rules

- Do not assign `innerHTML` from strings that contain **page-derived** or **LLM-derived** text without escaping.
- Prefer `textContent`, `createElement`, and small helpers (`esc()` in the overlay).
- `eval` and `new Function` are disallowed in extension code.

## src/content/overlay.ts

| Location | Verdict |
|----------|---------|
| `esc()` uses a detached div’s `innerHTML` after `textContent` | **Safe** — classic escape pattern. |
| `shell.innerHTML = \`...\`` | **Safe** — static template, no user interpolation. |
| `tabBar.innerHTML = ""` / clearing roots | **Safe** — reset only. |
| `results.innerHTML` with `${evidenceBlock}`, `${rows}`, `${tips}` | **Requires care** — must use `esc()` for titles, URLs-as-text, snippets from index (verified at implementation time). |
| `messagesContainer.innerHTML = ""` | **Safe**. |

## src/options/options.ts

| Location | Verdict |
|----------|---------|
| Clearing rows via `innerHTML = ""` | **Safe**. |

## Release 1.2.0 additions

| File | Sinks | Verdict |
|------|-------|---------|
| `src/content/chat-drawer.ts`, `forget-menu.ts`, `stream-renderer.ts`, `focus-trap.ts` | none (DOM APIs, `textContent`, `createElementNS`) | **Safe** |
| `src/content/overlay.ts` empty state chips, undo toast, forget status | `textContent` only; the empty-state block no longer uses `innerHTML` | **Safe** |
| `src/content/overlay.ts` chat history delete icon | `delBtn.innerHTML` with a static SVG string (unchanged from 1.0.x) | **Safe**: no interpolation |
| `src/options/managed-ui.ts` | `textContent`; managed domains come from admin policy and are rendered with `textContent` | **Safe** |
| `src/options/options.ts` forget feedback | `textContent` | **Safe** |

## Follow-up

Re-run when changing hit templates or adding new HTML sinks:

`rg "innerHTML|outerHTML|document\\.write|\\beval\\(" src/`
