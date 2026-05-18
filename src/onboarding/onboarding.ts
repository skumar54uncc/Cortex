/// <reference types="chrome"/>
import { ONBOARDING_DONE_KEY } from "../shared/onboarding-constants";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import { storageLocalSet } from "../shared/storage-local";

injectBrandFontFacesInto(document.head);

document.getElementById("cx-onb-done")?.addEventListener("click", () => {
  void storageLocalSet({ [ONBOARDING_DONE_KEY]: true }).then(() => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
});
