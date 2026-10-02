import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { assistantSyncDb } from "./db";
import { syncDenyReason } from "./denylist";
import { buildExcerpt } from "./excerpt";
import { COMPANY_SECTIONS, HOW_FOUND, type CompanySection, type HowFound } from "./linkedin-selectors";
import { linkedInSyncRow } from "./linkedin-sync";
import { pageTypeForUrl } from "./page-type";
import { redactForSync } from "./redact-sync";
import { parseSearchQuery } from "./search-capture";
import { loadTopicVectors, tagTopics, TOPIC_SIMILARITY_THRESHOLD } from "./topics";

export interface FinalizedVisitInput {
  id: string;
  visitedAt: number;
  title: string;
  url: string;
  /** Null on rows captured before sync measured a visit. Never invented. */
  dwellMinutes: number | null;
  maxScrollPct: number | null;
  pageText: string | null;
  pageEmbedding: number[] | null;
  hasPasswordInput: boolean;
  userDenylist: string[];
  referrer: string | null;
  linkedInDocument: Document | null;
  /**
   * Parsed LinkedIn fields from index time (no Document needed).
   * Used when extract.js already sent a person/company with the visit.
   */
  linkedInFields?: {
    kind: "person" | "company";
    name: string;
    headline?: string;
    company?: string;
    profileUrl: string;
    howFound?: string;
    sectionViewed?: string;
  } | null;
  excerptMinDwellMinutes?: number;
  /** Writes nothing unless the user has turned sync on. */
  syncEnabled: boolean;
}

export interface CaptureResult {
  stored: boolean;
  reason?: string;
}

function clampScroll(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function blankToNull(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function isLinkedInProfileOrCompany(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return false;
    return parsed.pathname.includes("/in/") || parsed.pathname.includes("/company/");
  } catch {
    return false;
  }
}

/**
 * Store one finalized visit in the Assistant Sync database.
 * Denied pages and a disabled toggle write nothing.
 */
export async function captureFinalizedVisit(input: FinalizedVisitInput): Promise<CaptureResult> {
  if (!input.syncEnabled) return { stored: false, reason: "disabled" };

  const canonical = canonicalizeUrl(input.url);
  if (!canonical) return { stored: false, reason: "url" };

  const denied = syncDenyReason(input.url, {
    userDomains: input.userDenylist,
    hasPasswordInput: input.hasPasswordInput,
  });
  if (denied) return { stored: false, reason: denied };

  const title = redactForSync(input.title.replace(/\s+/g, " ").trim());
  const topics = input.pageEmbedding?.length
    ? tagTopics(input.pageEmbedding, TOPIC_SIMILARITY_THRESHOLD, await loadTopicVectors())
    : [];
  const dwellMinutes = blankToNull(input.dwellMinutes);
  const maxScrollPct = clampScroll(input.maxScrollPct);

  await assistantSyncDb.visits.put({
    id: input.id,
    visitedAt: input.visitedAt,
    title,
    url: canonical,
    domain: domainFromUrl(canonical),
    dwellMinutes,
    maxScrollPct,
    pageType: pageTypeForUrl(canonical),
    topics,
  });

  const excerpt = buildExcerpt(redactForSync(input.pageText ?? ""), dwellMinutes, input.excerptMinDwellMinutes);
  if (excerpt && !isLinkedInProfileOrCompany(canonical)) {
    await assistantSyncDb.content.put({
      id: input.id,
      visitedAt: input.visitedAt,
      title,
      url: canonical,
      topics,
      excerpt,
    });
  }

  const search = parseSearchQuery(input.url);
  if (search) {
    await assistantSyncDb.searches.put({
      id: input.id,
      visitedAt: input.visitedAt,
      engine: search.engine,
      query: redactForSync(search.query),
    });
  }

  const linkedRow = input.linkedInDocument
    ? linkedInSyncRow(input.linkedInDocument, input.url, input.referrer)
    : fieldsToLinkedRow(input.linkedInFields ?? null);
  if (linkedRow?.kind === "person") {
    await assistantSyncDb.people.put({
      id: input.id,
      visitedAt: input.visitedAt,
      name: linkedRow.person.name,
      headline: linkedRow.person.headline,
      company: linkedRow.person.company,
      profileUrl: linkedRow.person.profileUrl,
      howFound: linkedRow.person.howFound,
      dwellMinutes,
      maxScrollPct,
    });
  } else if (linkedRow?.kind === "company") {
    await assistantSyncDb.companies.put({
      id: input.id,
      visitedAt: input.visitedAt,
      company: linkedRow.company.company,
      sectionViewed: linkedRow.company.sectionViewed,
      linkedinUrl: linkedRow.company.linkedinUrl,
      dwellMinutes,
    });
  }

  return { stored: true };
}

function asHowFound(value: string | undefined): HowFound | "" {
  return value && (HOW_FOUND as readonly string[]).includes(value) ? (value as HowFound) : "";
}

function asCompanySection(value: string | undefined): CompanySection | "" {
  return value && (COMPANY_SECTIONS as readonly string[]).includes(value) ? (value as CompanySection) : "";
}

function fieldsToLinkedRow(
  fields: FinalizedVisitInput["linkedInFields"]
): ReturnType<typeof linkedInSyncRow> {
  if (!fields || !fields.name.trim() || !fields.profileUrl.trim()) return null;
  if (fields.kind === "company") {
    return {
      kind: "company",
      company: {
        company: redactForSync(fields.name.replace(/\s+/g, " ").trim()),
        sectionViewed: asCompanySection(fields.sectionViewed),
        linkedinUrl: fields.profileUrl,
      },
    };
  }
  return {
    kind: "person",
    person: {
      name: redactForSync(fields.name.replace(/\s+/g, " ").trim()),
      headline: redactForSync((fields.headline ?? "").replace(/\s+/g, " ").trim()),
      company: redactForSync((fields.company ?? "").replace(/\s+/g, " ").trim()),
      profileUrl: fields.profileUrl,
      howFound: asHowFound(fields.howFound),
    },
  };
}
