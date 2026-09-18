/**
 * Citation cards per kind (release 1.2.0): a video source opens at its
 * moment, a PDF at its page, a table source names its rows. Built with DOM
 * APIs only; page-derived titles are set with textContent.
 */
import type { ChunkWithDoc } from "../lib/search-engine";
import { citationDetail, citationHref } from "../lib/kind-labels";
import type { ChunkKind, ChunkLocator } from "../db/schema";

function hrefFor(chunk: ChunkWithDoc): string {
  return citationHref(chunk, chunk.document.url) ?? "#";
}

export function buildSourceItem(chunk: ChunkWithDoc, index: number): HTMLAnchorElement {
  const item = document.createElement("a");
  item.className = "cortex-source-item";
  item.href = hrefFor(chunk);
  item.target = "_blank";
  item.rel = "noopener noreferrer";

  const num = document.createElement("span");
  num.className = "cortex-source-num";
  num.textContent = `[${index + 1}]`;

  const body = document.createElement("span");
  body.className = "cortex-source-body";
  const titleEl = document.createElement("span");
  titleEl.className = "cortex-source-title";
  titleEl.textContent = chunk.document.title;
  body.appendChild(titleEl);
  const detail = citationDetail(chunk);
  if (detail) {
    const d = document.createElement("span");
    d.className = "cortex-source-detail";
    d.textContent = detail;
    body.appendChild(d);
  }

  const domain = document.createElement("span");
  domain.className = "cortex-source-domain";
  domain.textContent = chunk.document.domain;

  item.append(num, body, domain);
  return item;
}

export function citationLink(chunk: ChunkWithDoc, n: number): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "cortex-citation";
  link.href = hrefFor(chunk);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = String(n);
  const detail = citationDetail(chunk);
  link.title = detail ? `${chunk.document.title}, ${detail}` : chunk.document.title;
  return link;
}

export interface StoredCitation {
  chunkId: number;
  documentId: number;
  url: string;
  title: string;
  kind?: ChunkKind;
  locator?: ChunkLocator;
}

export function citedFromChunk(c: ChunkWithDoc): StoredCitation {
  return {
    chunkId: c.id as number,
    documentId: c.documentId,
    url: c.document.url,
    title: c.document.title,
    ...(c.kind ? { kind: c.kind } : {}),
    ...(c.locator ? { locator: c.locator } : {}),
  };
}
