export type QuestionIntent =
  | "summarize_period"
  | "find_specific"
  | "general_qa"
  | "list_items"
  | "extract_action"
  | "unknown";

export interface ParsedQuestion {
  rawQuery: string;
  searchQuery: string;
  timeRange?: { from: Date; to: Date; label: string };
  intent: QuestionIntent;
  estimatedComplexity: "low" | "medium" | "high";
}

const TIME_PATTERNS: Array<{
  regex: RegExp;
  resolver: (_match: RegExpMatchArray) => { from: Date; to: Date; label: string };
}> = [
  {
    regex: /\b(today|so far today|this morning|this afternoon)\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end, label: "today" };
    },
  },
  {
    regex: /\b(yesterday|last day)\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end, label: "yesterday" };
    },
  },
  {
    regex: /\b(last week|past week)\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: new Date(), label: "the last week" };
    },
  },
  {
    regex: /\bthis week\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: new Date(), label: "this week" };
    },
  },
  {
    regex: /\b(last month|past month)\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: new Date(), label: "the last month" };
    },
  },
  {
    regex: /\bthis month\b/i,
    resolver: (_match) => {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: new Date(), label: "this month" };
    },
  },
  {
    regex: /\b(\d+)\s+(day|days|week|weeks|month|months)\s+ago\b/i,
    resolver: (match) => {
      const n = Math.min(120, Math.max(1, parseInt(match[1]!, 10)));
      const unit = match[2]!.toLowerCase();
      const end = new Date();
      const start = new Date();
      if (unit.startsWith("week")) start.setDate(start.getDate() - n * 7);
      else if (unit.startsWith("month")) start.setDate(start.getDate() - n * 30);
      else start.setDate(start.getDate() - n);
      start.setHours(0, 0, 0, 0);
      return {
        from: start,
        to: end,
        label: `${n} ${unit.startsWith("month") ? "month(s)" : unit.startsWith("week") ? "week(s)" : "day(s)"} ago`,
      };
    },
  },
];

const INTENT_PATTERNS: Array<{ regex: RegExp; intent: QuestionIntent }> = [
  {
    regex: /\b(summari[sz]e|summary|recap|overview|digest|tldr)\b/i,
    intent: "summarize_period",
  },
  {
    regex: /\b(which|what)\s+(site|website|article|blog|page|video)\b/i,
    intent: "find_specific",
  },
  {
    regex: /\b(list|show me all|what.+did i read|which.+pages)\b/i,
    intent: "list_items",
  },
  {
    regex:
      /\b(what did|what does|what was|how does|how did|why did|why does)\b/i,
    intent: "general_qa",
  },
];

const STOPWORDS_TIME = [
  "yesterday",
  "today",
  "tomorrow",
  "last",
  "past",
  "this",
  "week",
  "month",
  "day",
  "days",
  "weeks",
  "months",
  "ago",
  "far",
  "morning",
  "afternoon",
];

export function parseQuestion(raw: string): ParsedQuestion {
  const normalized = raw.trim();

  let timeRange: ParsedQuestion["timeRange"];
  for (const pattern of TIME_PATTERNS) {
    const m = normalized.match(pattern.regex);
    if (m) {
      timeRange = pattern.resolver(m);
      break;
    }
  }

  let intent: QuestionIntent = "general_qa";
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      intent = pattern.intent;
      break;
    }
  }

  const cleanWords = normalized
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !STOPWORDS_TIME.includes(w))
    .filter(
      (w) =>
        !/^(summari[sz]e|summary|recap|tldr|which|what|find|show|tell|me)$/i.test(
          w
        )
    );
  const searchQuery =
    cleanWords.join(" ").trim() ||
    normalized.replace(/\s+/g, " ").trim() ||
    normalized;

  let estimatedComplexity: ParsedQuestion["estimatedComplexity"] = "low";
  if (intent === "summarize_period") {
    if (timeRange?.label === "today" || timeRange?.label === "yesterday") {
      estimatedComplexity = "medium";
    } else {
      estimatedComplexity = "high";
    }
  } else if (intent === "list_items") {
    estimatedComplexity = "medium";
  }

  return {
    rawQuery: raw,
    searchQuery,
    timeRange,
    intent,
    estimatedComplexity,
  };
}
