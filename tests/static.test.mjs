import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root } from "./helpers.mjs";

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    out.push({ p, e });
    if (e.isDirectory()) walk(p, out);
  }
  return out;
}

test("manifest: required fields and a legal id", () => {
  for (const k of ["schemaVersion", "id", "name", "version", "kinds", "entryPoints"]) {
    assert.ok(manifest[k] !== undefined, k);
  }
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.id, /^io\.github\.[a-z0-9-]+\.[a-z0-9-]+$/);
  assert.ok(!manifest.id.startsWith("omarchy."), "omarchy.* is reserved");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.kinds, ["bar-widget"]);
  assert.equal(manifest.license, "MIT");
  assert.ok(!("omarchy" in manifest), "clone-only key must not ship");
});

test("manifest: entry points exist and are safe relative paths", () => {
  for (const f of Object.values(manifest.entryPoints)) {
    assert.ok(!path.isAbsolute(f) && !f.includes(".."), f);
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test("moduleName matches the manifest id in both QML files", () => {
  for (const f of ["BarWidget.qml", "Panel.qml"]) {
    assert.ok(read(f).includes(`moduleName: "${manifest.id}"`), f);
  }
});

test("repository layout: exactly one manifest.json, no symlinks, README and LICENSE present", () => {
  const all = walk(root);
  const manifests = all.filter((x) => x.e.name === "manifest.json");
  assert.equal(manifests.length, 1);
  assert.equal(path.relative(root, manifests[0].p), "manifest.json");
  const links = all.filter((x) => x.e.isSymbolicLink()).map((x) => x.p);
  assert.deepEqual(links, []);
  for (const f of ["README.md", "LICENSE"]) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test("QML never uses network, eval, URL opening or the shell runner", () => {
  const banned = [/XMLHttpRequest/, /\bfetch\(/, /\beval\(/, /new Function/, /openUrlExternally/, /bar\.run\(/, /\bWebSocket\b/, /Qt\.createQmlObject/];
  for (const f of ["BarWidget.qml", "Panel.qml", "Logic.js"]) {
    const src = read(f);
    for (const re of banned) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
});

test("every Process command in Panel.qml is an argument array, never a built string", () => {
  const src = read("Panel.qml");
  // `sh -c` is allowed only with constants from Logic.js
  for (const m of src.matchAll(/\["sh",\s*"-c",\s*([^,\]]+)/g)) {
    assert.match(m[1].trim(), /^Logic\.(PROBE_USB|PROBE_RGB|SAVE_SCRIPT)$/, m[0]);
  }
  assert.ok(!/command:\s*"/.test(src), "string commands are not allowed");
  const rest = src.replace(/applyProc\.command = job\b/, "");
  assert.ok(!/\.command\s*=\s*[^\s\[]/.test(rest), "commands must be array literals");
});

test("the only process the panel launches with computed arguments is timeout openrgb", () => {
  const L = fs.readFileSync(path.join(root, "Logic.js"), "utf8");
  assert.ok(/\["timeout", String\(t\), "openrgb"/.test(L));
});
