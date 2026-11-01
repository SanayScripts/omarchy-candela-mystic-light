import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fakeCli = path.join(root, "tests", "bin", "fake-rgb-cli");

// The plugin runs a command called `openrgb`, so the tests put a link with that name on PATH.
// The link lives in a temp folder, never in the repository.
import os from "node:os";
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "candela-fakebin-"));
fs.symlinkSync(fakeCli, path.join(fakeBin, "openrgb"));

// Logic.js is a Qt ".pragma library" file. Strip that line and evaluate the rest in this realm,
// exposing every top-level function and var.
export function loadLogic() {
  const src = fs.readFileSync(path.join(root, "Logic.js"), "utf8").replace(/^\.pragma library\s*$/m, "");
  const names = new Set();
  for (const m of src.matchAll(/^(?:function\s+(\w+)|var\s+(\w+)\s*=)/gm)) names.add(m[1] || m[2]);
  return new Function(src + "\n;return {" + [...names].join(",") + "};")();
}

export function pathWithFake() {
  return fakeBin + path.delimiter + process.env.PATH;
}
