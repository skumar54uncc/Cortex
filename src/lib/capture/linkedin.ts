/**
 * LinkedIn profile and company parsing (Phase 5.1). Runs inside extract.js on
 * linkedin.com pages that passed the privacy gate. Everything read here is
 * page-controlled text: it is trimmed, length-capped, and later rendered with
 * textContent only.
 */
export interface LinkedInEntity {
  kind: "person" | "company";
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
}

const MAX_NAME = 120;
const MAX_HEADLINE = 220;
const MAX_COMPANY = 120;

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

export function parseLinkedInPage(doc: Document, url: string): LinkedInEntity | null {
  const profileUrl = canonicalLinkedInUrl(url);
  if (!profileUrl) return null;
  const isCompany = profileUrl.includes("/company/");
  const main = doc.querySelector("main") ?? doc.body;
  const title = titleParts(doc);

  if (isCompany) {
    const name = clean(main?.querySelector("h1")?.textContent || title.name, MAX_NAME);
    if (!name || /^linkedin$/i.test(name)) return null;
    const headline = clean(
      main?.querySelector(".org-top-card-summary__tagline, [class*='tagline']")?.textContent,
      MAX_HEADLINE
    );
    return { kind: "company", name, headline, company: name, profileUrl };
  }

  const name = clean(main?.querySelector("h1")?.textContent || title.name, MAX_NAME);
  if (!name || /^linkedin$/i.test(name)) return null;
  const headline = clean(
    main?.querySelector(".text-body-medium")?.textContent || title.rest,
    MAX_HEADLINE
  );
  const companyButton = main
    ?.querySelector('[aria-label^="Current company"]')
    ?.getAttribute("aria-label")
    ?.match(/^Current company:\s*([^.]+)/i)?.[1];
  const company = clean(companyButton || companyFromHeadline(headline), MAX_COMPANY);
  return { kind: "person", name, headline, company, profileUrl };
}
