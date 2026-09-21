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
  /**
   * One or two plain sentences saying what this profile carried: role and
   * company, where they are, and the opening of the about text. Shown on the
   * person card and searched, so the owner can find someone by what they do.
   */
  summary?: string;
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

/* ------------------------------------------------------------------ names */

/** A name longer than this is chrome or a whole paragraph, not a person. */
const MAX_PLAUSIBLE_NAME = 80;
/** A slug with more parts than this is not a name either. */
const MAX_NAME_PARTS = 6;

/**
 * LinkedIn chrome that has been stored as a person's name: nav items, the
 * notification panel heading, sign in prompts, the product name itself.
 * Compared with letters and digits only, so "My Network" and "MyNetwork"
 * are the same entry.
 */
const JUNK_NAMES = new Set([
  "notifications",
  "notification",
  "home",
  "mynetwork",
  "network",
  "jobs",
  "job",
  "messaging",
  "messages",
  "message",
  "feed",
  "linkedin",
  "linkedinmember",
  "linkedincorporation",
  "linkedinuser",
  "member",
  "signin",
  "signup",
  "login",
  "logout",
  "joinnow",
  "join",
  "search",
  "searchresults",
  "premium",
  "trypremium",
  "retrypremium",
  "profile",
  "myitems",
  "me",
  "work",
  "post",
  "startapost",
  "groups",
  "events",
  "learning",
  "salesnavigator",
  "recruiter",
  "advertise",
  "settings",
  "help",
  "menu",
  "more",
  "back",
  "close",
  "unknown",
  "unknownuser",
  "deletedmember",
]);

/** Words that only ever appear together in chrome ("Home My Network Jobs"). */
const JUNK_WORDS = new Set([
  "notifications",
  "home",
  "my",
  "network",
  "jobs",
  "messaging",
  "messages",
  "feed",
  "linkedin",
  "search",
  "premium",
  "sign",
  "in",
  "join",
  "now",
  "me",
  "work",
  "post",
  "member",
  "menu",
  "more",
  "back",
  "close",
]);

/** "(12) Notifications" is the tab title with an unread counter on it. */
function stripCounter(s: string): string {
  return s.replace(/^\s*\(\s*\d+\s*\)\s*/, "");
}

/** Letters and digits only, lowercased: the key both junk lists compare on. */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * True when this text must never be stored as a name: LinkedIn chrome, a
 * counter, digits or punctuation on their own, or something too long or
 * multi line to be a name at all.
 */
export function isJunkProfileName(raw: string | null | undefined): boolean {
  const original = String(raw ?? "");
  if (/[\r\n]/.test(original)) return true;
  const text = stripCounter(original).replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_PLAUSIBLE_NAME) return true;
  const key = nameKey(text);
  // Nothing but digits or punctuation, or a single character.
  if (!/\p{L}/u.test(key) || key.length < 2) return true;
  if (JUNK_NAMES.has(key)) return true;
  const words = text.split(/\s+/).map(nameKey).filter(Boolean);
  return words.length > 0 && words.every((w) => JUNK_WORDS.has(w));
}

/** "-1a2b3c4", "12345": LinkedIn's uniqueness suffix, never part of a name. */
function isIdPart(part: string): boolean {
  return /^(?=.*\d)[\p{L}\p{N}]+$/u.test(part);
}

function titleCasePart(part: string): string {
  return part.charAt(0).toLocaleUpperCase() + part.slice(1);
}

/**
 * The name a canonical profile URL carries: /in/jenna-leigh-hornbeak/ gives
 * "Jenna Leigh Hornbeak". Returns "" when the slug cannot plausibly be a name
 * (an id, a single letter, or chrome), so the caller stores nothing instead.
 */
export function nameFromProfileUrl(url: string): string {
  const canonical = canonicalLinkedInUrl(String(url ?? ""));
  if (!canonical) return "";
  const slug = decodeURIComponent(canonical.split("/").filter(Boolean).pop() ?? "");
  const parts = slug.split(/[-._%+\s]+/).filter(Boolean);
  // Drop the trailing id segments LinkedIn appends to keep slugs unique.
  while (parts.length > 1 && isIdPart(parts[parts.length - 1]!)) parts.pop();
  if (!parts.length || parts.length > MAX_NAME_PARTS) return "";
  if (parts.some((p) => isIdPart(p) || !/\p{L}/u.test(p))) return "";
  const name = parts.map(titleCasePart).join(" ");
  if (name.length < 2 || isJunkProfileName(name)) return "";
  return name;
}

/**
 * The name to store: the first candidate the page gave that is not chrome,
 * else the profile slug. "" means this profile must not be recorded at all.
 */
export function resolveProfileName(
  candidates: (string | null | undefined)[],
  profileUrl: string
): string {
  for (const c of candidates) {
    const text = stripCounter(String(c ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text && !isJunkProfileName(text)) return text.slice(0, MAX_NAME);
  }
  return nameFromProfileUrl(profileUrl);
}

/* --------------------------------------------------------------- summary */

/** About this much: one or two sentences that fit on a card. */
const MAX_SUMMARY = 200;

export interface ProfileSummaryInput {
  kind?: "person" | "company";
  name?: string;
  headline?: string;
  company?: string;
  location?: string;
  about?: string;
  roleTitle?: string;
  industry?: string;
  companySize?: string;
  tagline?: string;
}

/** Cuts on a word boundary and marks the cut, never mid word. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 20 ? cut.slice(0, sp) : cut).replace(/[.,;:·]+$/, "")}...`;
}

function asSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[·|,;:.\s]+$/, "");
  return t ? `${t}.` : "";
}

/** Titles and abbreviations whose full stop does not end a sentence. */
const ABBREVIATION =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|inc|ltd|llc|co|corp|vs|etc|e\.g|i\.e|u\.s|ph\.d)$/i;
/** Below this a "sentence" is an initial or a stray dot, not a thought. */
const MIN_SENTENCE = 12;

/** The first sentence of an about text, or "" when there is nothing usable. */
function firstSentence(about: string): string {
  const t = about.replace(/\s+/g, " ").trim();
  if (!t) return "";
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    const at = m.index ?? 0;
    if (at + 1 < MIN_SENTENCE) continue;
    if (ABBREVIATION.test(t.slice(0, at))) continue;
    return t.slice(0, at + 1).trim();
  }
  return t.length <= 140 ? asSentence(t) : "";
}

/** The headline without the trailing tagline LinkedIn joins with a bullet. */
function headlineLead(headline: string): string {
  return headline.split("·")[0]!.replace(/\s+/g, " ").trim();
}

/**
 * A short, plain description of what this profile carried. Built from the
 * strongest signals the page gave: role and company, place, and the opening
 * of the about text. "" when the page carried nothing worth saying.
 */
export function buildProfileSummary(e: ProfileSummaryInput): string {
  const t = (v: string | undefined): string => String(v ?? "").replace(/\s+/g, " ").trim();
  const company = t(e.company);
  const location = t(e.location);
  const headline = headlineLead(t(e.headline));
  let head = "";

  if (e.kind === "company") {
    head = t(e.tagline) || headline;
    const facts = [t(e.industry), location, t(e.companySize)].filter(Boolean).join(", ");
    const parts = [head ? asSentence(head) : "", facts ? asSentence(facts) : ""].filter(Boolean);
    let out = parts.join(" ");
    const opening = firstSentence(t(e.about));
    if (opening && `${out} ${opening}`.trim().length <= MAX_SUMMARY) out = `${out} ${opening}`.trim();
    return fit(out, MAX_SUMMARY);
  }

  const role = t(e.roleTitle);
  if (role && company) head = `${role} at ${company}`;
  else if (role) head = role;
  else if (headline && company && !headline.toLowerCase().includes(company.toLowerCase()))
    head = `${headline} at ${company}`;
  else if (headline) head = headline;
  else if (company) head = `Works at ${company}`;

  if (head && location) head = `${head}, based in ${location}`;
  else if (!head && location) head = `Based in ${location}`;

  let out = head ? asSentence(head) : "";
  const opening = firstSentence(t(e.about));
  if (opening) {
    const joined = `${out} ${opening}`.trim();
    if (joined.length <= MAX_SUMMARY) out = joined;
  }
  return fit(out, MAX_SUMMARY);
}

/* ----------------------------------------------------------------- parse */

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

/**
 * Nav, header, footer and the notification or messaging overlays. Text inside
 * these belongs to the viewer's own LinkedIn, not to the profile subject, so
 * the parse never reads a name out of it.
 */
function isChromeElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "nav" || tag === "header" || tag === "footer" || tag === "aside") return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "dialog") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  return /notification|global-nav|global-footer|msg-overlay|nav-item|scaffold-layout-toolbar|search-global/i.test(
    `${el.id} ${cls}`
  );
}

function inChrome(el: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (isChromeElement(node)) return true;
  }
  return false;
}

/** The og:title meta, which LinkedIn fills with "Name - Headline". */
function ogTitleName(doc: Document): string {
  const raw = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
  const cleaned = raw.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const idx = cleaned.indexOf(" - ");
  return (idx === -1 ? cleaned : cleaned.slice(0, idx)).trim();
}

/**
 * Every heading that could be the profile subject's name, best first and with
 * the page chrome left out.
 */
function headingCandidates(main: Element, isCompany: boolean): string[] {
  const selectors = isCompany
    ? [".org-top-card-summary__title", ".org-top-card h1", "h1"]
    : [".pv-top-card h1", ".pv-text-details__left-panel h1", "h1.text-heading-xlarge", "h1"];
  const out: string[] = [];
  const seen = new Set<Element>();
  for (const sel of selectors) {
    for (const el of Array.from(main.querySelectorAll(sel))) {
      if (seen.has(el) || inChrome(el)) continue;
      seen.add(el);
      out.push(clean(el.textContent, MAX_NAME));
    }
  }
  return out.filter(Boolean);
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
    for (const el of Array.from(main.querySelectorAll(sel))) {
      if (!inChrome(el)) return el;
    }
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
    const name = resolveProfileName(
      [...headingCandidates(main, true), ogTitleName(doc), title.name],
      profileUrl
    );
    if (!name) return null;
    const headline = clean(
      main.querySelector(".org-top-card-summary__tagline, [class*='tagline']")?.textContent,
      MAX_HEADLINE
    );
    const items = companyInfoItems(main);
    const size = items.find((i) => /\bemployees\b/i.test(i)) ?? "";
    const rest = items.filter((i) => !/\b(employees|followers?)\b/i.test(i));
    const industry = rest[0] ?? "";
    const location = rest[1] ?? "";
    const entity: LinkedInEntity = {
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
    const companySummary = buildProfileSummary(entity);
    return companySummary ? { ...entity, summary: companySummary } : entity;
  }

  const name = resolveProfileName(
    [...headingCandidates(main, false), ogTitleName(doc), title.name],
    profileUrl
  );
  if (!name) return null;
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

  const entity: LinkedInEntity = {
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
  const summary = buildProfileSummary(entity);
  return summary ? { ...entity, summary } : entity;
}

/** A stored summary may run a little past the built one, never further. */
const MAX_STORED_SUMMARY = 240;

/**
 * Validates the optional profile detail that arrives with CORTEX_INDEX before
 * it is stored. The payload comes from a page, so every field is type checked,
 * trimmed and capped here, and anything unknown or malformed is dropped.
 *
 * It also guards the name: a page that hands over LinkedIn chrome ("(1)
 * Notifications") gets the name the profile slug carries instead, and the
 * field is left off when nothing plausible can be had, so the caller stores
 * nothing rather than junk.
 */
export function sanitizePersonDetail(raw: unknown): Partial<LinkedInEntity> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/\s+/g, " ").trim().slice(0, max);
    return t || undefined;
  };
  const out: Partial<LinkedInEntity> = {};

  const profileUrl = typeof o.profileUrl === "string" ? o.profileUrl : "";
  const name = resolveProfileName([typeof o.name === "string" ? o.name : ""], profileUrl);
  if (name) out.name = name;

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

  // The summary the capture built, capped. Nothing is invented here: a
  // payload without one is left without one, so a restored backup comes back
  // exactly as it was exported, and upsertPerson builds the summary instead.
  const summary = text(o.summary, MAX_STORED_SUMMARY);
  if (summary) out.summary = summary;

  return out;
}
