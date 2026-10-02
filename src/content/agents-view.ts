/**
 * Connect AI Agents tab: how-to + one shared copyable prompt.
 */
import {
  AGENT_PROMPT_TEMPLATES,
  AGENTS_INTRO_BODY,
  AGENTS_INTRO_TITLE,
  AGENTS_SHEET_RULES,
  AGENTS_STEPS,
  SHARED_AGENT_PROMPT,
  type AgentPromptId,
} from "../shared/agent-prompts";

export interface AgentsViewDeps {
  openAssistSyncSettings: () => void;
  announce?: (msg: string) => void;
}

const AGENTS_CSS = `.cortex-agents-host{flex:1;min-height:0;display:flex;flex-direction:column}.cortex-agents{flex:1;min-height:0;display:flex;flex-direction:column}.cortex-agents-scroll{flex:1;min-height:0;overflow-y:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}.cortex-agents-section{display:flex;flex-direction:column;gap:8px}.cortex-agents-title{margin:0;font-size:18px;font-weight:700;line-height:1.3;color:var(--cx-text)}.cortex-agents-h{margin:0;font-size:15px;font-weight:600;color:var(--cx-text)}.cortex-agents-lead{margin:0;font-size:15px;line-height:1.55;color:var(--cx-text);max-width:62ch}.cortex-agents-actions,.cortex-agents-pills{display:flex;flex-wrap:wrap;gap:8px}.cortex-agents-primary,.cortex-agents-copy,.cortex-agents-pill{font:inherit;font-size:13px;font-weight:600;border-radius:var(--cx-radius-sm);cursor:pointer;min-height:34px;padding:0 12px}.cortex-agents-primary{background:var(--cx-accent);color:#fffef9;border:0}.cortex-agents-copy,.cortex-agents-pill{background:var(--cx-bg);color:var(--cx-text);border:1px solid var(--cx-border)}.cortex-agents-pill.is-active{border-color:var(--cx-accent);background:var(--cx-accent-soft)}.cortex-agents-primary:focus-visible,.cortex-agents-copy:focus-visible,.cortex-agents-pill:focus-visible{outline:2px solid var(--cx-accent);outline-offset:2px}.cortex-agents-steps,.cortex-agents-rules{margin:0;padding-left:1.2rem;font-size:15px;line-height:1.55;max-width:62ch}.cortex-agents-steps li,.cortex-agents-rules li{margin:0 0 5px}.cortex-agents-prompt{margin:0;padding:10px 12px;border-radius:var(--cx-radius-sm);background:var(--cx-bg);border:1px solid var(--cx-border);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;user-select:text;-webkit-user-select:text}.cortex-agents-copy-status{margin:0;font-size:12px}`;

function ensureAgentsStyles(container: HTMLElement): void {
  const root = container.getRootNode();
  const scope: ParentNode = root instanceof ShadowRoot ? root : document.documentElement;
  if (scope.querySelector("style[data-cortex-agents-css]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-cortex-agents-css", "");
  style.textContent = AGENTS_CSS;
  scope.appendChild(style);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function renderAgentsView(container: HTMLElement, deps: AgentsViewDeps): void {
  ensureAgentsStyles(container);
  container.replaceChildren();

  const root = el("div", "cortex-agents");
  const scroll = el("div", "cortex-agents-scroll");

  const intro = el("section", "cortex-agents-section");
  intro.appendChild(el("h2", "cortex-agents-title", AGENTS_INTRO_TITLE));
  intro.appendChild(el("p", "cortex-agents-lead", AGENTS_INTRO_BODY));
  const enableBtn = el("button", "cortex-agents-primary") as HTMLButtonElement;
  enableBtn.type = "button";
  enableBtn.textContent = "Open Assist Sync settings";
  enableBtn.setAttribute("data-cortex-open-assist-sync", "1");
  enableBtn.addEventListener("click", () => deps.openAssistSyncSettings());
  const actions = el("div", "cortex-agents-actions");
  actions.appendChild(enableBtn);
  intro.appendChild(actions);
  scroll.appendChild(intro);

  const stepsSec = el("section", "cortex-agents-section");
  stepsSec.appendChild(el("h3", "cortex-agents-h", "Steps"));
  const ol = el("ol", "cortex-agents-steps");
  for (const step of AGENTS_STEPS) ol.appendChild(el("li", undefined, step));
  stepsSec.appendChild(ol);
  scroll.appendChild(stepsSec);

  const rulesSec = el("section", "cortex-agents-section");
  rulesSec.appendChild(el("h3", "cortex-agents-h", "How agents should query"));
  const ul = el("ul", "cortex-agents-rules");
  for (const rule of AGENTS_SHEET_RULES) ul.appendChild(el("li", undefined, rule));
  rulesSec.appendChild(ul);
  scroll.appendChild(rulesSec);

  const promptSec = el("section", "cortex-agents-section");
  promptSec.appendChild(el("h3", "cortex-agents-h", "Prompt template"));
  const howto = el("p", "cortex-agents-lead cortex-muted");
  const pills = el("div", "cortex-agents-pills");
  pills.setAttribute("role", "group");
  pills.setAttribute("aria-label", "Assistant");
  let active: AgentPromptId = "claude";
  const pre = el("pre", "cortex-agents-prompt");
  pre.setAttribute("tabindex", "0");

  const apply = (id: AgentPromptId): void => {
    active = id;
    const t = AGENT_PROMPT_TEMPLATES.find((x) => x.id === id)!;
    howto.textContent = t.howto;
    pre.textContent = t.prompt;
    for (const btn of pills.querySelectorAll("button")) {
      btn.classList.toggle("is-active", btn.getAttribute("data-agent") === id);
    }
  };

  for (const t of AGENT_PROMPT_TEMPLATES) {
    const btn = el("button", "cortex-agents-pill") as HTMLButtonElement;
    btn.type = "button";
    btn.textContent = t.label;
    btn.setAttribute("data-agent", t.id);
    btn.addEventListener("click", () => apply(t.id));
    pills.appendChild(btn);
  }

  const copyRow = el("div", "cortex-agents-actions");
  const copyBtn = el("button", "cortex-agents-copy") as HTMLButtonElement;
  copyBtn.type = "button";
  copyBtn.className = "cortex-agents-copy";
  copyBtn.textContent = "Copy prompt";
  const status = el("p", "cortex-agents-copy-status cortex-muted");
  status.setAttribute("role", "status");
  status.hidden = true;
  copyBtn.addEventListener("click", () => {
    const text = pre.textContent || SHARED_AGENT_PROMPT;
    void copyText(text).then((ok) => {
      status.hidden = false;
      status.textContent = ok ? "Copied to clipboard." : "Could not copy. Select the text manually.";
      deps.announce?.(ok ? "Prompt copied." : "Copy failed.");
      window.setTimeout(() => {
        status.hidden = true;
      }, 2000);
    });
  });
  copyRow.append(copyBtn, status);

  promptSec.append(howto, pills, pre, copyRow);
  scroll.appendChild(promptSec);
  root.appendChild(scroll);
  container.appendChild(root);
  apply(active);
}
