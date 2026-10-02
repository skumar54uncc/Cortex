/** Selectors for LinkedIn fields Assistant Sync adds on top of the existing parser. */
export const LINKEDIN_SELECTORS = {
  activeSection: 'a[aria-current="page"], a.org-page-navigation__item-anchor--active',
} as const;

export const COMPANY_SECTIONS = ["About", "Jobs", "People", "Life"] as const;
export type CompanySection = (typeof COMPANY_SECTIONS)[number];

export const HOW_FOUND = ["search", "feed", "people also viewed", "direct"] as const;
export type HowFound = (typeof HOW_FOUND)[number];

const SECTION_BY_SLUG: Record<string, CompanySection> = {
  about: "About",
  jobs: "Jobs",
  people: "People",
  life: "Life",
};

function sectionName(value: string): CompanySection | null {
  const text = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (text === "about" || text.startsWith("about ")) return "About";
  if (text === "jobs" || text.startsWith("jobs ")) return "Jobs";
  if (text === "people" || text.startsWith("people ")) return "People";
  if (text === "life" || text.startsWith("life ")) return "Life";
  return null;
}

/** Company tab from the URL path, then from the active nav link. Blank when neither is present. */
export function companySectionViewed(rawUrl: string, doc?: { querySelector: (selector: string) => { textContent: string | null } | null }): CompanySection | "" {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }
  const parts = url.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
  const companyAt = parts.indexOf("company");
  if (companyAt >= 0) {
    const slug = parts[companyAt + 2];
    if (slug && SECTION_BY_SLUG[slug]) return SECTION_BY_SLUG[slug];
  }
  const active = doc?.querySelector(LINKEDIN_SELECTORS.activeSection)?.textContent ?? "";
  return sectionName(active) ?? "";
}

/**
 * How the profile was opened, from the referrer only.
 * An empty or unrecognized referrer stays blank. It is not recorded as direct.
 */
export function howFoundFromReferrer(referrer: string | null | undefined): HowFound | "" {
  if (!referrer?.trim()) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return "";
  const path = url.pathname.toLowerCase();
  const trk = (url.searchParams.get("trk") ?? "").toLowerCase();
  if (path.startsWith("/search")) return "search";
  if (trk.includes("browsemap") || trk.includes("similar-profiles") || path.includes("people-also-viewed")) {
    return "people also viewed";
  }
  if (path === "/feed" || path.startsWith("/feed/")) return "feed";
  return "";
}
