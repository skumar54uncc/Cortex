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

## Follow-up

Re-run when changing hit templates or adding new HTML sinks:

`rg "innerHTML|outerHTML|document\\.write|\\beval\\(" src/`
