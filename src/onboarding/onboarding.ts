/// <reference types="chrome"/>
import {
  INDEXING_CONSENT_KEY,
  ONBOARDING_DONE_KEY,
} from "../shared/onboarding-constants";
import { injectBrandFontFacesInto } from "../styles/brand-fonts";
import { storageLocalGet, storageLocalSet } from "../shared/storage-local";

injectBrandFontFacesInto(document.head);

function setStatus(text: string, isError = false): void {
  const el = document.getElementById("cx-onb-consent-status");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle("is-error", isError);
}

async function markOnboardingDone(): Promise<void> {
  await storageLocalSet({ [ONBOARDING_DONE_KEY]: true });
}

async function openSettingsAndClose(): Promise<void> {
  await markOnboardingDone();
  void chrome.runtime.openOptionsPage();
  window.close();
}

async function grantConsentAndStart(): Promise<void> {
  const startBtn = document.getElementById(
    "cx-onb-consent-start"
  ) as HTMLButtonElement | null;
  const skipBtn = document.getElementById(
    "cx-onb-consent-skip"
  ) as HTMLButtonElement | null;
  if (startBtn) startBtn.disabled = true;
  if (skipBtn) skipBtn.disabled = true;
  setStatus("Starting indexing…");

  try {
    const res = (await chrome.runtime.sendMessage({
      type: "CORTEX_INDEXING_CONSENT_GRANT",
      runFirstInstallBackfill: true,
    })) as { ok?: boolean; error?: string } | undefined;

    if (!res?.ok) {
      setStatus(
        res?.error?.trim()
          ? res.error
          : "Could not start indexing. Try again from Settings.",
        true
      );
      if (startBtn) startBtn.disabled = false;
      if (skipBtn) skipBtn.disabled = false;
      return;
    }

    setStatus(
      "Indexing is on. Cortex is scanning recent history on this device when needed."
    );
    await openSettingsAndClose();
  } catch {
    setStatus("Could not start indexing. Try again from Settings.", true);
    if (startBtn) startBtn.disabled = false;
    if (skipBtn) skipBtn.disabled = false;
  }
}

async function continueWithoutIndexing(): Promise<void> {
  setStatus(
    "Indexing stays off until you press Start indexing here, or Scan history / Allow indexing in Settings."
  );
  const doneWrap = document.getElementById("cx-onb-done-wrap");
  if (doneWrap) doneWrap.hidden = false;
  await markOnboardingDone();
}

async function refreshConsentUi(): Promise<void> {
  try {
    const r = await storageLocalGet([INDEXING_CONSENT_KEY]);
    if (r[INDEXING_CONSENT_KEY]) {
      const card = document.getElementById("cx-onb-consent");
      if (card) {
        const actions = card.querySelector(".cx-onb-consent-actions");
        if (actions) (actions as HTMLElement).hidden = true;
      }
      setStatus("Indexing is already allowed on this profile.");
      const doneWrap = document.getElementById("cx-onb-done-wrap");
      if (doneWrap) doneWrap.hidden = false;
    }
  } catch {
    /* ignore */
  }
}

document.getElementById("cx-onb-consent-start")?.addEventListener("click", () => {
  void grantConsentAndStart();
});

document.getElementById("cx-onb-consent-skip")?.addEventListener("click", () => {
  void continueWithoutIndexing();
});

document.getElementById("cx-onb-done")?.addEventListener("click", () => {
  void openSettingsAndClose();
});

void refreshConsentUi();
