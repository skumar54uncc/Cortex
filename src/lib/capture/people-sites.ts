/**
 * Person profiles that are not LinkedIn. LinkedIn stays in capture/linkedin.ts.
 * Each parser reads textContent only and returns the same person shape the
 * People tab already stores: name, role, organization.
 */
import { profilePhotoUrl, type LinkedInEntity } from "./linkedin";

function clean(s: string | null | undefined, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function textOf(root: ParentNode, selector: string, max: number): string {
  return clean(root.querySelector(selector)?.textContent, max);
}

function meta(doc: Document, selector: string, max: number): string {
  return clean(doc.querySelector(selector)?.getAttribute("content"), max);
}

const GITHUB_RESERVED = new Set([
  "settings", "marketplace", "topics", "explore", "notifications", "login", "signup",
  "features", "about", "pricing", "enterprise", "customer-stories", "orgs", "organizations",
  "new", "codespaces", "sponsors", "collections", "events", "security", "issues", "pulls",
  "apps", "account", "sessions", "readme", "home", "search",
]);

const X_RESERVED = new Set([
  "home", "explore", "notifications", "messages", "settings", "i", "search", "compose",
  "tos", "privacy", "login", "signup", "intent", "share", "hashtag", "jobs", "download",
  "welcome", "about",
]);

function oneSegment(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 1 ? parts[0]! : "";
}

/** Canonical profile URL for the sites added beside LinkedIn, or null. */
export function canonicalProfileUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "github.com") {
    const login = oneSegment(u.pathname).toLowerCase();
    if (!login || GITHUB_RESERVED.has(login) || login.includes(".")) return null;
    return `https://github.com/${login}`;
  }

  if (host === "x.com" || host === "twitter.com") {
    const handle = oneSegment(u.pathname).replace(/^@/, "");
    if (!handle || X_RESERVED.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
    return `https://x.com/${handle}`;
  }

  if (host === "scholar.google.com" || host.endsWith(".scholar.google.com")) {
    const id = u.searchParams.get("user")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{8,20}$/.test(id)) return null;
    if (!u.pathname.startsWith("/citations")) return null;
    return `https://scholar.google.com/citations?user=${id}`;
  }

  if (host === "orcid.org") {
    const id = parts[0] ?? "";
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(id)) return null;
    return `https://orcid.org/${id.toUpperCase().replace(/X$/, "X")}`;
  }

  if (host === "crunchbase.com") {
    const slug = parts[0] === "person" ? parts[1] : "";
    if (!slug || parts.length < 2) return null;
    return `https://www.crunchbase.com/person/${slug.toLowerCase()}`;
  }

  if (host === "wellfound.com" || host === "angel.co") {
    const slug = parts[0] === "u" ? parts[1] : "";
    if (!slug) return null;
    return `https://wellfound.com/u/${slug.toLowerCase()}`;
  }

  if (host === "theorg.com") {
    if (parts[0] !== "org" || parts[2] !== "org-chart" || !parts[1] || !parts[3]) return null;
    return `https://theorg.com/org/${parts[1].toLowerCase()}/org-chart/${parts[3].toLowerCase()}`;
  }

  if (host === "researchgate.net") {
    const slug = parts[0] === "profile" ? parts[1] : "";
    if (!slug || slug.length < 3) return null;
    return `https://www.researchgate.net/profile/${slug}`;
  }

  return null;
}

function titled(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function roleAndOrg(line: string): { role: string; company: string } {
  const t = clean(line, 220);
  const m = t.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,80})$/i);
  if (!m) return { role: t, company: "" };
  return { role: clean(m[1], 160), company: clean(m[2], 120) };
}

function person(profileUrl: string, name: string, headline: string, company: string, extra: Partial<LinkedInEntity> = {}): LinkedInEntity | null {
  const n = clean(name, 120);
  if (n.length < 2) return null;
  const head = clean(headline, 220);
  const org = clean(company, 120);
  return {
    kind: "person",
    name: n,
    headline: head,
    company: org,
    profileUrl,
    ...extra,
  };
}

function parseGitHub(doc: Document, profileUrl: string): LinkedInEntity | null {
  if (doc.querySelector("[itemtype*='Organization'], .org-header, h1.orgname")) return null;
  const tag = meta(doc, 'meta[name="hovercard-subject-tag"]', 40).toLowerCase();
  if (tag === "organization") return null;
  const name = textOf(doc, ".p-name, .vcard-fullname, h1.vcard-names .p-name", 120) || meta(doc, 'meta[property="og:title"]', 120).replace(/\s*·\s*GitHub\s*$/i, "");
  const bio = textOf(doc, ".p-note, [itemprop='description']", 500);
  const company = textOf(doc, "[itemprop='worksFor'], .p-org", 120);
  const location = textOf(doc, "[itemprop='homeLocation'], .p-label", 120);
  const headline = bio || (company ? `Works at ${company}` : "");
  const photo =
    doc.querySelector("img.avatar-user, img.avatar, img[src*='avatars.githubusercontent.com']")?.getAttribute("src")
    || meta(doc, 'meta[property="og:image"]', 400);
  const photoUrl = profilePhotoUrl(photo);
  return person(profileUrl, name, headline, company, {
    ...(location ? { location } : {}),
    ...(bio ? { about: bio, profileText: bio } : {}),
    ...(photoUrl ? { photoUrl } : {}),
  });
}

function parseX(doc: Document, profileUrl: string): LinkedInEntity | null {
  const block = textOf(doc, '[data-testid="UserName"]', 160);
  const fromBlock = block.split(/\s+@/)[0] ?? "";
  const og = meta(doc, 'meta[property="og:title"]', 160).replace(/\s*\(@[^)]+\)\s*\/\s*X\s*$/i, "").replace(/\s+on X:\s+.*$/i, "");
  const name = fromBlock || og;
  const bio = textOf(doc, '[data-testid="UserDescription"]', 500) || meta(doc, 'meta[name="description"]', 500);
  const { role, company } = roleAndOrg(bio);
  return person(profileUrl, name, bio, company, {
    ...(role && role !== bio ? { roleTitle: role } : {}),
    ...(bio ? { about: bio, profileText: bio } : {}),
  });
}

function parseScholar(doc: Document, profileUrl: string): LinkedInEntity | null {
  const name = textOf(doc, "#gsc_prf_in", 120) || meta(doc, 'meta[property="og:title"]', 120).replace(/\s*-\s*Google Scholar\s*$/i, "");
  const affiliation = textOf(doc, ".gsc_prf_il", 160);
  const interests = Array.from(doc.querySelectorAll(".gsc_prf_inta"))
    .map((el) => clean(el.textContent, 80))
    .filter(Boolean)
    .slice(0, 8);
  const headline = [affiliation, interests.length ? interests.join(", ") : ""].filter(Boolean).join(" · ");
  return person(profileUrl, name, headline, affiliation, {
    ...(interests.length ? { profileText: interests.join(", ") } : {}),
  });
}

function parseOrcid(doc: Document, profileUrl: string): LinkedInEntity | null {
  const name = textOf(doc, "h1, .orc-font-heading, .full-name", 120);
  const org = textOf(doc, "#cy-affiliation-title, .employment .org, [class*='affiliation']", 160);
  const role = textOf(doc, ".employment .role, [class*='employment-title']", 160);
  const headline = [role, org].filter(Boolean).join(" at ");
  return person(profileUrl, name, headline, org, role ? { roleTitle: role } : {});
}

function parseCrunchbase(doc: Document, profileUrl: string): LinkedInEntity | null {
  const name = textOf(doc, "h1", 120) || (meta(doc, 'meta[property="og:title"]', 120).split(/\s+-\s+/)[0] ?? "");
  const line = textOf(doc, ".profile-name + div, h1 + div, [class*='entity-description']", 220)
    || meta(doc, 'meta[property="og:description"]', 220);
  const { role, company } = roleAndOrg(line.replace(/\s*\|\s*Crunchbase.*$/i, ""));
  return person(profileUrl, name, line, company, role ? { roleTitle: role } : {});
}

function parseWellfound(doc: Document, profileUrl: string): LinkedInEntity | null {
  const name = textOf(doc, "h1", 120);
  const line = textOf(doc, "h1 + div, .subheader, [class*='headline']", 220);
  const { role, company } = roleAndOrg(line);
  return person(profileUrl, name, line, company, role ? { roleTitle: role } : {});
}

function parseTheOrg(doc: Document, profileUrl: string, orgSlug: string): LinkedInEntity | null {
  const name = textOf(doc, "h1", 120);
  const role = textOf(doc, "h1 + p, h1 + div, [class*='position'], [class*='role']", 160);
  const company = titled(orgSlug);
  const headline = role && company ? `${role} at ${company}` : role || company;
  return person(profileUrl, name, headline, company, role ? { roleTitle: role } : {});
}

function parseResearchGate(doc: Document, profileUrl: string): LinkedInEntity | null {
  const name = textOf(doc, "h1", 120) || (meta(doc, 'meta[property="og:title"]', 160).split(/\s*\|\s*/)[0] ?? "");
  const org = textOf(doc, "[itemprop='affiliation'], .institution, [class*='institution']", 160);
  const role = textOf(doc, "[itemprop='jobTitle'], .title", 160);
  const headline = [role, org].filter(Boolean).join(" at ");
  return person(profileUrl, name, headline, org, role ? { roleTitle: role } : {});
}

/** A person from a non-LinkedIn profile page, or null when the page is not one. */
export function parseProfilePage(doc: Document, url: string): LinkedInEntity | null {
  const profileUrl = canonicalProfileUrl(url);
  if (!profileUrl) return null;
  const host = hostOf(url);
  if (host === "github.com") return parseGitHub(doc, profileUrl);
  if (host === "x.com" || host === "twitter.com") return parseX(doc, profileUrl);
  if (host === "scholar.google.com") return parseScholar(doc, profileUrl);
  if (host === "orcid.org") return parseOrcid(doc, profileUrl);
  if (host === "crunchbase.com") return parseCrunchbase(doc, profileUrl);
  if (host === "wellfound.com" || host === "angel.co") return parseWellfound(doc, profileUrl);
  if (host === "theorg.com") {
    const org = new URL(profileUrl).pathname.split("/")[2] ?? "";
    return parseTheOrg(doc, profileUrl, org);
  }
  if (host === "researchgate.net") return parseResearchGate(doc, profileUrl);
  return null;
}
