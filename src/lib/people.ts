/**
 * People and company memory (Phase 5.1, detail added in 1.2.x). LinkedIn
 * profiles and company pages the user viewed, answered directly for questions
 * like "who did I view from Tidora last week", before falling back to RAG.
 *
 * Everything here stays on the device: no field captured from a profile is
 * ever sent anywhere. The capture path (content/extract-entry.ts) does not run
 * the LinkedIn entity through redactPII, and this module keeps that as it is,
 * so the detail is stored exactly as the person wrote it on their own page.
 */
import { db, type PersonRecord } from "../db/schema";
import { parseQuestion } from "./chat/question-parser";
import type { LinkedInEntity, LinkedInRole } from "./capture/linkedin";

const MAX_PAST_ROLES = 5;
const MAX_EDUCATION_ITEMS = 3;
/** Keeps a long about text out of a multi person answer. */
const ABOUT_IN_ANSWER = 200;

function s(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function roleList(roles: LinkedInRole[] | undefined): LinkedInRole[] {
  return (roles ?? [])
    .map((r) => ({ title: s(r?.title), company: s(r?.company) }))
    .filter((r) => r.title || r.company)
    .slice(0, MAX_PAST_ROLES);
}

/**
 * The detail fields the page actually carried. A field the page did not show
 * is left out, so a later thin render never blanks what an earlier visit saw.
 */
function detailPatch(e: LinkedInEntity): Partial<PersonRecord> {
  const roles = roleList(e.pastRoles);
  const education = (e.education ?? []).map(s).filter(Boolean).slice(0, MAX_EDUCATION_ITEMS);
  const count =
    typeof e.connectionCount === "number" && Number.isFinite(e.connectionCount) && e.connectionCount > 0
      ? Math.round(e.connectionCount)
      : undefined;
  return {
    ...(s(e.location) ? { location: s(e.location) } : {}),
    ...(s(e.about) ? { about: s(e.about) } : {}),
    ...(s(e.roleTitle) ? { roleTitle: s(e.roleTitle) } : {}),
    ...(roles.length ? { pastRoles: roles } : {}),
    ...(education.length ? { education } : {}),
    ...(s(e.connectionDegree) ? { connectionDegree: s(e.connectionDegree) } : {}),
    ...(count !== undefined ? { connectionCount: count } : {}),
    ...(s(e.industry) ? { industry: s(e.industry) } : {}),
    ...(s(e.companySize) ? { companySize: s(e.companySize) } : {}),
    ...(s(e.tagline) ? { tagline: s(e.tagline) } : {}),
  };
}

export async function upsertPerson(e: LinkedInEntity, now: number = Date.now()): Promise<number> {
  const existing = await db.people.where("profileUrl").equals(e.profileUrl).first();
  const detail = detailPatch(e);
  if (existing?.id != null) {
    await db.people.update(existing.id, {
      kind: e.kind,
      name: e.name,
      headline: e.headline || existing.headline,
      company: e.company || existing.company,
      // Detail the page carried wins; anything it did not show is untouched.
      ...detail,
      lastSeen: now,
      visitCount: (existing.visitCount ?? 1) + 1,
    });
    return existing.id;
  }
  return (await db.people.add({
    kind: e.kind,
    name: e.name,
    headline: e.headline,
    company: e.company,
    profileUrl: e.profileUrl,
    ...detail,
    firstSeen: now,
    lastSeen: now,
    visitCount: 1,
  })) as number;
}

export interface PeopleFilter {
  company?: string;
  since?: number;
  until?: number;
  q?: string;
  limit?: number;
}

/** Every stored detail, lowercased, for token matching. */
function haystack(p: PersonRecord): string {
  return [
    p.name,
    p.headline,
    p.company,
    p.location,
    p.about,
    p.roleTitle,
    ...(p.pastRoles ?? []).flatMap((r) => [r.title, r.company]),
    ...(p.education ?? []),
    p.industry,
    p.companySize,
    p.tagline,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Current employer, the company page itself, or somewhere they used to work. */
function matchesCompany(p: PersonRecord, company: string): boolean {
  if (p.name.toLowerCase() === company) return true;
  const names = [p.company, ...(p.pastRoles ?? []).map((r) => r.company)].filter(Boolean);
  return names.some((n) => n!.toLowerCase().includes(company));
}

export async function listPeople(f: PeopleFilter): Promise<PersonRecord[]> {
  const company = f.company?.trim().toLowerCase();
  const words = (f.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = await db.people.orderBy("lastSeen").reverse().toArray();
  return rows
    .filter((p) => (f.since == null || p.lastSeen >= f.since) && (f.until == null || p.lastSeen <= f.until))
    .filter((p) => !company || matchesCompany(p, company))
    .filter((p) => {
      if (!words.length) return true;
      const hay = haystack(p);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, f.limit ?? 500);
}

export async function deletePerson(id: number): Promise<void> {
  await db.people.delete(id);
}

export interface PeopleQuery {
  company?: string;
  /** Free text matched against every captured detail, not just the company. */
  q?: string;
  timeRange?: { from: Date; to: Date; label: string };
}

const WHO_RE =
  /\b(?:who|which (?:people|profiles?|persons?))\s+(?:did|have)\s+i\s+(?:view|viewed|see|saw|look(?:ed)? at|search(?:ed)?(?: for)?|visit(?:ed)?|check(?:ed)? out)\b/i;
const PEOPLE_I_RE = /\b(?:people|profiles?|persons?)\s+(?:i|that i)\s+(?:viewed|saw|looked at|searched|visited|checked out)\b/i;
/** "who works at PolyWise", "which people worked for Tidora" */
const WORKS_AT_RE =
  /\b(?:who|which (?:people|profiles?|persons?))\s+(?:works?|worked|work)\s+(?:at|for|with)\s+(.+)$/i;
/** "people in North Carolina", "profiles based in Bergen" */
const PEOPLE_IN_RE = /\b(?:people|profiles?|persons?)\s+(?:based in|located in|in)\s+(.+)$/i;
const COMPANY_RE =
  /\b(?:from|at)\s+([A-Z0-9][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*)*)/;
const TIME_WORDS = /^(today|yesterday|last|this|past|earlier|in|on|during)$/i;

/** Drops a trailing time phrase ("... last week") and stray punctuation. */
function untilTimeWords(tail: string): string {
  const kept: string[] = [];
  for (const p of tail.trim().split(/\s+/)) {
    if (TIME_WORDS.test(p)) break;
    kept.push(p.replace(/[?.!,]+$/, ""));
  }
  return kept.join(" ").trim();
}

export function parsePeopleQuery(question: string): PeopleQuery | null {
  const q = String(question ?? "");
  const viewed = WHO_RE.test(q) || PEOPLE_I_RE.test(q);
  const worksAt = !viewed ? q.match(WORKS_AT_RE) : null;
  const inPlace = !viewed && !worksAt ? q.match(PEOPLE_IN_RE) : null;
  if (!viewed && !worksAt && !inPlace) return null;

  const { timeRange } = parseQuestion(q);
  const time = timeRange ? { timeRange } : {};

  if (worksAt) {
    const company = untilTimeWords(worksAt[1]!) || undefined;
    return { company, ...time };
  }
  if (inPlace) {
    const text = untilTimeWords(inPlace[1]!) || undefined;
    return { ...(text ? { q: text } : {}), ...time };
  }

  let company: string | undefined;
  // "look at at Brewlog": skip the verb's own "at".
  const afterVerb = q.replace(WHO_RE, " ").replace(PEOPLE_I_RE, " ");
  const m = afterVerb.match(COMPANY_RE);
  if (m) company = untilTimeWords(m[1]!) || undefined;
  return { company, ...time };
}

export interface PeopleAnswer {
  text: string;
  people: PersonRecord[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function roleText(r: LinkedInRole): string {
  if (r.title && r.company) return `${r.title} at ${r.company}`;
  return r.title || r.company;
}

/** Trims the about text to a whole word, so the answer stays readable. */
function shortAbout(about: string): string {
  if (about.length <= ABOUT_IN_ANSWER) return about;
  const cut = about.slice(0, ABOUT_IN_ANSWER);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[.,;:]$/, "")}...`;
}

/** The captured detail as plain sentences. Empty when there is none. */
function detailSentences(p: PersonRecord): string {
  const out: string[] = [];
  if (p.location) out.push(`Based in ${p.location}.`);
  const current = p.roleTitle ? roleText({ title: p.roleTitle, company: p.company }) : "";
  if (current) out.push(`Currently ${current}.`);
  const past = (p.pastRoles ?? []).map(roleText).filter(Boolean);
  if (past.length) out.push(`Previously ${past.join(", ")}.`);
  if (p.education?.length) out.push(`Studied at ${p.education.join("; ")}.`);
  if (p.industry) out.push(`Industry: ${p.industry}.`);
  if (p.companySize) out.push(`Company size: ${p.companySize}.`);
  const net: string[] = [];
  if (p.connectionDegree) net.push(`${p.connectionDegree} degree connection`);
  if (p.connectionCount) net.push(`${p.connectionCount} connections`);
  if (net.length) out.push(`${net.join(", ")}.`);
  if (p.about) out.push(`About: ${shortAbout(p.about)}`);
  return out.join(" ");
}

export async function answerPeopleQuery(pq: PeopleQuery, _now: number = Date.now()): Promise<PeopleAnswer | null> {
  const people = await listPeople({
    company: pq.company,
    q: pq.q,
    since: pq.timeRange?.from.getTime(),
    until: pq.timeRange?.to.getTime(),
    limit: 25,
  });
  if (!people.length) return null;
  const scope = [
    pq.company ? `from ${pq.company}` : "",
    pq.q ? `matching ${pq.q}` : "",
    pq.timeRange ? pq.timeRange.label : "",
  ]
    .filter(Boolean)
    .join(", ");
  const lines = people.flatMap((p) => {
    const head = `- ${p.name}${p.headline ? `, ${p.headline}` : ""} (last viewed ${fmtDate(p.lastSeen)}${
      p.visitCount > 1 ? `, ${p.visitCount} visits` : ""
    }): ${p.profileUrl}`;
    const detail = detailSentences(p);
    return detail ? [head, `  ${detail}`] : [head];
  });
  const head = `You viewed ${people.length} ${people.length === 1 ? "profile" : "profiles"}${
    scope ? ` ${scope}` : ""
  }:`;
  return { text: `${head}\n${lines.join("\n")}`, people };
}
