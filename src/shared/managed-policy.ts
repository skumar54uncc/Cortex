/**
 * Enterprise policy (Phase 4.1).
 *
 * Admins set values through Chrome's managed storage (Google Admin console,
 * GPO, or a JSON policy file). They are declared in managed_schema.json and
 * read with chrome.storage.managed, which the extension can read but never
 * write. Managed values override user settings; the fields they touch are
 * reported as `locked` so the options page can show them as "Managed by your
 * organization".
 *
 * Every enforcement point (indexing gate, chat routing, retention, image
 * descriptions) reads `getEffectiveSettings()` instead of raw user settings.
 * The user's own stored values are never overwritten, so removing a policy
 * restores what the user had chosen.
 */
import type { ChatSettings } from "../lib/chat/types";
import {
  getUserSettings,
  getUserSettingsFresh,
  type CortexUserSettings,
} from "./extension-settings";

export interface ManagedPolicy {
  geminiAllowed?: boolean;
  blockedDomains?: string[];
  allowedDomainsOnly?: string[];
  retentionDays?: number;
  indexingDisabled?: boolean;
  imageDescriptionsAllowed?: boolean;
}

export const MANAGED_POLICY_KEYS: ReadonlyArray<keyof ManagedPolicy> = [
  "geminiAllowed",
  "blockedDomains",
  "allowedDomainsOnly",
  "retentionDays",
  "indexingDisabled",
  "imageDescriptionsAllowed",
];

export type LockedField =
  | "cloudChatEnabled"
  | "geminiApiKey"
  | "chatMode"
  | "blocklist"
  | "allowlistOnly"
  | "allowlist"
  | "retentionDays"
  | "indexingPaused"
  | "imageDescriptionsEnabled";

export interface EffectiveSettings extends CortexUserSettings {
  locked: LockedField[];
  /** Domains blocked by policy (a subset of `blocklist`); shown as locked chips. */
  managedBlocklist: string[];
  isManaged: boolean;
  policy: ManagedPolicy;
}

function domainList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const d = x.trim().toLowerCase();
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

export function normalizeManagedPolicy(raw: unknown): ManagedPolicy {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const p: ManagedPolicy = {};
  if (typeof o.geminiAllowed === "boolean") p.geminiAllowed = o.geminiAllowed;
  const blocked = domainList(o.blockedDomains);
  if (blocked) p.blockedDomains = blocked;
  const allowed = domainList(o.allowedDomainsOnly);
  if (allowed) p.allowedDomainsOnly = allowed;
  if (typeof o.retentionDays === "number" && Number.isFinite(o.retentionDays) && o.retentionDays >= 1) {
    p.retentionDays = Math.floor(o.retentionDays);
  }
  if (typeof o.indexingDisabled === "boolean") p.indexingDisabled = o.indexingDisabled;
  if (typeof o.imageDescriptionsAllowed === "boolean") {
    p.imageDescriptionsAllowed = o.imageDescriptionsAllowed;
  }
  return p;
}

export function applyManagedPolicy(
  user: CortexUserSettings,
  policy: ManagedPolicy
): EffectiveSettings {
  const eff: CortexUserSettings = {
    ...user,
    blocklist: [...user.blocklist],
    allowlist: [...user.allowlist],
  };
  const locked = new Set<LockedField>();

  if (policy.geminiAllowed === false) {
    eff.cloudChatEnabled = false;
    eff.geminiApiKey = "";
    if (eff.chatMode === "cloud-only") eff.chatMode = "on-device-only";
    locked.add("cloudChatEnabled");
    locked.add("geminiApiKey");
    locked.add("chatMode");
  }

  const managedBlocklist = policy.blockedDomains ?? [];
  if (managedBlocklist.length) {
    const merged = new Set(eff.blocklist.map((d) => d.trim().toLowerCase()).filter(Boolean));
    for (const d of managedBlocklist) merged.add(d);
    eff.blocklist = [...merged];
    locked.add("blocklist");
  }

  if (policy.allowedDomainsOnly && policy.allowedDomainsOnly.length) {
    eff.allowlistOnly = true;
    eff.allowlist = [...policy.allowedDomainsOnly];
    locked.add("allowlistOnly");
    locked.add("allowlist");
  }

  if (policy.retentionDays != null) {
    eff.retentionDays = policy.retentionDays;
    locked.add("retentionDays");
  }

  if (policy.indexingDisabled === true) {
    eff.indexingPaused = true;
    locked.add("indexingPaused");
  }

  if (policy.imageDescriptionsAllowed === false) {
    eff.imageDescriptionsEnabled = false;
    locked.add("imageDescriptionsEnabled");
  }

  return {
    ...eff,
    locked: [...locked],
    managedBlocklist,
    isManaged: Object.keys(policy).length > 0,
    policy,
  };
}

function managedArea(): chrome.storage.StorageArea | null {
  try {
    const c = (globalThis as { chrome?: typeof chrome }).chrome;
    return (c?.storage as { managed?: chrome.storage.StorageArea } | undefined)?.managed ?? null;
  } catch {
    return null;
  }
}

/** Current policy; `{}` when there is none or managed storage is unavailable. */
export async function readManagedPolicy(): Promise<ManagedPolicy> {
  const area = managedArea();
  if (!area) return {};
  try {
    const raw = await new Promise<Record<string, unknown>>((resolve) => {
      try {
        area.get(null, (items) => {
          if ((globalThis as { chrome?: typeof chrome }).chrome?.runtime?.lastError) {
            resolve({});
            return;
          }
          resolve((items ?? {}) as Record<string, unknown>);
        });
      } catch {
        resolve({});
      }
    });
    return normalizeManagedPolicy(raw);
  } catch {
    return {};
  }
}

export async function getEffectiveSettings(
  opts: { fresh?: boolean } = {}
): Promise<EffectiveSettings> {
  // Lazy: keep gemini-api-key out of the SW main bundle (budget).
  const { getGeminiApiKey } = await import("./gemini-api-key");
  const [user, policy, apiKey] = await Promise.all([
    opts.fresh ? getUserSettingsFresh() : getUserSettings(),
    readManagedPolicy(),
    getGeminiApiKey(),
  ]);
  // Merge secret key only here (SW / options / stats) — never via getUserSettings.
  return applyManagedPolicy({ ...user, geminiApiKey: apiKey }, policy);
}

/** Chat routing input; always reads storage fresh, like the 1.0.x getChatSettings. */
export async function getEffectiveChatSettings(): Promise<ChatSettings> {
  const s = await getEffectiveSettings({ fresh: true });
  return {
    mode: s.chatMode,
    cloudEnabled: s.cloudChatEnabled,
    geminiApiKey: s.geminiApiKey.trim(),
    peopleEnabled: s.peopleMemoryEnabled,
  };
}
