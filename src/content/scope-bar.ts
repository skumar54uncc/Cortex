/**
 * Collection scope bar for Search and Ask (Phase 5.4): pick "All pages" or a
 * collection, and add the current page to the chosen collection. Hidden when
 * the user has no collections. DOM APIs only; names are rendered as text.
 */
export interface ScopeCollection {
  id: number;
  name: string;
  count: number;
}

export interface ScopeBarDeps {
  list: () => Promise<ScopeCollection[]>;
  addPage: (collectionId: number) => Promise<{ ok?: boolean; error?: string }>;
  onChange: (collectionId: number | null) => void;
  /** False in the side panel (there is no page to add). */
  showAddPage: boolean;
  announce: (text: string) => void;
  initial?: number | null;
}

export interface ScopeBar {
  root: HTMLElement;
  refresh: () => Promise<void>;
  value: () => number | null;
}

let seq = 0;

export function createScopeBar(deps: ScopeBarDeps): ScopeBar {
  const id = `cortex-scope-${++seq}`;
  const root = document.createElement("div");
  root.className = "cortex-scope";
  root.hidden = true;

  const label = document.createElement("label");
  label.className = "cortex-scope-label";
  label.htmlFor = id;
  label.textContent = "In";

  const select = document.createElement("select");
  select.id = id;
  select.className = "cortex-scope-select";
  select.setAttribute("aria-label", "Search in");

  root.append(label, select);

  let addBtn: HTMLButtonElement | null = null;
  if (deps.showAddPage) {
    addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "cortex-scope-add";
    addBtn.textContent = "Add this page";
    addBtn.disabled = true;
    root.appendChild(addBtn);
  }

  let current: number | null = deps.initial ?? null;
  let names = new Map<number, string>();

  const syncButton = (): void => {
    if (addBtn) addBtn.disabled = current == null;
  };

  select.addEventListener("change", () => {
    const v = select.value;
    current = v ? Number(v) : null;
    syncButton();
    deps.onChange(current);
  });

  addBtn?.addEventListener("click", () => {
    if (current == null) return;
    const cid = current;
    void deps.addPage(cid).then((res) => {
      const name = names.get(cid) ?? "the collection";
      deps.announce(res?.ok ? `Added this page to ${name}.` : "Could not add this page.");
      if (res?.ok) void refresh();
    });
  });

  async function refresh(): Promise<void> {
    const cols = await deps.list();
    names = new Map(cols.map((c) => [c.id, c.name]));
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All pages";
    select.appendChild(all);
    for (const c of cols) {
      const o = document.createElement("option");
      o.value = String(c.id);
      o.textContent = `${c.name} (${c.count})`;
      select.appendChild(o);
    }
    if (current != null && !names.has(current)) {
      current = null;
      deps.onChange(null);
    }
    select.value = current == null ? "" : String(current);
    root.hidden = cols.length === 0;
    syncButton();
  }

  return { root, refresh, value: () => current };
}
