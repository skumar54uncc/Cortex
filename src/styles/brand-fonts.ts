/**
 * The panel uses the system UI face (Segoe UI on Windows, the system sans
 * elsewhere). That is the font Chrome itself draws with, so it stays sharp at
 * 14px without shipping a webfont. chrome.fontSettings is not used: that API
 * changes the user's browser fonts and needs an extra permission.
 */
export function getBrandFontFaceCss(): string {
  return "";
}

/** Popup / options / onboarding pages (document head). */
export function injectBrandFontFacesInto(target: ParentNode): void {
  const css = getBrandFontFaceCss();
  if (!css || target.querySelector?.("style[data-cortex-brand-fonts]")) return;
  const el = document.createElement("style");
  el.setAttribute("data-cortex-brand-fonts", "");
  el.textContent = css;
  target.insertBefore(el, target.firstChild);
}
