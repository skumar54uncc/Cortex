/// <reference types="chrome"/>
import { ONBOARDING_DONE_KEY } from "../shared/onboarding-constants";

document.getElementById("cx-onb-done")?.addEventListener("click", () => {
  void chrome.storage.local.set({ [ONBOARDING_DONE_KEY]: true }, () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
});
