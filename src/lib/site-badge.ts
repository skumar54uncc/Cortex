/**
 * The small square next to a result, a digest source or a recent page.
 *
 * It used to be a favicon fetched from Google, which meant every domain the
 * user had read was sent to a third party to draw a 16 pixel icon. Core value
 * 1 says nothing leaves the device, so the badge is drawn here from the
 * host name alone: one letter on a colour derived from the host.
 */

/**
 * Prefixes that say nothing about the site. Kept short on purpose: on
 * news.ycombinator.com the subdomain is the site.
 */
const PREFIX = /^(?:www|m|mobile)\./i;

function bareHost(hostname: string): string {
  const h = String(hostname ?? "").trim().toLowerCase();
  return h.replace(PREFIX, "");
}

export function siteInitial(hostname: string): string {
  const h = bareHost(hostname);
  const first = h.replace(/^[^a-z0-9]+/i, "").charAt(0);
  return first ? first.toUpperCase() : "?";
}

export interface SiteBadgeColors {
  background: string;
  text: string;
}

/** Stable across sessions: the same site always gets the same colour. */
export function siteBadgeColors(hostname: string): SiteBadgeColors {
  const h = bareHost(hostname);
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = (hash * 31 + h.charCodeAt(i)) % 360;
  const hue = h ? hash : 210;
  return {
    background: `hsl(${hue} 52% 88%)`,
    text: `hsl(${hue} 58% 26%)`,
  };
}
