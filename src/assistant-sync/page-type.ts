export const PAGE_TYPES = [
  "Article",
  "Docs",
  "Video",
  "Recipe",
  "News",
  "Job post",
  "Repo",
  "Forum",
  "Shopping",
  "Feed",
  "App",
  "Utility",
  "Other",
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

function host(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isHost(hostname: string, domains: readonly string[]): boolean {
  const h = host(hostname);
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

const VIDEO = ["youtube.com", "youtu.be", "vimeo.com", "twitch.tv"];
const RECIPE = ["allrecipes.com", "seriouseats.com", "bonappetit.com"];
const JOB = ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com"];
const FORUM = ["reddit.com", "news.ycombinator.com", "stackoverflow.com", "stackexchange.com", "lobste.rs"];
const SHOPPING = ["amazon.com", "amazon.co.uk", "ebay.com", "etsy.com", "walmart.com", "bestbuy.com"];
const NEWS = [
  "nytimes.com",
  "bbc.com",
  "bbc.co.uk",
  "reuters.com",
  "apnews.com",
  "theguardian.com",
  "washingtonpost.com",
  "wsj.com",
  "bloomberg.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "cnn.com",
  "npr.org",
];
const DOCS = ["developer.mozilla.org", "readthedocs.io", "gitbook.io", "notion.so", "notion.site"];
const APP = ["figma.com", "linear.app", "slack.com", "discord.com"];
const ARTICLE = ["medium.com", "substack.com", "wikipedia.org", "dev.to"];
const GITHUB_RESERVED = new Set([
  "features",
  "topics",
  "explore",
  "marketplace",
  "settings",
  "notifications",
  "login",
  "signup",
  "about",
  "pricing",
  "search",
  "pulls",
  "issues",
  "new",
  "organizations",
  "orgs",
  "apps",
  "sponsors",
  "customer-stories",
]);

function isRepo(hostname: string, path: string): boolean {
  if (!isHost(hostname, ["github.com", "gitlab.com"])) return false;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  if (GITHUB_RESERVED.has(parts[0]!.toLowerCase())) return false;
  return true;
}

/** Rule based page type from the URL. Unknown pages are Other. */
export function pageTypeForUrl(raw: string): PageType {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Other";
  }
  const h = url.hostname;
  const path = url.pathname.toLowerCase();
  const newsPath = path === "/news" || path.startsWith("/news/");

  if (host(h) === "youtu.be" && path.length > 1) return "Video";
  if (isHost(h, ["youtube.com"]) && path.startsWith("/watch")) return "Video";
  if (isHost(h, ["vimeo.com", "twitch.tv"]) && path.length > 1) return "Video";
  if (isHost(h, ["youtube.com"]) && (path === "/" || path.startsWith("/feed"))) return "Feed";
  if (isHost(h, ["youtube.com"]) && path.startsWith("/results")) return "Utility";

  if (isHost(h, RECIPE) || /\/recipes?\//.test(path)) return "Recipe";
  if (isHost(h, JOB) || /\/jobs?\//.test(path) || path.includes("/careers")) return "Job post";
  if (isRepo(h, url.pathname)) return "Repo";
  if (isHost(h, ["reddit.com"]) && (path === "/" || path === "/r/popular" || path.startsWith("/r/popular/"))) {
    return "Feed";
  }
  if (isHost(h, FORUM)) return "Forum";
  if (isHost(h, SHOPPING) || path.includes("/dp/") || path.includes("/products/")) return "Shopping";
  if (isHost(h, NEWS) || newsPath) return "News";

  if (
    path === "/feed" ||
    path.startsWith("/feed/") ||
    (isHost(h, ["twitter.com", "x.com"]) && (path === "/home" || path.startsWith("/home/"))) ||
    (isHost(h, ["reddit.com"]) && path === "/")
  ) {
    return "Feed";
  }

  if (
    isHost(h, DOCS) ||
    path.startsWith("/docs") ||
    path.includes("/document") ||
    host(h).startsWith("docs.")
  ) {
    return "Docs";
  }

  if (isHost(h, APP) || path.includes("/spreadsheets")) return "App";

  if (
    path.startsWith("/search") ||
    path.startsWith("/travel/flights") ||
    isHost(h, ["duckduckgo.com", "bing.com"]) ||
    host(h) === "accounts.google.com" ||
    isHost(h, ["chromewebstore.google.com"])
  ) {
    return "Utility";
  }

  if (isHost(h, ARTICLE) || /\/(blog|article|articles|posts)\b/.test(path)) return "Article";
  if (isHost(h, VIDEO) && (path === "/" || path === "/feed" || path.startsWith("/feed"))) return "Feed";

  return "Other";
}
