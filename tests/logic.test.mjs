import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLogic } from "./helpers.mjs";

const L = loadLogic();

test("normalizeHex accepts only six hex digits", () => {
  assert.equal(L.normalizeHex("#FF00aa"), "ff00aa");
  assert.equal(L.normalizeHex(" 00aaff "), "00aaff");
  for (const bad of ["", "fff", "gggggg", "ff00aa1", "#ff00a", "$(id)", "ff00aa;ls", null, undefined, 5, {}, []]) {
    assert.equal(L.normalizeHex(bad), null, JSON.stringify(bad));
  }
});

test("rgb <-> hex round trip and clamping", () => {
  assert.equal(L.rgbToHex(255, 0, 128), "ff0080");
  assert.equal(L.rgbToHex(-5, 300, 15.6), "00ff10");
  assert.deepEqual(L.hexToRgb("0a0b0c"), { r: 10, g: 11, b: 12 });
  assert.deepEqual(L.hexToRgb("nope"), L.hexToRgb(L.DEFAULT_STATE.hex));
  assert.equal(L.colorToHex({ r: 1, g: 0.5, b: 0 }), "ff8000");
});

test("buildCommand: exact argv for every mode", () => {
  const base = { hex: "ff0000", brightness: 3, speed: 2 };
  const cases = {
    Static: ["timeout", "5", "openrgb", "-d", "1", "-m", "Static", "-c", "ff0000", "-b", "60"],
    Breathing: ["timeout", "5", "openrgb", "-d", "1", "-m", "Breathing", "-c", "ff0000", "-b", "60", "--speed", "100"],
    Flashing: ["timeout", "5", "openrgb", "-d", "1", "-m", "Flashing", "-c", "ff0000", "-b", "60", "--speed", "100"],
    "Double Flashing": ["timeout", "5", "openrgb", "-d", "1", "-m", "Double Flashing", "-c", "ff0000", "-b", "60", "--speed", "100"],
    "Spectrum Cycle": ["timeout", "5", "openrgb", "-d", "1", "-m", "Spectrum Cycle", "-c", "ff0000", "-b", "60", "--speed", "100"],
    "Smooth Spectrum Cycle": ["timeout", "5", "openrgb", "-d", "1", "-m", "Smooth Spectrum Cycle", "-c", "ff0000", "-b", "60", "--speed", "100"],
    Off: ["timeout", "5", "openrgb", "-d", "1", "-m", "Off"]
  };
  for (const [mode, want] of Object.entries(cases)) {
    assert.deepEqual(L.buildCommand({ ...base, mode }, 1, 5), want, mode);
  }
});

test("buildCommand: brightness and speed steps map to percentages", () => {
  const pct = (b) => L.buildCommand({ mode: "Static", hex: "ffffff", brightness: b }, 0, 5)[10];
  assert.deepEqual([1, 2, 3, 4, 5].map(pct), ["20", "40", "60", "80", "100"]);
  const sp = (s) => L.buildCommand({ mode: "Breathing", hex: "ffffff", brightness: 5, speed: s }, 0, 5).pop();
  assert.deepEqual([0, 1, 2].map(sp), ["0", "50", "100"]);
});

test("buildCommand refuses a bad device index", () => {
  for (const bad of [-1, null, undefined, "x", NaN, 1.5, "1; id", 100, "", [], {}, true]) {
    assert.equal(L.buildCommand({}, bad, 5), null, String(bad));
  }
  assert.notEqual(L.buildCommand({}, "2", 5), null);
  assert.notEqual(L.buildCommand({}, 0, 5), null);
});

test("hostile state never reaches the command line", () => {
  const evil = {
    mode: "Static; rm -rf /",
    hex: "$(touch /tmp/pwned)",
    brightness: "9e9",
    speed: -5,
    lastOn: "`id`",
    follow: "yes"
  };
  const s = L.sanitizeState(evil);
  assert.deepEqual(s, { mode: "Static", lastOn: "Static", hex: "00aaff", brightness: 5, speed: 0, follow: false });
  const cmd = L.buildCommand(evil, 0, 999);
  assert.equal(cmd[1], "30"); // timeout is clamped too
  for (const a of cmd) assert.match(a, /^[A-Za-z0-9 .\-]+$/, a);
});

test("fuzz: random state, argv always matches the allowlist", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const chars = "abcdefABCDEF0123456789 #;$`'\"\\|&<>(){}[]*?~\n\t-.%/=:,";
  const junk = () => Array.from({ length: Math.floor(rnd() * 24) }, () => chars[Math.floor(rnd() * chars.length)]).join("");
  const modes = ["Static", "Off", "Breathing", "Double Flashing", "Smooth Spectrum Cycle"];
  const vals = () => [junk(), rnd() * 1000 - 500, null, undefined, true, [], {}, "12", NaN, Infinity][Math.floor(rnd() * 10)];
  for (let i = 0; i < 2000; i++) {
    const st = {
      mode: rnd() < 0.5 ? modes[Math.floor(rnd() * modes.length)] : junk(),
      hex: rnd() < 0.4 ? "a1b2c3" : junk(),
      brightness: vals(),
      speed: vals(),
      follow: vals()
    };
    const cmd = L.buildCommand(st, Math.floor(rnd() * 5), vals());
    if (cmd === null) continue;
    assert.ok(cmd.length >= 7 && cmd.length <= 13);
    for (const a of cmd) assert.match(a, /^[A-Za-z0-9 .\-]+$/, JSON.stringify(a));
    assert.ok(L.modeInfo(cmd[6]) !== null);
  }
});

test("parseState rejects junk and does not pollute prototypes", () => {
  for (const bad of ["", "   ", "{", "[]", "null", "5", '"x"', "x".repeat(3000), undefined, null, 5]) {
    assert.equal(L.parseState(bad), null, String(bad).slice(0, 20));
  }
  assert.deepEqual(L.parseState('{"mode":"Breathing","hex":"#AABBCC","brightness":2,"speed":0}'), {
    mode: "Breathing", lastOn: "Breathing", hex: "aabbcc", brightness: 2, speed: 0, follow: false
  });
  const p = L.parseState('{"__proto__":{"polluted":1},"mode":"Static"}');
  assert.equal({}.polluted, undefined);
  assert.equal(p.polluted, undefined);
});

test("state round trip", () => {
  const s = { mode: "Off", lastOn: "Flashing", hex: "123456", brightness: 4, speed: 2, follow: true };
  assert.deepEqual(L.parseState(L.serializeState(s)), s);
});

test("sanitizeState keeps lastOn sane when mode is Off", () => {
  assert.equal(L.sanitizeState({ mode: "Off" }).lastOn, "Static");
  assert.equal(L.sanitizeState({ mode: "Off", lastOn: "Off" }).lastOn, "Static");
  assert.equal(L.sanitizeState({ mode: "Breathing" }).lastOn, "Breathing");
});

test("parseVersion / versionOk", () => {
  const v = (t) => L.parseVersion(t);
  assert.deepEqual(v("OpenRGB 1.1, for controlling RGB lighting.\n  Version:\t\t 1.1"), { major: 1, minor: 1 });
  assert.deepEqual(v("OpenRGB 0.9 (git)"), { major: 0, minor: 9 });
  assert.deepEqual(v("  Version:\t 2.0"), { major: 2, minor: 0 });
  assert.equal(v("command not found"), null);
  assert.equal(v(null), null);
  assert.equal(L.versionOk({ major: 1, minor: 1 }), true);
  assert.equal(L.versionOk({ major: 1, minor: 0 }), false);
  assert.equal(L.versionOk({ major: 0, minor: 99 }), false);
  assert.equal(L.versionOk({ major: 2, minor: 0 }), true);
  assert.equal(L.versionOk(null), false);
});

test("parseDevices reads only unindented index lines", () => {
  const out = [
    "0: E-Signal USB Gaming Mouse",
    "  Type: Mouse",
    "  1: not a device (indented)",
    "1: MSI MysticLight MS-1563 v0001",
    "  Modes: Off Static"
  ].join("\n");
  assert.deepEqual(L.parseDevices(out), [
    { index: 0, name: "E-Signal USB Gaming Mouse" },
    { index: 1, name: "MSI MysticLight MS-1563 v0001" }
  ]);
  assert.equal(L.findDevice(L.parseDevices(out)), 1);
  assert.equal(L.findDevice(L.parseDevices("0: MSI MysticLight MS-1564 v0001")), 0);
  assert.equal(L.findDevice(L.parseDevices("0: MSI Mystic Light MS-7B94 Motherboard")), null);
  assert.equal(L.findDevice([]), null);
});

test("USB allowlist: only 1462:1562/3/4", () => {
  const ok = (t) => L.supportedUsb(L.parseUsb(t));
  assert.equal(ok("1462:1563"), true);
  assert.equal(ok("04d9:a09f\n1462:1562\n"), true);
  assert.equal(ok("1462:1564"), true);
  assert.equal(ok("1462:1601"), false); // newer multi-zone family
  assert.equal(ok("1462:7b94"), false); // motherboard controller, never touch
  assert.equal(ok("1038:113a"), false);
  assert.equal(ok("0000:1563"), false);
  assert.equal(ok(""), false);
});

test("usbModel names the detected controller", () => {
  const m = (t) => L.usbModel("@usb\n" + t + "\n@end");
  assert.equal(m("04d9:a09f\n1462:1563"), "MS-1563");
  assert.equal(m("1462:1562"), "MS-1562");
  assert.equal(m("1462:1564"), "MS-1564");
  assert.equal(m("1462:7b94"), null);
  assert.equal(m(""), null);
});

test("evaluateRgb classifies every outcome", () => {
  const sec = (v, d) => `@version\n${v}\n@devices\n${d}\n@end\n`;
  const kb = "1: MSI MysticLight MS-1563 v0001";
  assert.deepEqual(L.evaluateRgb(sec("OpenRGB 1.1, x", kb)), { kind: "ok", index: 1, version: { major: 1, minor: 1 } });
  assert.equal(L.evaluateRgb(sec("OpenRGB 0.9, x", kb)).kind, "old-openrgb");
  assert.equal(L.evaluateRgb(sec("timeout: failed to run command 'openrgb'", "")).kind, "no-openrgb");
  assert.equal(L.evaluateRgb(sec("OpenRGB 1.1, x", "0: Some Mouse")).kind, "no-device");
  assert.equal(L.evaluateRgb("").kind, "no-openrgb");
});

test("statePath ignores relative or missing environment", () => {
  assert.equal(L.statePath({ HOME: "/home/a" }), "/home/a/.local/state/candela-mystic-light/state.json");
  assert.equal(L.statePath({ HOME: "/home/a", XDG_STATE_HOME: "/x/state/" }), "/x/state/candela-mystic-light/state.json");
  assert.equal(L.statePath({ HOME: "/home/a", XDG_STATE_HOME: "relative" }), "/home/a/.local/state/candela-mystic-light/state.json");
  assert.equal(L.statePath({ HOME: "relative" }), null);
  assert.equal(L.statePath({}), null);
  assert.equal(L.statePath(null), null);
});

test("scheduler: one job at a time, newest waiting job wins", () => {
  const started = [];
  const s = L.createScheduler((j) => started.push(j));
  assert.equal(s.submit("A"), "started");
  assert.equal(s.submit("B"), "queued");
  assert.equal(s.submit("C"), "queued");
  assert.deepEqual(started, ["A"]);
  assert.equal(s.done(), "next");
  assert.deepEqual(started, ["A", "C"]);
  assert.equal(s.done(), "idle");
  assert.equal(s.isBusy(), false);
  assert.equal(s.submit("D"), "started");
});

test("scheduler recovers when start throws", () => {
  let boom = true;
  const s = L.createScheduler(() => { if (boom) throw new Error("x"); });
  assert.throws(() => s.submit("A"));
  assert.equal(s.isBusy(), false);
  boom = false;
  assert.equal(s.submit("B"), "started");
});

test("messages", () => {
  assert.match(L.message("failed", 3), /exit code 3/);
  assert.equal(L.message("failed"), "OpenRGB failed");
  assert.equal(L.message("__proto__"), "Unknown error.");
});
