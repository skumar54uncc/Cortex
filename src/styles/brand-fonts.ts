/**
 * Panel typography: Inter, bundled with the extension (no CDN, no network).
 * Inter is the plain, dense UI face used across enterprise tools; it carries
 * both the interface text and the wordmark, with tighter tracking on the
 * wordmark (see overlay.shadow.css).
 *
 * Weights: 400 body, 500 labels and buttons, 600 titles, 700 wordmark.
 */
import inter400Url from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import inter500Url from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter600Url from "@fontsource/inter/files/inter-latin-600-normal.woff2";
import inter700Url from "@fontsource/inter/files/inter-latin-700-normal.woff2";

const WEIGHTS: [number, string][] = [
  [400, inter400Url as string],
  [500, inter500Url as string],
  [600, inter600Url as string],
  [700, inter700Url as string],
];

export function getBrandFontFaceCss(): string {
  return WEIGHTS.map(
    ([weight, url]) => `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-display: swap;
  font-weight: ${weight};
  src: url('${url}') format('woff2');
}`
  ).join("\n");
}

/** Popup / options / onboarding pages (document head). */
export function injectBrandFontFacesInto(target: ParentNode): void {
  if (target.querySelector?.("style[data-cortex-brand-fonts]")) return;
  const el = document.createElement("style");
  el.setAttribute("data-cortex-brand-fonts", "");
  el.textContent = getBrandFontFaceCss();
  target.insertBefore(el, target.firstChild);
}
