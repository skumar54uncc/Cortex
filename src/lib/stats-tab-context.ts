import { db } from "../db/schema";
import {
  isBlockedDomain,
  looksSensitiveHostname,
} from "./privacy";
import { shouldAlwaysSkipUrl } from "./sensitive-domains";
import type { CortexUserSettings } from "../shared/extension-settings";

export type TabPopupBadge =
  | "active"
  | "paused"
  | "blocked"
  | "skipped"
  | "indexed"
  | "neutral";

export interface TabPopupContext {
  line: string;
  badge: TabPopupBadge;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

export async function describeTabForPopup(
  tabUrl: string,
  tabIncognito: boolean,
  settings: CortexUserSettings
): Promise<TabPopupContext> {
  if (settings.indexingPaused) {
    return { line: "", badge: "paused" };
  }

  if (tabIncognito) {
    return {
      line: "Private window — not indexed.",
      badge: "skipped",
    };
  }

  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return { line: "Can’t index this URL.", badge: "skipped" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      line: "Can’t index this page.",
      badge: "skipped",
    };
  }

  if (shouldAlwaysSkipUrl(tabUrl)) {
    return {
      line: "Skipped — sensitive or inbox/storage URL.",
      badge: "skipped",
    };
  }

  const host = url.hostname.toLowerCase();

  if (settings.allowlistOnly) {
    const ok = settings.allowlist.some((h) => {
      const x = h.trim().toLowerCase();
      return x && (host === x || host.endsWith(`.${x}`));
    });
    if (!ok) {
      return {
        line: "Host not on your allowlist.",
        badge: "blocked",
      };
    }
  }

  if (isBlockedDomain(host, settings.blocklist)) {
    return {
      line: "Domain on your blocklist.",
      badge: "blocked",
    };
  }

  if (looksSensitiveHostname(host, url.pathname)) {
    return {
      line: "Skipped (sensitive URL).",
      badge: "skipped",
    };
  }

  const doc = await db.documents.where("url").equals(tabUrl).first();
  if (doc?.lastVisitedAt) {
    const rel = formatRelativeTime(doc.lastVisitedAt);
    return {
      line: `This page is indexed · ${rel}`,
      badge: "indexed",
    };
  }

  return {
    line: "Not saved yet — keep this tab open briefly so Cortex can capture it.",
    badge: "neutral",
  };
}
