/**
 * Export / backup routing (Phase 6.7).
 *
 * The library work — collect, validate, restore, Markdown vault, zip — now
 * runs in the offscreen document, which already owns the database-heavy code
 * (search, chat, PDF reading). The service worker keeps only the forwarder in
 * this file, so its bundle no longer carries the backup libraries.
 *
 * Authorization stays in the service worker on purpose: it is the only context
 * that can see the original `sender`. Both the options-page check and the rate
 * limit run here, before anything crosses to the offscreen document. The
 * offscreen handler keeps its own sender guard as defence in depth.
 *
 * Nothing in this module may import the backup libraries: that is the whole
 * point of the split, and `tests/backup-router.test.ts` pins it.
 */

/** The three messages the options page sends (src/options/backup-ui.ts). */
export const BACKUP_REQUEST_TYPES = [
  "CORTEX_EXPORT",
  "CORTEX_BACKUP_VALIDATE",
  "CORTEX_BACKUP_RESTORE",
] as const;
export type BackupRequestType = (typeof BACKUP_REQUEST_TYPES)[number];

/** Service worker -> offscreen document: do the library work. */
export const BACKUP_WORK_MESSAGE = "CORTEX_BACKUP_WORK";
/** Offscreen document -> service worker: run the privacy gate on these URLs. */
export const BACKUP_GATE_MESSAGE = "CORTEX_BACKUP_GATE";

/**
 * A backup arrives as one JSON string. The guard is unchanged from Phase 5.10
 * and still runs in the service worker, before the payload is forwarded: the
 * move adds a hop, not a bigger message, so the per-message ceiling is the
 * same 60 MB it always was.
 */
export const BACKUP_MAX_CHARS = 60 * 1024 * 1024;

export const BACKUP_TOO_LARGE = "This file is too large to restore here (limit 60 MB).";
export const BACKUP_FAILED = "Could not finish. Try again.";

export interface BackupRequest {
  format?: unknown;
  text?: unknown;
  mode?: unknown;
  confirmed?: unknown;
}

export interface BackupWorkMessage {
  type: typeof BACKUP_WORK_MESSAGE;
  op: BackupRequestType;
  /**
   * One-time ticket for the privacy-gate callback. Non-empty only for a
   * restore the service worker has already authorized, so the gate cannot be
   * driven by anything else that happens to reach the service worker.
   */
  token: string;
  format?: string;
  text?: string;
  mode?: string;
  confirmed?: boolean;
}

export function isBackupRequestType(t: unknown): t is BackupRequestType {
  return typeof t === "string" && (BACKUP_REQUEST_TYPES as readonly string[]).includes(t);
}

export function backupWorkMessage(
  op: BackupRequestType,
  msg: BackupRequest,
  token: string
): BackupWorkMessage {
  return {
    type: BACKUP_WORK_MESSAGE,
    op,
    token,
    ...(typeof msg.format === "string" ? { format: msg.format } : {}),
    ...(typeof msg.text === "string" ? { text: msg.text } : {}),
    ...(typeof msg.mode === "string" ? { mode: msg.mode } : {}),
    ...(msg.confirmed === true ? { confirmed: true } : {}),
  };
}

export interface BackupForwarderDeps {
  /** Only the options page may export or restore (unchanged from Phase 5.10). */
  isOptionsPage: () => boolean;
  /** Body of the refusal for any other sender. */
  foreignSender: () => unknown;
  /** Returns false when the limiter already sent its own response. */
  rateLimit: (sendResponse: (r: unknown) => void) => boolean;
  /** Mints the gate ticket; empty string for anything but a restore. */
  newToken: (op: BackupRequestType) => string;
  /** Sends the work to the offscreen document; resolves undefined if unreachable. */
  forward: (message: BackupWorkMessage) => Promise<unknown>;
  /** Retention, digest cache, pending-embeddings drain, stats: service worker side. */
  afterRestore: () => Promise<void>;
  onError: (e: unknown) => void;
}

/**
 * The thin forwarder. Refuses first, forwards second: every early `return`
 * below happens before `deps.forward` can be reached.
 */
export function forwardBackupRequest(
  op: BackupRequestType,
  msg: BackupRequest,
  sendResponse: (r: unknown) => void,
  deps: BackupForwarderDeps
): true {
  if (!deps.isOptionsPage()) {
    sendResponse(deps.foreignSender());
    return true;
  }
  if (!deps.rateLimit(sendResponse)) return true;
  if (op !== "CORTEX_EXPORT") {
    const text = typeof msg.text === "string" ? msg.text : "";
    if (text.length > BACKUP_MAX_CHARS) {
      sendResponse({ ok: false, error: BACKUP_TOO_LARGE });
      return true;
    }
  }

  void (async () => {
    try {
      const res = (await deps.forward(backupWorkMessage(op, msg, deps.newToken(op)))) as
        | { ok?: unknown }
        | undefined;
      if (!res || typeof res !== "object") {
        sendResponse({ ok: false, error: BACKUP_FAILED });
        return;
      }
      // A restore that landed rows needs the service worker to finish up:
      // retention, the digest cache and the on-device embedding drain.
      if (op === "CORTEX_BACKUP_RESTORE" && res.ok === true) await deps.afterRestore();
      sendResponse(res);
    } catch (e) {
      deps.onError(e);
      sendResponse({ ok: false, error: BACKUP_FAILED });
    }
  })();
  return true;
}
