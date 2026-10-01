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
  /**
   * A plain sentence or two saying what Cortex read from the profile. Left
   * off for rows captured before summaries existed.
   */
  summary?: string;
  /** Detail captured from the profile, when the page showed it. */
  location?: string;
  roleTitle?: string;
  pastRoles?: { title: string; company: string }[];
  education?: string[];
  connectionDegree?: string;
  connectionCount?: number;
  industry?: string;
  companySize?: string;
  /** LinkedIn CDN photo, when a later visit captured one. */
  photoUrl?: string;
}

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** LinkedIn page chrome that gets scraped into a headline or summary. */
function isLinkedInChromeDump(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(?:contact info|enhance profile|add section)\b/.test(t)) return true;
  return /\b(?:1st|2nd|3rd)\b/.test(t) && /\b(?:followers?|connections?|contact)\b/.test(t);
}

/**
 * Drops the person's name, degree chips, and LinkedIn buttons from a scraped
 * string, leaving the role and place separated by middle dots.
 */
function scrubProfileNoise(text: string, name: string): string {
  let t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const person = String(name ?? "").replace(/\s+/g, " ").trim();
  if (person.length >= 2) {
    t = t.replace(new RegExp(`\\b${escapeRe(person).replace(/\\\./g, "\\.?")}`, "gi"), " ");
    for (const part of person.split(/\s+/)) {
      const word = part.replace(/[^A-Za-z]/g, "");
      if (word.length >= 3) t = t.replace(new RegExp(`\\b${escapeRe(word)}\\b`, "gi"), " ");
    }
  }
  t = t
    .replace(/\b(?:1st|2nd|3rd)\b/gi, " ")
    .replace(/\b(?:contact info|enhance profile|add section|open to|more pending message|pending message)\b/gi, " ")
    .replace(/\b\d{1,3}(?:,\d{3})+\s+followers?\b/gi, " ")
    .replace(/\b\d+\+\s+connections?\b/gi, " ")
    .replace(/\bfollowers?\b/gi, " ")
    .replace(/\bconnections?\b/gi, " ")
    .replace(/\s*[|]\s*/g, " · ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
  return t;
}

/** First useful clause of a scraped profile, as a single role line. */
function titleFromNoise(text: string, name: string): string {
  const scrubbed = scrubProfileNoise(text, name);
  if (!scrubbed) return "";
  const first = scrubbed.split(/\s*·\s*|\.\s+/)[0]?.trim() ?? "";
  const normalized = first.replace(/\s+@\s+/g, " at ").replace(/[.\s]+$/, "").trim();
  if (normalized.length < 2) return "";
  if (normalized.length > 88) return `${normalized.slice(0, 85).trimEnd()}...`;
  return normalized;
}

const PLACE_WORD = /^(?:Area|Metro|Metroplex|Region)$/i;

/** "Dallas-Fort Worth Metroplex" from the tail of a scraped line. */
function placeTail(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(/\s+/);
  const idx = words.findIndex((w) => PLACE_WORD.test(w.replace(/[.,]+$/, "")));
  if (idx <= 0) return "";
  const kept: string[] = [];
  for (let i = idx - 1; i >= 0 && kept.length < 4; i--) {
    const w = words[i]!;
    if (/^(?:at|@|and|of|the|in)$/i.test(w)) break;
    if (!/^[A-Z0-9]/.test(w)) break;
    kept.unshift(w);
  }
  if (!kept.length) return "";
  return `${kept.join(" ")} ${words[idx]!.replace(/[.,]+$/, "")}`;
}

/**
 * The summary to show under the name, or "" when there is none, when it only
 * repeats the headline, or when it is LinkedIn page chrome.
 */
export function personSummaryLine(p: PersonRow): string {
  const summary = String(p.summary ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return "";
  if (isLinkedInChromeDump(summary)) return "";
  // Punctuation aside, LinkedIn's headline and the first line of the profile
  // text are the same sentence, and the card already shows the headline.
  return norm(summary) === norm(p.headline) ? "" : summary;
}

/**
 * The one line under the name: a role, not the whole LinkedIn headline.
 * Headlines often arrive as "CEO · 2nd · Miami · Contact info ...".
 */
export function personCardTitle(p: PersonRow): string {
  const name = String(p.name ?? "").trim();
  const role = String(p.roleTitle ?? "").trim();
  const company = String(p.company ?? "").trim();
  if (role) {
    if (company && !role.toLowerCase().includes(company.toLowerCase())) {
      return `${role} at ${company}`;
    }
    return role;
  }
  const head = String(p.headline ?? "").replace(/\s+/g, " ").trim();
  if (head && !isLinkedInChromeDump(head)) {
    let lead = head;
    if (name && lead.toLowerCase().startsWith(name.toLowerCase())) {
      lead = lead.slice(name.length).replace(/^[\s|·,:.-]+/, "").trim();
    }
    const first = lead.split(/\s*[|·]\s*/)[0]?.trim() ?? "";
    if (first) {
      if (first.length > 88) return `${first.slice(0, 85).trimEnd()}...`;
      return first;
    }
  }
  return titleFromNoise(`${head} ${p.summary ?? ""}`, name);
}

/**
 * A place to show under the title. Uses the captured location, or the place
 * tail of a scraped headline ("Miami-Fort Lauderdale Area").
 */
export function personCardPlace(p: PersonRow): string {
  const explicit = String(p.location ?? "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit.length > 48 ? `${explicit.slice(0, 45).trimEnd()}...` : explicit;
  const title = personCardTitle(p).toLowerCase();
  const blob = scrubProfileNoise(`${p.headline ?? ""} · ${p.summary ?? ""}`, p.name);
  const parts = blob.split(/\s*·\s*|\.\s+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (title && part.toLowerCase() === title) continue;
    let rest = part;
    if (title && rest.toLowerCase().startsWith(title)) {
      rest = rest.slice(title.length).replace(/^[\s,·|@-]+/, "").trim();
    }
    const found = placeTail(rest) || placeTail(part);
    if (found && (!title || !title.includes(found.toLowerCase()))) return found;
  }
  return "";
}

/**
 * The full headline for the card. Pipe-separated LinkedIn headlines stay
 * whole. Page chrome (degree chips, Contact info, buttons) is removed, and
 * a clause that only repeats an earlier one is kept once, at its longest.
 */
export function personHeadlineLine(p: PersonRow): string {
  const headline = String(p.headline ?? "").replace(/\s+/g, " ").trim();
  const summary = String(p.summary ?? "").replace(/\s+/g, " ").trim();
  const headlineOk = !!headline && !isLinkedInChromeDump(headline);
  const summaryOk = !!summary && !isLinkedInChromeDump(summary);
  let source = "";
  if (headlineOk && summaryOk && norm(summary).includes(norm(headline)) && summary.length > headline.length + 8) {
    source = summary;
  } else if (headlineOk) source = headline;
  else if (summaryOk) source = summary;
  else source = `${headline} ${summary}`.trim();
  const tidy = scrubProfileNoise(source, p.name);
  const parts = tidy.split(/\s*·\s*|\.\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const key = norm(part);
    if (!key) continue;
    const idx = kept.findIndex((prev) => {
      const pk = norm(prev);
      return pk === key || pk.includes(key) || key.includes(pk);
    });
    if (idx >= 0) {
      if (part.length > kept[idx]!.length) kept[idx] = part;
      continue;
    }
    kept.push(part);
  }
  return kept.join(" · ");
}

/**
 * Larger LinkedIn renditions of the same photo, then the URL we stored.
 * The card tries them in order and keeps the first one that loads.
 */
export function personPhotoCandidates(raw: string | undefined): string[] {
  const accepted = acceptedPhotoUrl(raw);
  if (!accepted) return [];
  const sized = [800, 400, 200].map((n) =>
    accepted.replace(/(?:shrink|scale)_\d+_\d+/gi, `shrink_${n}_${n}`)
  );
  const out: string[] = [];
  for (const href of [...sized, accepted]) {
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

/** https photo on LinkedIn's image host, or null. The sharpest rendition to try first. */
export function personPhotoUrl(raw: string | undefined): string | null {
  return personPhotoCandidates(raw)[0] ?? null;
}

/** The stored photo URL, unchanged, when it is safe to request. */
function acceptedPhotoUrl(raw: string | undefined): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host !== "media.licdn.com" && host !== "static.licdn.com" && host !== "avatars.githubusercontent.com") return null;
    if (/ghost-person|ghost-company/i.test(u.pathname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Two letters for the card mark. One letter when the name is a single word. */
export function personInitials(name: string): string {
  const words = String(name ?? "")
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length > 0);
  if (!words.length) return "";
  const first = words[0]![0]!.toUpperCase();
  const last = words.length > 1 ? words[words.length - 1]![0]!.toUpperCase() : "";
  return last && last !== first ? first + last : first;
}

/** One plain line of captured detail, or "" when the profile had none. */
export function personDetailLine(p: PersonRow): string {
  const parts: string[] = [];
  if (p.location) parts.push(p.location);
  if (p.roleTitle) parts.push(p.company ? `${p.roleTitle} at ${p.company}` : p.roleTitle);
  const past = p.pastRoles?.[0];
  if (past) parts.push(`previously ${[past.title, past.company].filter(Boolean).join(" at ")}`);
  if (p.education?.[0]) parts.push(p.education[0]);
  if (p.industry) parts.push(p.industry);
  if (p.companySize) parts.push(p.companySize);
  const connection = [p.connectionDegree, p.connectionCount ? `${p.connectionCount} connections` : ""]
    .filter(Boolean)
    .join(", ");
  if (connection) parts.push(connection);
  return parts.join(" · ");
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

/** A light unsharp mask. It runs in the card, so a small photo stays crisp. */
function sharpenFilter(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "cortex-sharpen");
  svg.setAttribute("aria-hidden", "true");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "cortex-photo-sharpen");
  const conv = document.createElementNS("http://www.w3.org/2000/svg", "feConvolveMatrix");
  conv.setAttribute("order", "3");
  conv.setAttribute("preserveAlpha", "true");
  conv.setAttribute("kernelMatrix", "0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0");
  filter.appendChild(conv);
  svg.appendChild(filter);
  return svg;
}

export async function renderPeopleView(container: HTMLElement, deps: PeopleViewDeps): Promise<void> {
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "cortex-people";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "cortex-input cortex-people-filter";
  input.placeholder = "Filter by name, role, company, place or what they do";
  input.setAttribute("aria-label", "Filter people");
  input.autocomplete = "off";

  const list = document.createElement("ul");
  list.className = "cortex-people-list";
  list.setAttribute("aria-label", "People you viewed");

  wrap.append(sharpenFilter(), input, list);
  container.appendChild(wrap);

  const draw = (rows: PersonRow[]): void => {
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "cortex-people-empty cortex-muted";
      empty.textContent = input.value.trim()
        ? "Nobody matches that filter."
        : "People appear here after you open a profile on LinkedIn.";
      list.appendChild(empty);
      return;
    }
    for (const p of rows) {
      const li = document.createElement("li");
      li.className = input.value.trim() ? "cortex-person is-match" : "cortex-person";
      const displayName = p.name.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
      const href = httpUrl(p.profileUrl);

      const scene = document.createElement("div");
      scene.className = "cortex-person-scene";
      const flip = document.createElement("div");
      flip.className = "cortex-person-flip";

      const front = document.createElement("div");
      front.className = "cortex-person-face cortex-person-front";
      const turn = document.createElement("button");
      turn.type = "button";
      turn.className = "cortex-person-turn";
      turn.setAttribute("aria-expanded", "false");
      turn.setAttribute("aria-label", `Show details for ${displayName}`);

      const mark = document.createElement("span");
      mark.className = "cortex-person-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = personInitials(displayName);
      const photos = personPhotoCandidates(p.photoUrl);
      if (photos.length) {
        const img = document.createElement("img");
        img.className = "cortex-person-photo";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        let photoTry = 0;
        img.src = photos[0]!;
        img.addEventListener("error", () => {
          photoTry += 1;
          const next = photos[photoTry];
          if (next) {
            img.src = next;
            return;
          }
          img.remove();
          front.classList.remove("has-photo");
        });
        front.classList.add("has-photo");
        front.appendChild(img);
      }
      front.appendChild(mark);

      const name = document.createElement(href ? "a" : "span") as HTMLAnchorElement | HTMLSpanElement;
      name.className = "cortex-person-name";
      name.textContent = displayName;
      if (href && name instanceof HTMLAnchorElement) {
        name.href = href;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        name.addEventListener("click", (e) => e.stopPropagation());
      }
      front.append(turn, name);

      const back = document.createElement("div");
      back.className = "cortex-person-face cortex-person-back";
      back.setAttribute("aria-hidden", "true");
      const headline = document.createElement("button");
      headline.type = "button";
      headline.className = "cortex-person-headline";
      headline.tabIndex = -1;
      headline.setAttribute("aria-label", `Show photo for ${displayName}`);
      headline.textContent = personHeadlineLine(p) || "No headline saved for this profile.";
      const meta = document.createElement("div");
      meta.className = "cortex-person-meta";
      const when = new Date(p.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const viewed = document.createElement("span");
      viewed.className = "cortex-person-viewed";
      viewed.textContent = p.kind === "company" ? `Company · Last viewed ${when}` : `Last viewed ${when}`;
      const visits = document.createElement("span");
      visits.className = "cortex-person-visits";
      visits.textContent = p.visitCount === 1 ? "1 visit" : `${p.visitCount} visits`;
      meta.append(viewed, visits);

      const backActions = document.createElement("div");
      backActions.className = "cortex-person-back-actions";
      let profile: HTMLAnchorElement | null = null;
      if (href) {
        profile = document.createElement("a");
        profile.className = "cortex-person-profile";
        profile.href = href;
        profile.target = "_blank";
        profile.rel = "noopener noreferrer";
        profile.tabIndex = -1;
        profile.textContent = "Profile";
        profile.addEventListener("click", (e) => e.stopPropagation());
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cortex-person-delete";
      del.tabIndex = -1;
      del.setAttribute("aria-label", `Delete ${p.name}`);
      del.title = "Delete";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void deps.remove(p.id).then((ok) => {
          if (!ok) return;
          li.remove();
          deps.announce(`Deleted ${displayName}.`);
          if (!list.querySelector(".cortex-person")) draw([]);
        });
      });
      if (profile) backActions.appendChild(profile);
      backActions.appendChild(del);
      back.append(headline, meta, backActions);

      const setFlipped = (on: boolean): void => {
        li.classList.toggle("is-flipped", on);
        turn.setAttribute("aria-expanded", on ? "true" : "false");
        front.setAttribute("aria-hidden", on ? "true" : "false");
        back.setAttribute("aria-hidden", on ? "false" : "true");
        turn.tabIndex = on ? -1 : 0;
        headline.tabIndex = on ? 0 : -1;
        if (profile) profile.tabIndex = on ? 0 : -1;
        del.tabIndex = on ? 0 : -1;
        if (name instanceof HTMLAnchorElement) name.tabIndex = on ? -1 : 0;
      };
      scene.addEventListener("click", (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("a, .cortex-person-delete")) return;
        const on = !li.classList.contains("is-flipped");
        setFlipped(on);
        if (on) {
          deps.announce(`Details for ${displayName}.`);
          headline.focus();
        } else {
          turn.focus();
        }
      });

      flip.append(front, back);
      scene.appendChild(flip);
      li.appendChild(scene);
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
