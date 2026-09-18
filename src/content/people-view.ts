/**
 * People tab in the overlay (Phase 5.1). DOM APIs only: names and headlines
 * come from LinkedIn pages and are rendered with textContent.
 */
export interface PersonRow {
  id: number;
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  lastSeen: number;
  visitCount: number;
}

export interface PeopleViewDeps {
  list: (q: string) => Promise<PersonRow[]>;
  remove: (id: number) => Promise<boolean>;
  announce: (text: string) => void;
}

function httpUrl(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
}

export async function renderPeopleView(container: HTMLElement, deps: PeopleViewDeps): Promise<void> {
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "cortex-people";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "cortex-input cortex-people-filter";
  input.placeholder = "Filter by name, headline or company";
  input.setAttribute("aria-label", "Filter people");
  input.autocomplete = "off";

  const list = document.createElement("ul");
  list.className = "cortex-people-list";
  list.setAttribute("aria-label", "People you viewed");

  wrap.append(input, list);
  container.appendChild(wrap);

  const draw = (rows: PersonRow[]): void => {
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "cortex-people-empty cortex-muted";
      empty.textContent = input.value.trim()
        ? "Nobody matches that filter."
        : "People and companies appear here after you open their LinkedIn pages.";
      list.appendChild(empty);
      return;
    }
    for (const p of rows) {
      const li = document.createElement("li");
      li.className = "cortex-person";

      const main = document.createElement("div");
      main.className = "cortex-person-main";
      const href = httpUrl(p.profileUrl);
      const name = document.createElement(href ? "a" : "span") as HTMLAnchorElement | HTMLSpanElement;
      name.className = "cortex-person-name";
      name.textContent = p.name;
      if (href && name instanceof HTMLAnchorElement) {
        name.href = href;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
      }
      const headline = document.createElement("span");
      headline.className = "cortex-person-headline";
      headline.textContent = p.headline;
      const meta = document.createElement("span");
      meta.className = "cortex-person-meta cortex-muted";
      const when = new Date(p.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      meta.textContent = [
        p.kind === "company" ? "Company" : p.company,
        `last viewed ${when}`,
        p.visitCount > 1 ? `${p.visitCount} visits` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      main.append(name, headline, meta);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "cortex-person-delete";
      del.setAttribute("aria-label", `Delete ${p.name}`);
      del.title = "Delete";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        void deps.remove(p.id).then((ok) => {
          if (!ok) return;
          li.remove();
          deps.announce(`Deleted ${p.name}.`);
          if (!list.querySelector(".cortex-person")) draw([]);
        });
      });

      li.append(main, del);
      list.appendChild(li);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void deps.list(input.value.trim()).then(draw);
    }, 120);
  });

  draw(await deps.list(""));
}
