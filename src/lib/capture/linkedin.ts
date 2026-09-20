/**
 * LinkedIn profile and company parsing (Phase 5.1, detail added in 1.2.x).
 * Runs inside extract.js on linkedin.com pages that passed the privacy gate.
 * Everything read here is page-controlled text: it is read with textContent
 * only (never innerHTML), trimmed, length-capped, and later rendered with
 * textContent only.
 */

/** One experience row: what the person did and where. */
export interface LinkedInRole {
  title: string;
  company: string;
}

export interface LinkedInEntity {
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  /**
   * Optional detail (release 1.2.x). Each field is left off when the page did
   * not show it, so rows captured by 1.2.0 still read.
   */
  location?: string;
  about?: string;
  /** Current role title, from the first experience row. */
  roleTitle?: string;
  pastRoles?: LinkedInRole[];
  education?: string[];
  /** "1st", "2nd" or "3rd" as LinkedIn labels the distance. */
  connectionDegree?: string;
  connectionCount?: number;
  /** Company pages only. */
  industry?: string;
  companySize?: string;
  tagline?: string;
}

const MAX_NAME = 120;
const MAX_HEADLINE = 220;
const MAX_COMPANY = 120;
const MAX_LOCATION = 120;
const MAX_ABOUT = 600;
const MAX_ROLE = 140;
const MAX_EDUCATION = 160;
const MAX_INDUSTRY = 120;
const MAX_SIZE = 80;
const MAX_PAST_ROLES = 5;
const MAX_EDUCATION_ITEMS = 3;
/** Guards against a page claiming an absurd network size. */
const MAX_CONNECTIONS = 1_000_000;

function clean(s: string | null | undefined, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isLinkedInHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "linkedin.com" || h.endsWith(".linkedin.com");
}

/** https://www.linkedin.com/in/<slug>/ or /company/<slug>/, else null. */
export function canonicalLinkedInUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isLinkedInHost(u.hostname)) return null;
  const m = u.pathname.match(/^\/(in|company)\/([^/?#]+)/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[2]!).toLowerCase();
  if (!/^[\p{L}\p{N}._%-]{1,100}$/u.test(slug)) return null;
  return `https://www.linkedin.com/${m[1]!.toLowerCase()}/${encodeURIComponent(slug).toLowerCase()}/`;
}

function titleParts(doc: Document): { name: string; rest: string } {
  const raw = (doc.title || "")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();
  const idx = raw.indexOf(" - ");
  if (idx === -1) {
    const colon = raw.indexOf(":");
    return { name: colon > 0 ? raw.slice(0, colon).trim() : raw, rest: "" };
  }
  return { name: raw.slice(0, idx).trim(), rest: raw.slice(idx + 3).trim() };
}

function companyFromHeadline(headline: string): string {
  const m = headline.match(/\bat\s+([^·|,]+?)\s*(?:[·|,]|$)/i);
  return m ? m[1]!.trim() : "";
}

/**
 * The card a profile section sits in. LinkedIn marks each section with an
 * empty anchor div (`<div id="experience">`) inside the card; older markup
 * puts the id on the section itself.
 */
function sectionFor(main: Element, id: string): Element | null {
  const anchor = main.querySelector(`#${id}`);
  if (!anchor) return null;
  return anchor.closest("section") ?? anchor.parentElement ?? anchor;
}

/** List rows of a section, skipping rows that only wrap other rows. */
function leafItems(section: Element): Element[] {
  return Array.from(section.querySelectorAll("li")).filter((li) => !li.querySelector("li"));
}

/**
 * The visible lines of one experience or education row. LinkedIn renders each
 * line twice: once for sighted readers (aria-hidden) and once for screen
 * readers, so the aria-hidden copies alone give each line once.
 */
function entryLines(item: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined): void => {
    const v = clean(s, MAX_ROLE);
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  const hidden = item.querySelectorAll('span[aria-hidden="true"]');
  if (hidden.length) {
    hidden.forEach((el) => push(el.textContent));
    return out;
  }
  // Older or trimmed markup: one line per leaf element.
  const leaves = Array.from(item.querySelectorAll("div, span, p")).filter(
    (el) => !el.querySelector("div, span, p")
  );
  for (const el of leaves.length ? leaves : [item]) push(el.textContent);
  return out;
}

/** "Jan 2023 to Present", "2012 to 2014", "5 mos": not a title or a school. */
function isDateLine(line: string): boolean {
  return (
    /^(?:[A-Za-z]{3,9}\s+)?\d{4}\b/.test(line) ||
    /\bpresent\b/i.test(line) ||
    /^\d+\s+(?:yrs?|mos?)\b/i.test(line)
  );
}

/** The company half of "Tidora · Full-time". */
function companyOfLine(line: string): string {
  return clean(line.split("·")[0], MAX_COMPANY);
}

function rolesFrom(main: Element): LinkedInRole[] {
  const section = sectionFor(main, "experience");
  if (!section) return [];
  const roles: LinkedInRole[] = [];
  for (const item of leafItems(section)) {
    const lines = entryLines(item).filter((l) => !isDateLine(l));
    const title = lines[0] ?? "";
    if (!title) continue;
    roles.push({ title, company: companyOfLine(lines[1] ?? "") });
  }
  return roles;
}

function educationFrom(main: Element): string[] {
  const section = sectionFor(main, "education");
  if (!section) return [];
  const out: string[] = [];
  for (const item of leafItems(section)) {
    const lines = entryLines(item).filter((l) => !isDateLine(l));
    const school = lines[0] ?? "";
    if (!school) continue;
    const degree = lines[1] ?? "";
    out.push(clean(degree ? `${school}, ${degree}` : school, MAX_EDUCATION));
    if (out.length >= MAX_EDUCATION_ITEMS) break;
  }
  return out;
}

function aboutFrom(main: Element): string {
  const section = sectionFor(main, "about");
  const scope =
    section ?? main.querySelector('[class*="org-about-us-organization-description"]');
  if (!scope) return "";
  for (const sel of ['span[aria-hidden="true"]', "p", ".inline-show-more-text"]) {
    const el = scope.querySelector(sel);
    const t = clean(el?.textContent, MAX_ABOUT);
    if (t) return t;
  }
  // Whole card as a last resort: drop the "About" heading it starts with.
  return clean(scope.textContent, MAX_ABOUT + 20).replace(/^about(?:\s+us)?\s+/i, "").slice(0, MAX_ABOUT);
}

/** The top card, where the location and the network line live. */
function topCardOf(main: Element): Element {
  for (const sel of [".pv-top-card", ".org-top-card", ".pv-text-details__left-panel"]) {
    const el = main.querySelector(sel);
    if (el) return el;
  }
  return main;
}

function locationFrom(card: Element): string {
  const cands = card.querySelectorAll(
    ".pv-text-details__left-panel .text-body-small, .text-body-small, .org-top-card-summary-info-list__info-item"
  );
  for (const el of Array.from(cands)) {
    const t = clean(el.textContent, MAX_LOCATION);
    if (!t) continue;
    if (/\b(connections?|followers?|contact info|mutual|employees)\b/i.test(t)) continue;
    if (/^\d/.test(t)) continue;
    return t;
  }
  return "";
}

function connectionsFrom(card: Element): { degree: string; count?: number } {
  const badge = clean(card.querySelector(".dist-value, .distance-badge")?.textContent, 60);
  const dm = badge.match(/\b(1st|2nd|3rd)\b/i);
  const degree = dm ? dm[1]!.toLowerCase() : "";

  const text = clean(card.textContent, 4000);
  const cm = text.match(/(\d[\d,.]*)\s*\+?\s*connections?\b/i);
  const raw = cm ? Number(cm[1]!.replace(/[,.]/g, "")) : NaN;
  const count = Number.isFinite(raw) && raw > 0 && raw <= MAX_CONNECTIONS ? raw : undefined;
  return { degree, ...(count !== undefined ? { count } : {}) };
}

/** "Renewable Energy", "Bergen", "4,120 followers", "51-200 employees" */
function companyInfoItems(main: Element): string[] {
  const list = main.querySelector(".org-top-card-summary-info-list");
  if (!list) return [];
  const items = Array.from(list.querySelectorAll(".org-top-card-summary-info-list__info-item"))
    .map((el) => clean(el.textContent, MAX_INDUSTRY))
    .filter(Boolean);
  if (items.length) return items;
  return clean(list.textContent, 600)
    .split("·")
    .map((s) => clean(s, MAX_INDUSTRY))
    .filter(Boolean);
}

export function parseLinkedInPage(doc: Document, url: string): LinkedInEntity | null {
  const profileUrl = canonicalLinkedInUrl(url);
  if (!profileUrl) return null;
  const isCompany = profileUrl.includes("/company/");
  const main = doc.querySelector("main") ?? doc.body;
  if (!main) return null;
  const title = titleParts(doc);
  const about = aboutFrom(main);

  if (isCompany) {
    const name = clean(main.querySelector("h1")?.textContent || title.name, MAX_NAME);
    if (!name || /^linkedin$/i.test(name)) return null;
    const headline = clean(
      main.querySelector(".org-top-card-summary__tagline, [class*='tagline']")?.textContent,
      MAX_HEADLINE
    );
    const items = companyInfoItems(main);
    const size = items.find((i) => /\bemployees\b/i.test(i)) ?? "";
    const rest = items.filter((i) => !/\b(employees|followers?)\b/i.test(i));
    const industry = rest[0] ?? "";
    const location = rest[1] ?? "";
    return {
      kind: "company",
      name,
      headline,
      company: name,
      profileUrl,
      ...(location ? { location: clean(location, MAX_LOCATION) } : {}),
      ...(about ? { about } : {}),
      ...(industry ? { industry: clean(industry, MAX_INDUSTRY) } : {}),
      ...(size ? { companySize: clean(size, MAX_SIZE) } : {}),
      ...(headline ? { tagline: headline } : {}),
    };
  }

  const name = clean(main.querySelector("h1")?.textContent || title.name, MAX_NAME);
  if (!name || /^linkedin$/i.test(name)) return null;
  const headline = clean(
    main.querySelector(".text-body-medium")?.textContent || title.rest,
    MAX_HEADLINE
  );
  const companyButton = main
    .querySelector('[aria-label^="Current company"]')
    ?.getAttribute("aria-label")
    ?.match(/^Current company:\s*([^.]+)/i)?.[1];
  const roles = rolesFrom(main);
  const current = roles[0];
  const company = clean(
    companyButton || companyFromHeadline(headline) || current?.company || "",
    MAX_COMPANY
  );
  const card = topCardOf(main);
  const location = locationFrom(card);
  const { degree, count } = connectionsFrom(card);
  const education = educationFrom(main);
  const pastRoles = roles.slice(1, 1 + MAX_PAST_ROLES);

  return {
    kind: "person",
    name,
    headline,
    company,
    profileUrl,
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    ...(current?.title ? { roleTitle: current.title } : {}),
    ...(pastRoles.length ? { pastRoles } : {}),
    ...(education.length ? { education } : {}),
    ...(degree ? { connectionDegree: degree } : {}),
    ...(count !== undefined ? { connectionCount: count } : {}),
  };
}

/**
 * Validates the optional profile detail that arrives with CORTEX_INDEX before
 * it is stored. The payload comes from a page, so every field is type checked,
 * trimmed and capped here, and anything unknown or malformed is dropped.
 */
export function sanitizePersonDetail(raw: unknown): Partial<LinkedInEntity> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/\s+/g, " ").trim().slice(0, max);
    return t || undefined;
  };
  const out: Partial<LinkedInEntity> = {};

  const location = text(o.location, 160);
  if (location) out.location = location;
  const about = text(o.about, 600);
  if (about) out.about = about;
  const roleTitle = text(o.roleTitle, 160);
  if (roleTitle) out.roleTitle = roleTitle;

  if (Array.isArray(o.pastRoles)) {
    const roles: LinkedInRole[] = [];
    for (const r of o.pastRoles) {
      if (roles.length >= 5) break;
      const row = r as Record<string, unknown> | null;
      const title = text(row?.title, 160);
      const company = text(row?.company, 120);
      if (title || company) roles.push({ title: title ?? "", company: company ?? "" });
    }
    if (roles.length) out.pastRoles = roles;
  }

  if (Array.isArray(o.education)) {
    const schools = o.education.map((e) => text(e, 200)).filter((e): e is string => !!e).slice(0, 3);
    if (schools.length) out.education = schools;
  }

  const degree = text(o.connectionDegree, 8);
  if (degree && /^(1st|2nd|3rd)$/.test(degree)) out.connectionDegree = degree;
  const count = o.connectionCount;
  if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
    out.connectionCount = Math.min(Math.floor(count), 1_000_000);
  }

  const industry = text(o.industry, 120);
  if (industry) out.industry = industry;
  const companySize = text(o.companySize, 80);
  if (companySize) out.companySize = companySize;
  const tagline = text(o.tagline, 220);
  if (tagline) out.tagline = tagline;

  return out;
}
