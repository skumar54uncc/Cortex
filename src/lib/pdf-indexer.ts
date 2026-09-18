/**
 * PDF tab indexing (Phase 5.9): the order of checks that must pass before a
 * PDF is fetched. Feature toggle, http(s) .pdf URL, the full privacy gate
 * (managed policy, pause, incognito, always-skip, allowlist, blocklist,
 * sensitive hosts), not already indexed, one run per URL. Only then does the
 * offscreen document fetch the same URL the tab shows.
 */
import { isPdfUrl, pagesToChunks, type PdfPage } from "./capture/pdf";
import { redactPII } from "./pii-filter";
import type { NewChunk } from "../db/schema";

export type PdfExtractResult = { ok: true; title: string; pages: PdfPage[] } | { ok: false; reason: string };

export interface PdfIndexDeps {
  pdfEnabled: () => Promise<boolean>;
  gate: (url: string, incognito: boolean) => Promise<{ skip: boolean; reason?: string }>;
  alreadyIndexed: (url: string) => Promise<boolean>;
  extract: (url: string) => Promise<PdfExtractResult>;
  commit: (
    payload: { url: string; title: string; text: string; summary: string; visitedAt: number },
    chunks: NewChunk[]
  ) => Promise<unknown>;
}

export type PdfIndexResult = { indexed: true; chunks: number } | { indexed: false; reason: string };

const inFlight = new Set<string>();

function withoutHash(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

function fileName(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last) || "PDF";
  } catch {
    return last || "PDF";
  }
}

export async function indexPdfTab(tab: { url: string; incognito: boolean }, deps: PdfIndexDeps): Promise<PdfIndexResult> {
  if (!(await deps.pdfEnabled())) return { indexed: false, reason: "disabled" };
  if (!isPdfUrl(tab.url)) return { indexed: false, reason: "not_pdf" };
  const url = withoutHash(tab.url);
  const gate = await deps.gate(url, tab.incognito);
  if (gate.skip) return { indexed: false, reason: gate.reason ?? "gate" };
  if (inFlight.has(url)) return { indexed: false, reason: "in_flight" };
  inFlight.add(url);
  try {
    if (await deps.alreadyIndexed(url)) return { indexed: false, reason: "already_indexed" };
    const res = await deps.extract(url);
    if (!res.ok) return { indexed: false, reason: res.reason };
    const pages = res.pages.map((p) => ({ page: p.page, text: redactPII(p.text).redacted }));
    const chunks = pagesToChunks(pages);
    if (!chunks.length) return { indexed: false, reason: "no_text" };
    const title = redactPII(res.title).redacted || fileName(url);
    const summary = (pages.find((p) => p.text.trim())?.text ?? "").slice(0, 300);
    await deps.commit({ url, title, text: "", summary, visitedAt: Date.now() }, chunks);
    return { indexed: true, chunks: chunks.length };
  } finally {
    inFlight.delete(url);
  }
}
