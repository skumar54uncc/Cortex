import { canonicalizeUrl, domainFromUrl } from "./canonical-url";
import { assistantSyncDb } from "./db";
import { syncDenyReason } from "./denylist";
import { buildExcerpt } from "./excerpt";
import { linkedInSyncRow } from "./linkedin-sync";
import { pageTypeForUrl } from "./page-type";
import { redactForSync } from "./redact-sync";
import { parseSearchQuery } from "./search-capture";
import { tagTopics } from "./topics";

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
  const topics = tagTopics(input.pageEmbedding);
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

  if (input.linkedInDocument) {
    const row = linkedInSyncRow(input.linkedInDocument, input.url, input.referrer);
    if (row?.kind === "person") {
      await assistantSyncDb.people.put({
        id: input.id,
        visitedAt: input.visitedAt,
        name: row.person.name,
        headline: row.person.headline,
        company: row.person.company,
        profileUrl: row.person.profileUrl,
        howFound: row.person.howFound,
        dwellMinutes,
        maxScrollPct,
      });
    } else if (row?.kind === "company") {
      await assistantSyncDb.companies.put({
        id: input.id,
        visitedAt: input.visitedAt,
        company: row.company.company,
        sectionViewed: row.company.sectionViewed,
        linkedinUrl: row.company.linkedinUrl,
        dwellMinutes,
      });
    }
  }

  return { stored: true };
}
