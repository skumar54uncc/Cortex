export type DigestRange = "today" | "yesterday" | "last_7_days";

export interface DigestRequest {
  range: DigestRange;
  forceRegenerate?: boolean;
}

export interface DigestResult {
  range: string;
  generatedAt: number;
  pageCount: number;
  domainsCount: number;
  narrative: string;
  topics: Array<{ topic: string; pageCount: number }>;
  insights: Array<{
    text: string;
    sourceUrl: string;
    sourceTitle: string;
  }>;
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    visitedAt: number;
  }>;
}
