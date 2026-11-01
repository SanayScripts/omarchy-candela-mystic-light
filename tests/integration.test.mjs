import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLogic, pathWithFake } from "./helpers.mjs";

const L = loadLogic();

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "candela-"));
}

function run(argv, env = {}, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), {
    env: { ...process.env, PATH: pathWithFake(), ...env },
    encoding: "utf8",
    timeout: 15000,
    ...opts
  });
  return { status: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t0 };
}

function probe(script, env = {}) {
  return run(["sh", "-c", script], env).out;
}

test("the fake openrgb is strict (sanity check of the harness)", () => {
  assert.notEqual(run(["openrgb", "-d", "1", "-m", "Rainbow"]).status, 0);
  assert.notEqual(run(["openrgb", "-d", "1", "-m", "Static", "-c", "zzz"]).status, 0);
  assert.notEqual(run(["openrgb", "-d", "1", "-m", "Static", "--bogus", "1"]).status, 0);
  assert.notEqual(run(["openrgb", "-d", "0", "-m", "Breathing"]).status, 0, "mouse has no Breathing");
  assert.equal(run(["openrgb", "-d", "1", "-m", "Breathing", "-c", "ff0000", "-b", "40", "--speed", "50"]).status, 0);
});

test("every command the plugin builds is accepted, and logged exactly", () => {
  const dir = tmp();
  const log = path.join(dir, "log");
  const modes = L.MODES.map((m) => m.key).concat(["Off"]);
  for (const mode of modes) {
    for (const brightness of [1, 5]) {
      for (const speed of [0, 2]) {
        const cmd = L.buildCommand({ mode, hex: "12ab34", brightness, speed }, 1, 5);
        const r = run(cmd, { FAKE_OPENRGB_LOG: log });
        assert.equal(r.status, 0, `${cmd.join(" ")} -> ${r.err}`);
      }
    }
  }
  const lines = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, modes.length * 4);
  assert.ok(lines.includes("-d|1|-m|Breathing|-c|12ab34|-b|100|--speed|100"));
  assert.ok(lines.includes("-d|1|-m|Static|-c|12ab34|-b|20"));
  assert.ok(lines.includes("-d|1|-m|Off"));
});

test("a hung openrgb is killed by timeout", () => {
  const cmd = L.buildCommand({ mode: "Static" }, 1, 1);
  const r = run(cmd, { FAKE_OPENRGB_MODE: "hang" });
  assert.equal(r.status, 124);
  assert.ok(r.ms < 6000, `took ${r.ms} ms`);
});

test("a failing openrgb gives a non-zero exit", () => {
  const r = run(L.buildCommand({ mode: "Static" }, 1, 5), { FAKE_OPENRGB_MODE: "fail" });
  assert.equal(r.status, 1);
});

test("wrong device index fails (the case the plugin retries)", () => {
  const r = run(L.buildCommand({ mode: "Breathing" }, 0, 5));
  assert.notEqual(r.status, 0);
  const r2 = run(L.buildCommand({ mode: "Static" }, 7, 5));
  assert.notEqual(r2.status, 0);
});

test("RGB probe: finds the keyboard by name, not by position", () => {
  const ev = L.evaluateRgb(probe(L.PROBE_RGB));
  assert.deepEqual(ev, { kind: "ok", index: 1, version: { major: 1, minor: 1 } });
});

test("RGB probe: old OpenRGB is refused", () => {
  assert.equal(L.evaluateRgb(probe(L.PROBE_RGB, { FAKE_OPENRGB_MODE: "old" })).kind, "old-openrgb");
});

test("RGB probe: keyboard missing from OpenRGB", () => {
  assert.equal(L.evaluateRgb(probe(L.PROBE_RGB, { FAKE_OPENRGB_MODE: "nodevice" })).kind, "no-device");
});

test("RGB probe: OpenRGB not installed", () => {
  const dir = tmp();
  const timeoutBin = spawnSync("sh", ["-c", "command -v timeout"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(timeoutBin, path.join(dir, "timeout"));
  const out = probe(L.PROBE_RGB, { PATH: dir });
  assert.equal(L.evaluateRgb(out).kind, "no-openrgb");
});

function fakeSysfs(devs) {
  const dir = tmp();
  devs.forEach(([vid, pid], i) => {
    const d = path.join(dir, `1-${i + 1}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "idVendor"), vid + "\n");
    fs.writeFileSync(path.join(d, "idProduct"), pid + "\n");
  });
  fs.mkdirSync(path.join(dir, "usb1")); // entry without id files must be skipped
  return dir;
}

test("USB probe: supported keyboard present", () => {
  const sys = fakeSysfs([["04d9", "a09f"], ["1462", "1563"]]);
  assert.equal(L.evaluateUsb(probe(L.PROBE_USB, { CANDELA_SYSFS: sys })), true);
});

test("USB probe: each allowed product id", () => {
  for (const pid of ["1562", "1563", "1564"]) {
    assert.equal(L.evaluateUsb(probe(L.PROBE_USB, { CANDELA_SYSFS: fakeSysfs([["1462", pid]]) })), true, pid);
  }
});

test("USB probe: other MSI controllers and other vendors are refused", () => {
  for (const dev of [["1462", "7b94"], ["1462", "1601"], ["1038", "113a"], ["048d", "ce00"]]) {
    assert.equal(L.evaluateUsb(probe(L.PROBE_USB, { CANDELA_SYSFS: fakeSysfs([dev]) })), false, dev.join(":"));
  }
});

test("USB probe: empty or missing sysfs", () => {
  assert.equal(L.evaluateUsb(probe(L.PROBE_USB, { CANDELA_SYSFS: tmp() })), false);
  assert.equal(L.evaluateUsb(probe(L.PROBE_USB, { CANDELA_SYSFS: "/nonexistent/path" })), false);
});

test("state save script writes the file atomically from positional args", () => {
  const dir = tmp();
  const file = path.join(dir, "deep", "er", "state.json");
  const json = L.serializeState({ mode: "Breathing", hex: "ff0000" });
  const r = run(["sh", "-c", L.SAVE_SCRIPT, "candela", json, file]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(L.parseState(fs.readFileSync(file, "utf8")), L.sanitizeState({ mode: "Breathing", hex: "ff0000" }));
  assert.equal(fs.existsSync(file + ".tmp"), false);
});

test("state save script does not execute hostile content", () => {
  const dir = tmp();
  const marker = path.join(dir, "pwned");
  const file = path.join(dir, "state.json");
  const evil = `{"x":"$(touch ${marker})\`touch ${marker}\`"}`;
  const r = run(["sh", "-c", L.SAVE_SCRIPT, "candela", evil, file]);
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(file, "utf8"), evil);
});
