import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WarEntry {
  resources: string[];
  matches?: string[];
  use_dynamic_url?: boolean;
}
interface Manifest {
  manifest_version: number;
  name: string;
  description: string;
  version: string;
  permissions: string[];
  web_accessible_resources: WarEntry[];
  content_scripts: { js: string[]; matches: string[] }[];
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "manifest.json"), "utf8")
) as Manifest;

describe("manifest.json", () => {
  it("is MV3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("does not expose model weights or the WASM runtime to web pages", () => {
    const all = manifest.web_accessible_resources.flatMap((e) => e.resources);
    for (const r of all) {
      expect(r).not.toMatch(/^models\//);
      expect(r).not.toMatch(/^wasm\//);
      expect(r).not.toMatch(/\*\*/);
    }
  });

  it("only exposes what the injected overlay loads, with a dynamic URL", () => {
    expect(manifest.web_accessible_resources).toHaveLength(1);
    const [entry] = manifest.web_accessible_resources;
    expect(entry.use_dynamic_url).toBe(true);
    expect([...entry.resources].sort()).toEqual(["fonts/*.woff2", "icons/icon-48.png"]);
    expect(entry.matches).toEqual(["http://*/*", "https://*/*"]);
  });

  it("keeps the always-on content script to content.js only", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].js).toEqual(["content.js"]);
  });
});
