export interface DailyProfile {
  name: string;
  company: string;
}

export interface DailyRead {
  title: string;
  dwellMinutes: number | null;
}

export interface DailySummaryInput {
  profiles: DailyProfile[];
  searches: string[];
  longestRead: DailyRead | null;
  topics: string[];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function profilePhrase(profile: DailyProfile): string {
  const name = clean(profile.name);
  const company = clean(profile.company);
  if (!name && !company) return "";
  if (name && company) return `${name} (${company})`;
  return name || company;
}

/**
 * One sentence per day. Missing dwell, company, searches, or topics are left out.
 * No model writes this text.
 */
export function dailySummary(input: DailySummaryInput): string {
  const parts: string[] = [];

  const profiles = input.profiles.map(profilePhrase).filter(Boolean);
  if (profiles.length === 1) parts.push(`Viewed ${profiles[0]}.`);
  else if (profiles.length > 1) parts.push(`Viewed ${profiles.join(", ")}.`);

  const searches = input.searches.map(clean).filter(Boolean).slice(0, 8);
  if (searches.length) parts.push(`Searched for ${searches.join(", ")}.`);

  const title = clean(input.longestRead?.title ?? "");
  const minutes = input.longestRead?.dwellMinutes;
  if (title && minutes != null && Number.isFinite(minutes) && minutes > 0) {
    const rounded = Math.round(minutes);
    const unit = rounded === 1 ? "minute" : "minutes";
    parts.push(`Longest read was ${title}, ${rounded} ${unit}.`);
  }

  const topics = input.topics.map(clean).filter(Boolean).slice(0, 4);
  if (topics.length) parts.push(`Topics: ${topics.join(", ")}.`);

  if (!parts.length) return "Nothing recorded for this day.";
  return parts.join(" ");
}
