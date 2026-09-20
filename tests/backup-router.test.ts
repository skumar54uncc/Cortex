import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  BACKUP_MAX_CHARS,
  BACKUP_TOO_LARGE,
  BACKUP_WORK_MESSAGE,
  backupWorkMessage,
  forwardBackupRequest,
  isBackupRequestType,
  type BackupForwarderDeps,
  type BackupRequestType,
} from "../src/lib/export/backup-router";

/**
 * Phase 6.7: the export/backup work moved to the offscreen document and the
 * service worker keeps only this forwarder. These tests pin the two things the
 * move must not change — that authorization happens in the service worker, and
 * that it happens before anything is forwarded.
 */

function deps(over: Partial<BackupForwarderDeps> = {}) {
  const forward = vi.fn(async () => ({ ok: true }));
  const afterRestore = vi.fn(async () => undefined);
  const rateLimit = vi.fn(() => true);
  const isOptionsPage = vi.fn(() => true);
  const newToken = vi.fn((op: BackupRequestType) => (op === "CORTEX_BACKUP_RESTORE" ? "ticket-1" : ""));
  const onError = vi.fn();
  const full: BackupForwarderDeps = {
    isOptionsPage,
    foreignSender: () => ({ ok: false, error: "foreign_sender" }),
    rateLimit,
    newToken,
    forward,
    afterRestore,
    onError,
    ...over,
  };
  // Read the spies back off `full` so an override is what the assertions see.
  return {
    full,
    forward: full.forward as typeof forward,
    afterRestore: full.afterRestore as typeof afterRestore,
    rateLimit: full.rateLimit as typeof rateLimit,
    newToken: full.newToken as typeof newToken,
    onError: full.onError as typeof onError,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("backup message routing", () => {
  it("recognises exactly the three options-page messages", () => {
    expect(isBackupRequestType("CORTEX_EXPORT")).toBe(true);
    expect(isBackupRequestType("CORTEX_BACKUP_VALIDATE")).toBe(true);
    expect(isBackupRequestType("CORTEX_BACKUP_RESTORE")).toBe(true);
    expect(isBackupRequestType("CORTEX_BACKUP_WORK")).toBe(false);
    expect(isBackupRequestType("CORTEX_SEARCH_RUN")).toBe(false);
    expect(isBackupRequestType(undefined)).toBe(false);
  });

  it("refuses a sender that is not the options page BEFORE anything is forwarded", async () => {
    const { full, forward, newToken, rateLimit } = deps({ isOptionsPage: () => false });
    const sendResponse = vi.fn();
    for (const op of ["CORTEX_EXPORT", "CORTEX_BACKUP_VALIDATE", "CORTEX_BACKUP_RESTORE"] as const) {
      sendResponse.mockClear();
      expect(forwardBackupRequest(op, { text: "{}", confirmed: true }, sendResponse, full)).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "foreign_sender" });
    }
    await flush();
    // Nothing reached the offscreen document, and no gate ticket was minted.
    expect(forward).not.toHaveBeenCalled();
    expect(newToken).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("refuses over the rate limit before anything is forwarded", async () => {
    const { full, forward } = deps({
      rateLimit: (respond) => {
        respond({ ok: false, error: "rate_limited" });
        return false;
      },
    });
    const sendResponse = vi.fn();
    forwardBackupRequest("CORTEX_EXPORT", {}, sendResponse, full);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "rate_limited" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps the 60 MB guard in the service worker, before the payload crosses again", async () => {
    const { full, forward } = deps();
    const sendResponse = vi.fn();
    const text = "a".repeat(BACKUP_MAX_CHARS + 1);
    forwardBackupRequest("CORTEX_BACKUP_RESTORE", { text, confirmed: true }, sendResponse, full);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: BACKUP_TOO_LARGE });
    expect(forward).not.toHaveBeenCalled();
  });

  it("forwards an authorized export and answers with what the offscreen document returned", async () => {
    const reply = { ok: true, filename: "cortex-notes-2026-09-01.zip", mime: "application/zip", base64: "UEs=" };
    const { full, forward, afterRestore } = deps({ forward: vi.fn(async () => reply) });
    const sendResponse = vi.fn();
    forwardBackupRequest("CORTEX_EXPORT", { format: "markdown" }, sendResponse, full);
    await flush();
    expect(forward).toHaveBeenCalledWith({
      type: BACKUP_WORK_MESSAGE,
      op: "CORTEX_EXPORT",
      token: "",
      format: "markdown",
    });
    expect(sendResponse).toHaveBeenCalledWith(reply);
    expect(afterRestore).not.toHaveBeenCalled();
  });

  it("mints a gate ticket only for a restore", () => {
    const { full, newToken } = deps();
    forwardBackupRequest("CORTEX_BACKUP_VALIDATE", { text: "{}" }, vi.fn(), full);
    expect(newToken).toHaveBeenLastCalledWith("CORTEX_BACKUP_VALIDATE");
    expect(newToken.mock.results[0]!.value).toBe("");
    forwardBackupRequest("CORTEX_BACKUP_RESTORE", { text: "{}", confirmed: true }, vi.fn(), full);
    expect(newToken.mock.results[1]!.value).toBe("ticket-1");
  });

  it("finishes a successful restore in the service worker and passes the counts through", async () => {
    const reply = { ok: true, added: { documents: 2 }, blocked: 3 };
    const { full, afterRestore } = deps({ forward: vi.fn(async () => reply) });
    const sendResponse = vi.fn();
    forwardBackupRequest("CORTEX_BACKUP_RESTORE", { text: "{}", mode: "merge", confirmed: true }, sendResponse, full);
    await flush();
    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(reply);
  });

  it("does not run retention or the embedding drain when the restore was refused", async () => {
    const reply = { ok: false, error: "Your administrator has turned off indexing, so backups cannot be restored." };
    const { full, afterRestore } = deps({ forward: vi.fn(async () => reply) });
    const sendResponse = vi.fn();
    forwardBackupRequest("CORTEX_BACKUP_RESTORE", { text: "{}", confirmed: true }, sendResponse, full);
    await flush();
    expect(afterRestore).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(reply);
  });

  it("reports a plain failure when the offscreen document cannot be reached", async () => {
    const { full } = deps({ forward: vi.fn(async () => undefined) });
    const sendResponse = vi.fn();
    forwardBackupRequest("CORTEX_EXPORT", {}, sendResponse, full);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "Could not finish. Try again." });
  });

  it("only carries fields of the expected type across the boundary", () => {
    const m = backupWorkMessage(
      "CORTEX_BACKUP_RESTORE",
      { text: "{}", mode: "replace", confirmed: "yes", format: 7 },
      "t"
    );
    expect(m).toEqual({ type: BACKUP_WORK_MESSAGE, op: "CORTEX_BACKUP_RESTORE", token: "t", text: "{}", mode: "replace" });
  });

  it("stays free of the backup libraries, so the service worker bundle is too", () => {
    const src = readFileSync(join(__dirname, "..", "src", "lib", "export", "backup-router.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import .*from "\.\/(backup|markdown-vault|zip)"/m);
    expect(src).not.toMatch(/^\s*import .*from "\.\.\//m);
  });
});
