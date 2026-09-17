/**
 * Example prompt chips for the empty Ask state (Phase 2.8). Built from local
 * data only (recent visit titles and hostnames); generic fallback when the
 * library is empty or thin. No em dashes in user-facing copy.
 */
export interface RecentVisitLite {
  title: string;
  hostname: string;
  visitedAt: number;
}

export interface ExamplePromptInput {
  recent: RecentVisitLite[];
  now?: number;
}

export const GENERIC_EXAMPLE_PROMPTS: string[] = [
  "What did I read about yesterday?",
  "Summarize what I read this week",
  "Which pages mentioned pricing?",
  "What was the article about AI I opened recently?",
];

const MAX_PROMPT_CHARS = 80;

function truncateTitle(title: string, budget: number): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= budget) return t;
  return `${t.slice(0, Math.max(0, budget - 3)).trimEnd()}...`;
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function buildExamplePrompts(input: ExamplePromptInput): string[] {
  const now = input.now ?? Date.now();
  const recent = input.recent
    .filter((r) => r && typeof r.visitedAt === "number")
    .sort((a, b) => b.visitedAt - a.visitedAt);

  const slots: Array<string | null> = [null, null, null];

  // 1. Most recent titled page.
  const titled = recent.find((r) => r.title && r.title.trim().length > 0);
  if (titled) {
    const prefix = "What did I learn from ";
    const budget = MAX_PROMPT_CHARS - prefix.length - 1;
    slots[0] = `${prefix}${truncateTitle(titled.title, budget)}?`;
  }

  // 2. Most visited hostname.
  const counts = new Map<string, number>();
  for (const r of recent) {
    const h = (r.hostname || "").trim().toLowerCase();
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const topDomain = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topDomain) slots[1] = `What have I been reading on ${topDomain}?`;

  // 3. Time based, depending on how recent the activity is.
  if (recent.length) {
    const latest = recent[0].visitedAt;
    if (isSameLocalDay(latest, now)) slots[2] = "What did I read today?";
    else if (now - latest < 2 * 86_400_000) slots[2] = "What did I read about yesterday?";
    else slots[2] = "Summarize what I read this week";
  }

  // Fill gaps positionally with unused generic prompts; keep the three unique.
  const out: string[] = [];
  const generics = [...GENERIC_EXAMPLE_PROMPTS];
  for (const slot of slots) {
    let candidate = slot && slot.length <= MAX_PROMPT_CHARS && !out.includes(slot) ? slot : null;
    while (!candidate && generics.length) {
      const g = generics.shift()!;
      if (!out.includes(g) && !slots.includes(g)) candidate = g;
    }
    if (candidate) out.push(candidate);
  }
  return out.slice(0, 3);
}
