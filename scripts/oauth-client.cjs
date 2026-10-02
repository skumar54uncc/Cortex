const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const CLIENTS_PATH = join(__dirname, "..", "config", "oauth-clients.json");

function loadOAuthClients() {
  return JSON.parse(readFileSync(CLIENTS_PATH, "utf8"));
}

/**
 * Dev builds use config/oauth-clients.json "dev".
 * Store builds use "release". Put the Chrome Web Store OAuth client id there,
 * then run `npm run build:store`. The webpack copy step writes it into
 * dist/manifest.json. Do not hand-edit the manifest.
 */
function resolveOAuthClientId(target, clients = loadOAuthClients()) {
  const key = target === "release" ? "release" : "dev";
  const id = String(clients[key] ?? "").trim();
  if (!id) {
    throw new Error(
      'Release OAuth client id is empty. Put the Chrome Web Store OAuth client id in config/oauth-clients.json under "release", then run npm run build:store.'
    );
  }
  if (!id.endsWith(".apps.googleusercontent.com")) {
    throw new Error(
      `OAuth client id in config/oauth-clients.json ("${key}") must end with .apps.googleusercontent.com`
    );
  }
  return id;
}

module.exports = { resolveOAuthClientId, loadOAuthClients };
