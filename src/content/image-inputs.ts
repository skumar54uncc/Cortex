/**
 * Pixels for optional on-device image descriptions (Phase 5.8). Only runs
 * when the service worker says descriptions are on (user setting and policy).
 * Uses images the page already loaded: nothing is fetched. Cross-origin
 * images without CORS taint the canvas and are skipped.
 */
import { IMAGE_LIMITS, type ImageForDescription } from "../lib/capture/images";

const MAX_EDGE = 512;

function toDataUrl(img: HTMLImageElement): string | null {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null; // tainted canvas (cross-origin without CORS)
  }
}

export function collectImageInputs(doc: Document, srcs: readonly string[]): ImageForDescription[] {
  const wanted = new Set(srcs);
  const out: ImageForDescription[] = [];
  for (const img of doc.querySelectorAll("img")) {
    if (out.length >= IMAGE_LIMITS.maxDescriptions) break;
    if (!wanted.has(img.currentSrc) && !wanted.has(img.src)) continue;
    const src = wanted.has(img.src) ? img.src : img.currentSrc;
    wanted.delete(src);
    const dataUrl = toDataUrl(img);
    if (dataUrl) out.push({ src, dataUrl });
  }
  return out;
}
