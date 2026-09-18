/**
 * Tiny hand-written PDF writer for tests (Phase 5.9): one Helvetica text
 * block per page, correct xref offsets, optional document title.
 */
function esc(s: string): string {
  return s.replace(/[\()]/g, (c) => `\${c}`);
}

export function makePdf(pages: string[][], title?: string): Uint8Array<ArrayBuffer> {
  const objs: string[] = [];
  const n = pages.length;
  // 1 catalog, 2 pages, 3 font, 4 info, then per page: page obj, content obj.
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = title ? `<< /Title (${esc(title)}) >>` : "<< >>";
  pages.forEach((lines, i) => {
    const pageId = 5 + i * 2;
    const contentId = pageId + 1;
    const body = lines.map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 18} Td (${esc(l)}) Tj ET`).join("\n");
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
