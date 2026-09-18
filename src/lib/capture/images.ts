/**
 * Images (Phase 5.8).
 *
 * Default: main-content images of 100 px and up are indexed through their
 * text (alt, figcaption, title, aria-label, nearest heading) as one `image`
 * chunk per page. No pixels are read.
 *
 * Optional: on-device descriptions through the Chrome Prompt API image input,
 * off by default, at most 5 per page, only when the user turned it on, the
 * policy allows it and the API reports image input as available. The
 * descriptions stay on the device: they are stripped from any snippet sent to
 * Gemini.
 */
import type { ChunkLocator, NewChunk } from "../../db/schema";

export const IMAGE_LIMITS = { minSize: 100, maxImages: 20, maxDescriptions: 5, maxTextPerImage: 300 } as const;
export const DESCRIPTION_PREFIX = "  Description (on device): ";

function clean(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, IMAGE_LIMITS.maxTextPerImage);
}

/**
 * Smaller of rendered and natural size, so a large file shown as an icon and
 * a 1 px tracker stretched by attributes are both skipped. Either may be 0
 * (not laid out, not loaded yet); then the other one decides.
 */
function size(img: HTMLImageElement, attr: "width" | "height"): number {
  const natural = (attr === "width" ? img.naturalWidth : img.naturalHeight) || 0;
  const rendered = (attr === "width" ? img.width : img.height) || Number(img.getAttribute(attr)) || 0;
  if (natural && rendered) return Math.min(natural, rendered);
  return natural || rendered;
}

function nearestHeading(img: Element, doc: Document): string {
  let best = "";
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING) best = clean(h.textContent);
  });
  return best;
}

function absoluteHttp(src: string | null, base: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function extractImages(doc: Document, baseUrl: string): NewChunk | null {
  const root = doc.querySelector("article, main, [role='main']") ?? doc.body;
  if (!root) return null;
  const images: { src: string; alt: string }[] = [];
  const lines: string[] = [];
  for (const img of [...root.querySelectorAll("img")] as HTMLImageElement[]) {
    if (images.length >= IMAGE_LIMITS.maxImages) break;
    if (img.closest("header, nav, footer, aside")) continue;
    if (img.hasAttribute("alt") && img.getAttribute("alt")!.trim() === "") continue; // decorative
    if (size(img, "width") < IMAGE_LIMITS.minSize || size(img, "height") < IMAGE_LIMITS.minSize) continue;
    const src = absoluteHttp(img.getAttribute("src"), baseUrl);
    if (!src) continue;
    const alt = clean(img.getAttribute("alt"));
    const aria = clean(img.getAttribute("aria-label"));
    const title = clean(img.getAttribute("title"));
    const caption = clean(img.closest("figure")?.querySelector("figcaption")?.textContent);
    const label = alt || aria || title || caption;
    if (!label) continue;
    const extras = [title && title !== label ? title : "", caption && caption !== label ? `Caption: ${caption}` : ""]
      .filter(Boolean)
      .join(". ");
    const heading = nearestHeading(img, doc);
    lines.push(`- ${label}${extras ? `. ${extras}` : ""}${heading ? ` (Section: ${heading})` : ""}`);
    images.push({ src, alt: label });
  }
  if (!images.length) return null;
  const locator: ChunkLocator = { images };
  return { ord: 3000, text: `Images on this page:\n${lines.join("\n")}`, kind: "image", locator };
}

export interface ImageForDescription {
  src: string;
  /** Downscaled JPEG from the page (data: URL). */
  dataUrl: string;
}

export function planImageDescriptions(
  gate: { enabled: boolean; policyAllows: boolean },
  images: ImageForDescription[]
): ImageForDescription[] {
  if (!gate.enabled || !gate.policyAllows) return [];
  return images.slice(0, IMAGE_LIMITS.maxDescriptions);
}

export interface ImageDescriber {
  available: () => Promise<boolean>;
  describe: (img: ImageForDescription) => Promise<string>;
}

export async function runImageDescriptions(
  planned: ImageForDescription[],
  lm: ImageDescriber
): Promise<{ src: string; description: string }[]> {
  if (!planned.length) return [];
  if (!(await lm.available().catch(() => false))) return [];
  const out: { src: string; description: string }[] = [];
  for (const img of planned.slice(0, IMAGE_LIMITS.maxDescriptions)) {
    try {
      const d = clean(await lm.describe(img));
      if (d) out.push({ src: img.src, description: d });
    } catch {
      /* skip this image */
    }
  }
  return out;
}

export function appendDescriptions(text: string, descs: { src: string; description: string }[]): string {
  if (!descs.length) return text;
  return `${text}\n${descs.map((d) => `${DESCRIPTION_PREFIX}${d.description}`).join("\n")}`;
}

/** Removes on-device descriptions from text that may be sent to Gemini. */
export function stripOnDeviceDescriptions(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.startsWith(DESCRIPTION_PREFIX))
    .join("\n");
}

/**
 * Pages are re-indexed several times per visit. When the stored image chunk
 * already carries descriptions for the same image text, keep it instead of
 * asking the model again. Returns null when a new description run is needed.
 */
export function reuseDescribedText(prev: string | undefined, next: string): string | null {
  if (!prev || prev === next) return null;
  return stripOnDeviceDescriptions(prev) === next ? prev : null;
}
