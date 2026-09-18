/**
 * People and company memory (Phase 5.1). LinkedIn profiles and company pages
 * the user viewed, answered directly for questions like
 * "who did I view from Tidora last week", before falling back to RAG.
 */
import { db, type PersonRecord } from "../db/schema";
import { parseQuestion } from "./chat/question-parser";
import type { LinkedInEntity } from "./capture/linkedin";

export async function upsertPerson(e: LinkedInEntity, now: number = Date.now()): Promise<number> {
  const existing = await db.people.where("profileUrl").equals(e.profileUrl).first();
  if (existing?.id != null) {
    await db.people.update(existing.id, {
      kind: e.kind,
      name: e.name,
      headline: e.headline || existing.headline,
      company: e.company || existing.company,
      lastSeen: now,
      visitCount: (existing.visitCount ?? 1) + 1,
    });
    return existing.id;
  }
  return (await db.people.add({
    ...e,
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

export async function listPeople(f: PeopleFilter): Promise<PersonRecord[]> {
  const company = f.company?.trim().toLowerCase();
  const words = (f.q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = await db.people.orderBy("lastSeen").reverse().toArray();
  return rows
    .filter((p) => (f.since == null || p.lastSeen >= f.since) && (f.until == null || p.lastSeen <= f.until))
    .filter((p) => !company || p.company.toLowerCase().includes(company) || p.name.toLowerCase() === company)
    .filter((p) => {
      if (!words.length) return true;
      const hay = `${p.name} ${p.headline} ${p.company}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, f.limit ?? 500);
}

export async function deletePerson(id: number): Promise<void> {
  await db.people.delete(id);
}

export interface PeopleQuery {
  company?: string;
  timeRange?: { from: Date; to: Date; label: string };
}

const WHO_RE =
  /\b(?:who|which (?:people|profiles?|persons?))\s+(?:did|have)\s+i\s+(?:view|viewed|see|saw|look(?:ed)? at|search(?:ed)?(?: for)?|visit(?:ed)?|check(?:ed)? out)\b/i;
const PEOPLE_I_RE = /\b(?:people|profiles?|persons?)\s+(?:i|that i)\s+(?:viewed|saw|looked at|searched|visited|checked out)\b/i;
const COMPANY_RE =
  /\b(?:from|at)\s+([A-Z0-9][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*)*)/;
const TIME_WORDS = /^(today|yesterday|last|this|past|earlier|in|on|during)$/i;

export function parsePeopleQuery(question: string): PeopleQuery | null {
  const q = String(question ?? "");
  if (!WHO_RE.test(q) && !PEOPLE_I_RE.test(q)) return null;
  let company: string | undefined;
  // "look at at Brewlog": skip the verb's own "at".
  const afterVerb = q.replace(WHO_RE, " ").replace(PEOPLE_I_RE, " ");
  const m = afterVerb.match(COMPANY_RE);
  if (m) {
    const parts = m[1]!.split(/\s+/);
    const kept: string[] = [];
    for (const p of parts) {
      if (TIME_WORDS.test(p)) break;
      kept.push(p.replace(/[?.!,]+$/, ""));
    }
    company = kept.join(" ").trim() || undefined;
  }
  const { timeRange } = parseQuestion(q);
  return { company, ...(timeRange ? { timeRange } : {}) };
}

export interface PeopleAnswer {
  text: string;
  people: PersonRecord[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function answerPeopleQuery(pq: PeopleQuery, _now: number = Date.now()): Promise<PeopleAnswer | null> {
  const people = await listPeople({
    company: pq.company,
    since: pq.timeRange?.from.getTime(),
    until: pq.timeRange?.to.getTime(),
    limit: 25,
  });
  if (!people.length) return null;
  const scope = [
    pq.company ? `from ${pq.company}` : "",
    pq.timeRange ? pq.timeRange.label : "",
  ]
    .filter(Boolean)
    .join(", ");
  const lines = people.map(
    (p) =>
      `- ${p.name}${p.headline ? `, ${p.headline}` : ""} (last viewed ${fmtDate(p.lastSeen)}${
        p.visitCount > 1 ? `, ${p.visitCount} visits` : ""
      }): ${p.profileUrl}`
  );
  const head = `You viewed ${people.length} ${people.length === 1 ? "profile" : "profiles"}${
    scope ? ` ${scope}` : ""
  }:`;
  return { text: `${head}\n${lines.join("\n")}`, people };
}
