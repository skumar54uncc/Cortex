/**
 * Wordmark stack prefers Garet (optional `fonts/Garet-Heavy.woff2` in the package —
 * license from Type Forward / Font Squirrel webfont kit). Bundled Plus Jakarta Sans
 * fills Latin glyphs until that file is added.
 */
import jakartaLatin400Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2";
import jakartaLatin700Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2";

export function getBrandFontFaceCss(): string {
  const jakarta400 = jakartaLatin400Url as string;
  const jakarta700 = jakartaLatin700Url as string;
  let garet = "";
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    const u = chrome.runtime.getURL("fonts/Garet-Heavy.woff2");
    garet = `
@font-face {
  font-family: 'Garet';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url('${u}') format('woff2');
}`;
  }
  return `
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url('${jakarta400}') format('woff2');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 700;
  src: url('${jakarta700}') format('woff2');
}
${garet}`;
}

/** Popup / options pages (document head). */
export function injectBrandFontFacesInto(target: ParentNode): void {
  if (target.querySelector?.("style[data-cortex-brand-fonts]")) return;
  const el = document.createElement("style");
  el.setAttribute("data-cortex-brand-fonts", "");
  el.textContent = getBrandFontFaceCss();
  target.insertBefore(el, target.firstChild);
}
