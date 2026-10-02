import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveOAuthClientId, loadOAuthClients } = require("../scripts/oauth-client.cjs") as {
  resolveOAuthClientId: (target: string, clients?: { dev?: string; release?: string }) => string;
  loadOAuthClients: () => { dev: string; release: string };
};

const DEV_CLIENT = "1001602130427-c4skn7nc1rglp56h5egnchv2khlafk5v.apps.googleusercontent.com";

describe("oauth client id", () => {
  it("uses the unpacked dev client and refuses an empty release id", () => {
    const clients = loadOAuthClients();
    expect(clients.dev).toBe(DEV_CLIENT);
    expect(resolveOAuthClientId("dev")).toBe(DEV_CLIENT);
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "manifest.json"), "utf8")) as {
      oauth2: { client_id: string };
    };
    expect(manifest.oauth2.client_id).toBe(DEV_CLIENT);
    expect(() => resolveOAuthClientId("release", { dev: DEV_CLIENT, release: "" })).toThrow(
      /config\/oauth-clients\.json/
    );
    expect(resolveOAuthClientId("release", { dev: DEV_CLIENT, release: "store-client.apps.googleusercontent.com" })).toBe(
      "store-client.apps.googleusercontent.com"
    );
  });
});
