/**
 * Options page lockout for enterprise policy (Phase 4.1). Disables every
 * field the policy controls, shows the effective (managed) value, and adds a
 * "Managed by your organization" note next to it. DOM APIs only; page-derived
 * text never goes through innerHTML.
 */
import type { EffectiveSettings } from "../shared/managed-policy";
import type { CortexUserSettings } from "../shared/extension-settings";

export const MANAGED_LABEL = "Managed by your organization";

function noteAfter(doc: Document, anchor: Element | null, key: string): void {
  if (!anchor) return;
  if (doc.querySelector(`[data-managed-note="${key}"]`)) return;
  const note = doc.createElement("span");
  note.className = "cx-managed-note";
  note.setAttribute("data-managed-note", key);
  note.textContent = MANAGED_LABEL;
  anchor.insertAdjacentElement("afterend", note);
}

export function applyManagedLockout(doc: Document, eff: EffectiveSettings): void {
  const locked = new Set(eff.locked);
  const banner = doc.getElementById("cx-managed-banner");
  if (banner) banner.hidden = !eff.isManaged || locked.size === 0;

  if (locked.has("cloudChatEnabled")) {
    const cloud = doc.getElementById("cx-opt-cloud-chat") as HTMLInputElement | null;
    if (cloud) {
      cloud.checked = eff.cloudChatEnabled;
      cloud.disabled = true;
      noteAfter(doc, cloud.closest("label") ?? cloud, "cloudChatEnabled");
    }
  }
  if (locked.has("geminiApiKey")) {
    const key = doc.getElementById("cx-opt-gemini-key") as HTMLInputElement | null;
    if (key) {
      key.value = "";
      key.disabled = true;
      key.placeholder = "Cloud chat is disabled by your organization";
    }
  }
  if (locked.has("chatMode")) {
    const cloudOnly = doc.querySelector<HTMLInputElement>(
      'input[name="cx-chat-mode"][value="cloud-only"]'
    );
    if (cloudOnly) {
      cloudOnly.disabled = true;
      cloudOnly.closest("label")?.classList.add("is-disabled");
      noteAfter(doc, cloudOnly.closest(".cx-radio-card-inner")?.querySelector(".cx-radio-card-desc") ?? null, "chatMode");
    }
    doc.querySelectorAll<HTMLInputElement>('input[name="cx-chat-mode"]').forEach((r) => {
      r.checked = r.value === eff.chatMode;
    });
  }

  if (locked.has("indexingPaused")) {
    const toggle = doc.getElementById("cx-opt-pause-toggle") as HTMLButtonElement | null;
    const box = doc.getElementById("cx-opt-pause") as HTMLInputElement | null;
    if (toggle) {
      toggle.disabled = true;
      toggle.setAttribute("aria-checked", String(eff.indexingPaused));
      toggle.setAttribute("aria-disabled", "true");
      toggle.classList.toggle("is-on", eff.indexingPaused);
      noteAfter(doc, toggle.parentElement?.querySelector(".cx-field-hint") ?? toggle, "indexingPaused");
    }
    if (box) {
      box.checked = eff.indexingPaused;
      box.disabled = true;
    }
  }

  if (locked.has("retentionDays")) {
    const sel = doc.getElementById("cx-opt-retention") as HTMLSelectElement | null;
    if (sel) {
      const v = String(eff.retentionDays);
      if (![...sel.options].some((o) => o.value === v)) {
        const opt = doc.createElement("option");
        opt.value = v;
        opt.textContent = `${v} days`;
        sel.appendChild(opt);
      }
      sel.value = v;
      sel.disabled = true;
      noteAfter(doc, sel, "retentionDays");
    }
  }

  const managedRow = doc.getElementById("cx-opt-managed-blocklist");
  if (managedRow) {
    managedRow.replaceChildren();
    managedRow.hidden = eff.managedBlocklist.length === 0;
    for (const d of eff.managedBlocklist) {
      const chip = doc.createElement("span");
      chip.className = "cx-chip cx-chip--managed";
      chip.title = MANAGED_LABEL;
      chip.textContent = d;
      managedRow.appendChild(chip);
    }
    if (eff.managedBlocklist.length) noteAfter(doc, managedRow, "blocklist");
  }
}

/**
 * Removes policy-controlled fields from a settings save so the organization's
 * values are never written into the user's own stored settings (removing the
 * policy later restores what the user had chosen).
 */
export function stripLockedFields(
  partial: Partial<CortexUserSettings>,
  eff: EffectiveSettings,
  user: CortexUserSettings
): Partial<CortexUserSettings> {
  const locked = new Set(eff.locked);
  const out: Partial<CortexUserSettings> = { ...partial };
  for (const f of ["cloudChatEnabled", "geminiApiKey", "indexingPaused", "retentionDays", "allowlistOnly", "allowlist", "imageDescriptionsEnabled"] as const) {
    if (locked.has(f)) delete out[f];
  }
  if (locked.has("chatMode") && out.chatMode !== undefined) {
    // The form shows the forced fallback (cloud-only -> on-device-only); only a
    // choice that differs from that fallback is the user's own.
    if (user.chatMode === "cloud-only" && out.chatMode === eff.chatMode) delete out.chatMode;
    if (out.chatMode === "cloud-only") delete out.chatMode;
  }
  if (out.blocklist && eff.managedBlocklist.length) {
    const managed = new Set(eff.managedBlocklist);
    out.blocklist = out.blocklist.filter((d) => !managed.has(d.trim().toLowerCase()));
  }
  return out;
}
