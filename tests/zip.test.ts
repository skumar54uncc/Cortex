import { describe, it, expect } from "vitest";
import { inflateRawSync } from "node:zlib";
import { createZip, crc32, safeZipPath } from "../src/lib/export/zip";

/** Minimal reader: end of central directory, central entries, local headers, CRC check. */
function readZip(buf: Uint8Array): Map<string, string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("no EOCD");
  const count = v.getUint16(eocd + 10, true);
  let cd = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(cd, true)).toBe(0x02014b50);
    const method = v.getUint16(cd + 10, true);
    const crc = v.getUint32(cd + 16, true);
    const size = v.getUint32(cd + 20, true);
    const nameLen = v.getUint16(cd + 28, true);
    const extraLen = v.getUint16(cd + 30, true);
    const commentLen = v.getUint16(cd + 32, true);
    const local = v.getUint32(cd + 42, true);
    const name = new TextDecoder().decode(buf.subarray(cd + 46, cd + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const lName = v.getUint16(local + 26, true);
    const lExtra = v.getUint16(local + 28, true);
    const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    const raw = method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
    expect(method).toBe(0);
    expect(crc32(raw)).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("createZip (store only)", () => {
  it("round-trips UTF-8 names and contents with valid CRCs", () => {
    const zip = createZip([
      { path: "index.md", data: "# Cortex\n" },
      { path: "notes/café-été.md", data: "Glacier notes: 4 nT/h, ümlaut" },
      { path: "empty.md", data: "" },
    ]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["index.md", "notes/café-été.md", "empty.md"]);
    expect(files.get("notes/café-été.md")).toBe("Glacier notes: 4 nT/h, ümlaut");
    expect(files.get("empty.md")).toBe("");
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("refuses unsafe paths", () => {
    expect(() => createZip([{ path: "../evil.md", data: "x" }])).toThrow();
    expect(() => createZip([{ path: "/abs.md", data: "x" }])).toThrow();
    expect(() => createZip([{ path: "a\\b.md", data: "x" }])).toThrow();
    expect(() => createZip([{ path: "same.md", data: "1" }, { path: "same.md", data: "2" }])).toThrow();
  });

  it("safeZipPath turns titles into portable file names", () => {
    expect(safeZipPath('Aurora: notes / "day 3"?')).toBe("Aurora notes day 3");
    expect(safeZipPath("..")).toBe("untitled");
    expect(safeZipPath("CON")).toBe("CON_");
    expect(safeZipPath("x".repeat(300)).length).toBeLessThanOrEqual(80);
  });
});
