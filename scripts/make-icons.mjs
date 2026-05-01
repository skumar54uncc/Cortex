import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const dir = path.join(__dirname, "..", "icons");
fs.mkdirSync(dir, { recursive: true });
for (const n of ["icon-16.png", "icon-48.png", "icon-128.png"]) {
  fs.writeFileSync(path.join(dir, n), png);
}
console.log("icons ok");
