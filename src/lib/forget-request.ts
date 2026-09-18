/**
 * Authorization for CORTEX_FORGET (Phase 4.3).
 *
 * - From the in-page overlay (a content script with sender.tab): "site"
 *   always means the tab's own hostname. A hostname in the payload is
 *   ignored, so a page can never direct Cortex at another site's data.
 * - From the options page: "site" uses the typed hostname.
 * - From the side panel shell: time scopes only (there is no page).
 * - Anything from another extension is rejected.
 */
import { normalizeSiteHost } from "./data-controls";

export type ForgetScope = "site" | "hour" | "day" | "all";

export type ForgetDecision =
  | { ok: true; scope: "site"; site: string }
  | { ok: true; scope: Exclude<ForgetScope, "site"> }
  | { ok: false; error: string };

const SCOPES = new Set<ForgetScope>(["site", "hour", "day", "all"]);

export function resolveForgetRequest(
  msg: { scope?: unknown; hostname?: unknown },
  sender: chrome.runtime.MessageSender,
  extensionOrigin: string
): ForgetDecision {
  const scope = msg.scope as ForgetScope;
  if (!SCOPES.has(scope)) return { ok: false, error: "bad_scope" };

  const fromTab = sender.tab != null;
  const senderUrl = sender.url ?? "";
  const fromExtensionPage = !fromTab && senderUrl.startsWith(extensionOrigin);
  if (!fromTab && !fromExtensionPage) return { ok: false, error: "foreign_sender" };

  if (scope !== "site") return { ok: true, scope };

  try {
    if (fromTab) {
      const tabUrl = sender.tab?.url ?? senderUrl;
      const u = new URL(tabUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { ok: false, error: "not_a_web_page" };
      }
      return { ok: true, scope: "site", site: normalizeSiteHost(u.hostname) };
    }
    if (senderUrl.startsWith(`${extensionOrigin}options.html`)) {
      return { ok: true, scope: "site", site: normalizeSiteHost(String(msg.hostname ?? "")) };
    }
    return { ok: false, error: "site_requires_page_or_options" };
  } catch {
    return { ok: false, error: "bad_hostname" };
  }
}
