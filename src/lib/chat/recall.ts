/**
 * Recall questions: "what did I see on YouTube today", "what have I been
 * reading this week", "summarise what I read yesterday".
 *
 * These are not searches over passages. Answering them through retrieval made
 * the model reply "I don't have anything in your library about that" while
 * twenty sources sat underneath it, because no single passage answers "what
 * did I watch". They are answered from the visit record instead: grouped by
 * site, pages named, every page citable.
 */
export type RecallRange = "today" | "yesterday" | "week";

export interface RecallQuery {
  /** Host fragment the user named, lower case, or null for everything. */
  site: string | null;
  range: RecallRange;
  /** Start of the window, milliseconds since the epoch. */
  since: number;
  /** "today", "yesterday", "in the last 7 days". */
  label: string;
}

export interface RecallPage {
  url: string;
  title: string;
  domain: string;
  visitedAt: number;
  summary: string;
}

export interface RecallAnswer {
  text: string;
  sources: RecallPage[];
}

const DAY = 86_400_000;

/** "what did I see", "what have I been reading", "summarise what I read". */
const RECALL_RE =
  /\b(?:what (?:did|have) i (?:been )?(?:see|seen|saw|watch|watched|read|reading|browse|browsed|look(?:ed)? at)|summari[sz]e what i (?:saw|read|watched))\b/i;
const SITE_RE = /\bon\s+([a-z0-9][a-z0-9.-]*[a-z0-9])(?:\b|\s)/i;
const PERIOD: [RegExp, RecallRange][] = [
  [/\b(?:yesterday)\b/i, "yesterday"],
  [/\b(?:this week|last 7 days|last seven days|past week|this month)\b/i, "week"],
  [/\b(?:today|tody|so far|this morning|this afternoon)\b/i, "today"],
];

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function parseRecallQuery(question: string, now: number = Date.now()): RecallQuery | null {
  const q = question.trim();
  if (!RECALL_RE.test(q)) return null;

  let range: RecallRange = "today";
  for (const [re, r] of PERIOD) {
    if (re.test(q)) {
      range = r;
      break;
    }
  }

  const siteMatch = SITE_RE.exec(q);
  let site = siteMatch?.[1]?.toLowerCase() ?? null;
  // "on" also appears in "what did I read on monday": drop day names.
  if (site && /^(mon|tues|wednes|thurs|fri|satur|sun)day$/.test(site)) site = null;

  const since =
    range === "yesterday"
      ? startOfDay(now) - DAY
      : range === "week"
        ? now - 7 * DAY
        : startOfDay(now);
  const label = range === "yesterday" ? "yesterday" : range === "week" ? "in the last 7 days" : "today";
  return { site, range, since, label };
}

function matchesSite(page: RecallPage, site: string | null): boolean {
  if (!site) return true;
  return page.domain.toLowerCase().includes(site) || page.url.toLowerCase().includes(site);
}

const MAX_SITES = 8;
const NAMED_PER_SITE = 4;

export function buildRecallAnswer(query: RecallQuery, pages: RecallPage[]): RecallAnswer {
  const matching = pages
    .filter((p) => matchesSite(p, query.site))
    .sort((a, b) => b.visitedAt - a.visitedAt);

  if (!matching.length) {
    const where = query.site ? ` on ${query.site}` : "";
    return { text: `I have nothing indexed${where} ${query.label}.`, sources: [] };
  }

  const byDomain = new Map<string, RecallPage[]>();
  for (const p of matching) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p]);
  const groups = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length);

  const total = matching.length;
  const where = query.site ? ` on ${query.site}` : "";
  const lines: string[] = [
    `You have ${total} ${total === 1 ? "page" : "pages"}${where} from ${query.label}, across ${groups.length} ${groups.length === 1 ? "site" : "sites"}.`,
    "",
  ];

  const sources: RecallPage[] = [];
  for (const [domain, list] of groups.slice(0, MAX_SITES)) {
    const named = list.slice(0, NAMED_PER_SITE);
    sources.push(...named);
    const titles = named.map((p, i) => `${p.title} [${sources.length - named.length + i + 1}]`).join("; ");
    const rest = list.length - named.length;
    const more = rest > 0 ? `, and ${rest} more` : "";
    lines.push(`* On ${domain} you opened ${list.length} ${list.length === 1 ? "page" : "pages"}: ${titles}${more}.`);
  }

  const withSummary = matching.find((p) => p.summary.trim());
  if (withSummary) {
    lines.push("", `The longest one was about: ${withSummary.summary.trim().slice(0, 200)}`);
  }

  return { text: lines.join("\n"), sources };
}

/** Pages of the period, newest first, straight from the library. */
export async function loadRecallPages(
  query: RecallQuery,
  table: { where: (i: string) => { aboveOrEqual: (v: number) => { toArray: () => Promise<RecallDoc[]> } } },
  limit = 400
): Promise<RecallPage[]> {
  const rows = await table.where("lastVisitedAt").aboveOrEqual(query.since).toArray();
  return rows
    .map((d) => ({
      url: String(d.url ?? ""),
      title: String(d.title ?? "").trim() || "Untitled",
      domain: String(d.domain ?? ""),
      visitedAt: Number(d.lastVisitedAt ?? 0),
      summary: String(d.summary ?? ""),
    }))
    .filter((p) => p.url)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, limit);
}

interface RecallDoc {
  url?: unknown;
  title?: unknown;
  domain?: unknown;
  lastVisitedAt?: unknown;
  summary?: unknown;
}
