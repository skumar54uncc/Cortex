import { parseLinkedInPage, type LinkedInEntity } from "../lib/capture/linkedin";
import { companySectionViewed, howFoundFromReferrer, type CompanySection, type HowFound } from "./linkedin-selectors";
import { redactForSync } from "./redact-sync";

export interface SyncedPerson {
  name: string;
  headline: string;
  company: string;
  profileUrl: string;
  howFound: HowFound | "";
}

export interface SyncedCompany {
  company: string;
  sectionViewed: CompanySection | "";
  linkedinUrl: string;
}

function text(value: string): string {
  return redactForSync(value.replace(/\s+/g, " ").trim());
}

/**
 * Structured LinkedIn row for the sheet.
 * Name, headline, and company come from the existing parser.
 * how_found stays blank when the referrer does not say.
 * A failed parse returns null. Photos and about text are not copied.
 */
export function linkedInSyncRow(
  doc: Document,
  url: string,
  referrer: string | null
): { kind: "person"; person: SyncedPerson } | { kind: "company"; company: SyncedCompany } | null {
  const parsed: LinkedInEntity | null = parseLinkedInPage(doc, url);
  if (!parsed || !parsed.name.trim()) return null;
  if (parsed.kind === "company") {
    return {
      kind: "company",
      company: {
        company: text(parsed.name),
        sectionViewed: companySectionViewed(url, doc),
        linkedinUrl: parsed.profileUrl,
      },
    };
  }
  return {
    kind: "person",
    person: {
      name: text(parsed.name),
      headline: text(parsed.headline),
      company: text(parsed.company),
      profileUrl: parsed.profileUrl,
      howFound: howFoundFromReferrer(referrer),
    },
  };
}
