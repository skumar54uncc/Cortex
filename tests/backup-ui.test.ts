// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initBackupUi, summaryText } from "../src/options/backup-ui";

const html = readFileSync(join(__dirname, "..", "src", "options", "options.html"), "utf8");
const counts = { documents: 120, chunks: 3400, visitLog: 500, conversations: 12, messages: 40, people: 5, collections: 2, collectionItems: 9, highlights: 9 };

function setup(send: (m: Record<string, unknown>) => Promise<unknown>) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  const download = vi.fn();
  initBackupUi(document, { send, download, onRestored: vi.fn() });
  return { download, $: <T extends HTMLElement>(s: string) => document.querySelector<T>(s)! };
}

async function chooseFile($: <T extends HTMLElement>(s: string) => T, text: string) {
  const input = $<HTMLInputElement>("#cx-restore-file");
  const file = new File([text], "cortex-backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect($("#cx-restore-confirm").hidden === false || $("#cx-restore-feedback").hidden === false).toBe(true));
}

beforeEach(() => vi.restoreAllMocks());

describe("summaryText", () => {
  it("counts in plain words without em dashes", () => {
    const t = summaryText(counts, Date.parse("2026-09-01T10:00:00Z"));
    expect(t).toBe("Backup from 2026-09-01: 120 pages, 3400 passages, 12 chats, 9 highlights, 2 collections, 5 people.");
    expect(t).not.toContain("—");
  });
});

describe("backup UI", () => {
  it("export buttons ask the service worker and save the file; buttons are disabled while working", async () => {
    let resolve!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolve = r)));
    const { download, $ } = setup(send);
    $<HTMLButtonElement>("#cx-export-json").click();
    expect($<HTMLButtonElement>("#cx-export-json").disabled).toBe(true);
    expect($<HTMLButtonElement>("#cx-export-md").disabled).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: "CORTEX_EXPORT", format: "json" });
    resolve({ ok: true, filename: "cortex-backup-2026-09-18.json", mime: "application/json", text: "{}" });
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0]!;
    expect(name).toBe("cortex-backup-2026-09-18.json");
    expect((blob as Blob).type).toBe("application/json");
    expect($<HTMLButtonElement>("#cx-export-json").disabled).toBe(false);
    expect($("#cx-export-feedback").textContent).toBe("Saved cortex-backup-2026-09-18.json.");
  });

  it("markdown export decodes the zip bytes", async () => {
    const send = vi.fn(async () => ({ ok: true, filename: "cortex-notes.zip", mime: "application/zip", base64: btoa("PK\u0003\u0004") }));
    const { download, $ } = setup(send);
    $<HTMLButtonElement>("#cx-export-md").click();
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    const blob = download.mock.calls[0]![0] as Blob;
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("application/zip");
  });

  it("choosing a file validates it and shows the confirm step with focus on the summary; nothing is restored yet", async () => {
    const send = vi.fn(async (m: Record<string, unknown>) =>
      m.type === "CORTEX_BACKUP_VALIDATE" ? { ok: true, counts, exportedAt: Date.parse("2026-09-01T10:00:00Z") } : { ok: true }
    );
    const { $ } = setup(send);
    await chooseFile($, '{"format":"cortex-backup"}');
    expect(send).toHaveBeenCalledWith({ type: "CORTEX_BACKUP_VALIDATE", text: '{"format":"cortex-backup"}' });
    expect(send.mock.calls.some(([m]) => m.type === "CORTEX_BACKUP_RESTORE")).toBe(false);
    expect($("#cx-restore-summary").textContent).toContain("120 pages");
    expect(document.activeElement).toBe($("#cx-restore-summary"));
  });

  it("invalid files show the reason and no confirm step", async () => {
    const send = vi.fn(async () => ({ ok: false, error: "This file is not a Cortex backup." }));
    const { $ } = setup(send);
    await chooseFile($, "nope");
    expect($("#cx-restore-confirm").hidden).toBe(true);
    expect($("#cx-restore-feedback").textContent).toBe("This file is not a Cortex backup.");
    expect($("#cx-restore-feedback").classList.contains("is-error")).toBe(true);
  });

  it("Replace marks the step destructive; Restore sends the confirmed mode and reports the result", async () => {
    const send = vi.fn(async (m: Record<string, unknown>) =>
      m.type === "CORTEX_BACKUP_VALIDATE"
        ? { ok: true, counts, exportedAt: 0 }
        : { ok: true, added: { ...counts, documents: 119 }, blocked: 1 }
    );
    const { $ } = setup(send);
    await chooseFile($, "{}");
    const replace = document.querySelector<HTMLInputElement>('input[name="cx-restore-mode"][value="replace"]')!;
    replace.checked = true;
    replace.dispatchEvent(new Event("change", { bubbles: true }));
    expect($("#cx-restore-confirm").classList.contains("is-destructive")).toBe(true);
    expect($("#cx-restore-btn").textContent).toBe("Replace my library");
    $<HTMLButtonElement>("#cx-restore-btn").click();
    await vi.waitFor(() => expect($("#cx-restore-feedback").hidden).toBe(false));
    expect(send).toHaveBeenCalledWith({ type: "CORTEX_BACKUP_RESTORE", text: "{}", mode: "replace", confirmed: true });
    expect($("#cx-restore-feedback").textContent).toBe(
      "Restored 119 pages. 1 page was left out by your privacy settings. Cortex is re-indexing in the background."
    );
    expect($("#cx-restore-confirm").hidden).toBe(true);
  });

  it("Cancel hides the step, clears the file and returns focus to the picker", async () => {
    const send = vi.fn(async () => ({ ok: true, counts, exportedAt: 0 }));
    const { $ } = setup(send);
    await chooseFile($, "{}");
    $<HTMLButtonElement>("#cx-restore-cancel").click();
    expect($("#cx-restore-confirm").hidden).toBe(true);
    expect(document.activeElement).toBe($("#cx-restore-file"));
  });
});
