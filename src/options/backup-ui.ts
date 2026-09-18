/**
 * Options page: Export and backup (Phase 5.10). The service worker builds the
 * files and runs the restore; this module only moves text and bytes and
 * drives the two-step confirm. All copy is set with textContent.
 */

type Counts = Record<"documents" | "chunks" | "conversations" | "highlights" | "collections" | "people", number>;

export interface BackupUiDeps {
  send: (msg: Record<string, unknown>) => Promise<unknown>;
  download: (blob: Blob, filename: string) => void;
  onRestored: () => void;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summaryText(c: Counts, exportedAt: number): string {
  const when = new Date(exportedAt).toISOString().slice(0, 10);
  return (
    `Backup from ${when}: ${plural(c.documents, "page")}, ${plural(c.chunks, "passage")}, ` +
    `${plural(c.conversations, "chat")}, ${plural(c.highlights, "highlight")}, ` +
    `${plural(c.collections, "collection")}, ${plural(c.people, "person", "people")}.`
  );
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function initBackupUi(doc: Document, deps: BackupUiDeps): void {
  const $ = <T extends HTMLElement>(sel: string) => doc.querySelector<T>(sel)!;
  const mdBtn = $<HTMLButtonElement>("#cx-export-md");
  const jsonBtn = $<HTMLButtonElement>("#cx-export-json");
  const exportFb = $<HTMLElement>("#cx-export-feedback");
  const fileInput = $<HTMLInputElement>("#cx-restore-file");
  const confirm = $<HTMLElement>("#cx-restore-confirm");
  const summary = $<HTMLElement>("#cx-restore-summary");
  const restoreBtn = $<HTMLButtonElement>("#cx-restore-btn");
  const cancelBtn = $<HTMLButtonElement>("#cx-restore-cancel");
  const restoreFb = $<HTMLElement>("#cx-restore-feedback");
  let pendingText: string | null = null;

  const feedback = (el: HTMLElement, text: string, error = false) => {
    el.textContent = text;
    el.classList.toggle("is-error", error);
    el.hidden = false;
  };
  const mode = (): "merge" | "replace" =>
    doc.querySelector<HTMLInputElement>('input[name="cx-restore-mode"]:checked')?.value === "replace" ? "replace" : "merge";
  const syncMode = () => {
    const replace = mode() === "replace";
    confirm.classList.toggle("is-destructive", replace);
    restoreBtn.textContent = replace ? "Replace my library" : "Restore";
    restoreBtn.className = `cx-btn ${replace ? "cx-btn-danger" : "cx-btn-primary"}`;
  };
  const closeConfirm = () => {
    confirm.hidden = true;
    pendingText = null;
    fileInput.value = "";
  };

  async function runExport(format: "markdown" | "json"): Promise<void> {
    mdBtn.disabled = jsonBtn.disabled = true;
    feedback(exportFb, format === "markdown" ? "Preparing your notes..." : "Preparing your backup...");
    try {
      const res = (await deps.send({ type: "CORTEX_EXPORT", format })) as
        | { ok?: boolean; filename?: string; mime?: string; base64?: string; text?: string; error?: string }
        | undefined;
      if (!res?.ok || !res.filename) {
        feedback(exportFb, res?.error ?? "Could not export. Try again.", true);
        return;
      }
      const blob =
        res.base64 != null
          ? new Blob([base64ToBytes(res.base64)], { type: res.mime ?? "application/zip" })
          : new Blob([res.text ?? ""], { type: res.mime ?? "application/json" });
      deps.download(blob, res.filename);
      feedback(exportFb, `Saved ${res.filename}.`);
    } catch {
      feedback(exportFb, "Could not export. Try again.", true);
    } finally {
      mdBtn.disabled = jsonBtn.disabled = false;
    }
  }

  mdBtn.addEventListener("click", () => void runExport("markdown"));
  jsonBtn.addEventListener("click", () => void runExport("json"));

  fileInput.addEventListener("change", () => {
    void (async () => {
      restoreFb.hidden = true;
      confirm.hidden = true;
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      const res = (await deps.send({ type: "CORTEX_BACKUP_VALIDATE", text })) as
        | { ok?: boolean; counts?: Counts; exportedAt?: number; error?: string }
        | undefined;
      if (!res?.ok || !res.counts) {
        feedback(restoreFb, res?.error ?? "This file could not be read as a Cortex backup.", true);
        fileInput.value = "";
        return;
      }
      pendingText = text;
      summary.textContent = summaryText(res.counts, res.exportedAt ?? Date.now());
      syncMode();
      confirm.hidden = false;
      summary.focus();
    })();
  });

  confirm.addEventListener("change", syncMode);

  cancelBtn.addEventListener("click", () => {
    closeConfirm();
    fileInput.focus();
  });

  restoreBtn.addEventListener("click", () => {
    if (pendingText == null) return;
    const text = pendingText;
    void (async () => {
      restoreBtn.disabled = cancelBtn.disabled = true;
      feedback(restoreFb, "Restoring...");
      try {
        const res = (await deps.send({ type: "CORTEX_BACKUP_RESTORE", text, mode: mode(), confirmed: true })) as
          | { ok?: boolean; added?: { documents: number }; blocked?: number; error?: string }
          | undefined;
        if (!res?.ok) {
          feedback(restoreFb, res?.error ?? "Could not restore. Try again.", true);
          return;
        }
        const blocked = res.blocked ?? 0;
        const left = blocked
          ? ` ${plural(blocked, "page")} ${blocked === 1 ? "was" : "were"} left out by your privacy settings.`
          : "";
        closeConfirm();
        feedback(restoreFb, `Restored ${plural(res.added?.documents ?? 0, "page")}.${left} Cortex is re-indexing in the background.`);
        deps.onRestored();
      } catch {
        feedback(restoreFb, "Could not restore. Try again.", true);
      } finally {
        restoreBtn.disabled = cancelBtn.disabled = false;
      }
    })();
  });
}

/** Saves a Blob through a temporary link: no downloads permission needed. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
