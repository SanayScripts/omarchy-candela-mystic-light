.pragma library

// Candela: pure logic. No I/O here, so it can be unit-tested without a keyboard.
// Keep this file to conservative JavaScript (no ?. / ??) so it runs in Qt's JS engine and Node alike.

var VENDOR = "1462";
var PRODUCTS = ["1562", "1563", "1564"];
var MIN_VERSION = [1, 1];
var NAME_RE = /MysticLight MS-156[234]/i;
var OFF = "Off";

// Modes reported by an MS-1563 through OpenRGB 1.1. Only these names are ever sent.
var MODES = [
  { key: "Static", label: "Static", speed: false },
  { key: "Breathing", label: "Breathe", speed: true },
  { key: "Flashing", label: "Flash", speed: true },
  { key: "Double Flashing", label: "Double", speed: true },
  { key: "Spectrum Cycle", label: "Spectrum", speed: true },
  { key: "Smooth Spectrum Cycle", label: "Smooth", speed: true }
];

var DEFAULT_STATE = {
  mode: "Static",
  lastOn: "Static",
  hex: "00aaff",
  brightness: 5, // 1..5, the hardware has five steps -> 20..100 percent
  speed: 1,      // 0..2, the hardware reports a 0..2 range -> 0, 50, 100 percent
  follow: false
};

// Constant shell snippets, run with `sh -c`. They take no user input.
var PROBE_USB = [
  'base="${CANDELA_SYSFS:-/sys/bus/usb/devices}"',
  'echo "@usb"',
  'for d in "$base"/*; do',
  '  [ -r "$d/idVendor" ] || continue',
  '  [ -r "$d/idProduct" ] || continue',
  "  printf '%s:%s\\n' \"$(cat \"$d/idVendor\")\" \"$(cat \"$d/idProduct\")\"",
  "done",
  'echo "@end"'
].join("\n");

var PROBE_RGB = [
  'echo "@version"',
  "timeout 8 openrgb --version 2>&1",
  'echo "@devices"',
  "timeout 20 openrgb --list-devices 2>&1",
  'echo "@end"'
].join("\n");

// Positional args only: $1 = json, $2 = absolute path. Nothing is interpolated into the script.
var SAVE_SCRIPT = [
  'mkdir -p "$(dirname "$2")" && printf %s "$1" > "$2.tmp" && mv "$2.tmp" "$2"'
].join("\n");

var MESSAGES = {
  "no-keyboard": "No supported keyboard found. Needs an MSI Mystic Light MS-1562/1563/1564 (USB 1462).",
  "no-openrgb": "OpenRGB was not found. Install openrgb and restart the shell.",
  "old-openrgb": "OpenRGB 1.1 or newer is required.",
  "no-device": "OpenRGB does not list the keyboard. Check its udev rules.",
  "timeout": "OpenRGB timed out.",
  "failed": "OpenRGB failed"
};

function message(kind, extra) {
  var base = MESSAGES[kind];
  if (typeof base !== "string") return "Unknown error.";
  if (kind === "failed" && extra !== undefined && extra !== null) return base + " (exit code " + extra + ").";
  return base;
}

function clampInt(v, lo, hi, dflt) {
  var n = (typeof v === "number") ? v : parseInt(v, 10);
  if (!isFinite(n)) return dflt;
  n = Math.round(n);
  return Math.max(lo, Math.min(hi, n));
}

function normalizeHex(s) {
  if (typeof s !== "string") return null;
  var m = /^#?([0-9a-fA-F]{6})$/.exec(s.trim());
  return m ? m[1].toLowerCase() : null;
}

function h2(n) {
  var s = clampInt(n, 0, 255, 0).toString(16);
  return s.length < 2 ? "0" + s : s;
}

function rgbToHex(r, g, b) {
  return h2(r) + h2(g) + h2(b);
}

function hexToRgb(hex) {
  var h = normalizeHex(hex) || DEFAULT_STATE.hex;
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16)
  };
}

// Takes a color-like object with r, g, b in 0..1 (what a QML color gives you).
function colorToHex(c) {
  if (!c) return DEFAULT_STATE.hex;
  return rgbToHex(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
}

function modeInfo(name) {
  if (name === OFF) return { key: OFF, label: "Off", speed: false };
  for (var i = 0; i < MODES.length; i++) {
    if (MODES[i].key === name) return MODES[i];
  }
  return null;
}

function sanitizeState(o) {
  var d = DEFAULT_STATE;
  var s = (o !== null && typeof o === "object") ? o : {};
  var mode = (typeof s.mode === "string" && modeInfo(s.mode) !== null) ? s.mode : d.mode;
  var lastOn = d.mode;
  if (typeof s.lastOn === "string" && s.lastOn !== OFF && modeInfo(s.lastOn) !== null) lastOn = s.lastOn;
  else if (mode !== OFF) lastOn = mode;
  return {
    mode: mode,
    lastOn: lastOn,
    hex: normalizeHex(s.hex) || d.hex,
    brightness: clampInt(s.brightness, 1, 5, d.brightness),
    speed: clampInt(s.speed, 0, 2, d.speed),
    follow: s.follow === true
  };
}

function parseState(text) {
  if (typeof text !== "string") return null;
  var t = text.trim();
  if (t.length === 0 || t.length > 2000) return null;
  try {
    var o = JSON.parse(t);
    if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
    return sanitizeState(o);
  } catch (e) {
    return null;
  }
}

function serializeState(s) {
  return JSON.stringify(sanitizeState(s));
}

// Full argv for one OpenRGB call. Every element comes from validated values.
function buildCommand(state, devIndex, timeoutSec) {
  var s = sanitizeState(state);
  // A bad index must be refused, not clamped: clamping -1 to 0 would silently target another device.
  var ds = String(devIndex);
  if (!/^\d{1,2}$/.test(ds)) return null;
  var idx = parseInt(ds, 10);
  var t = clampInt(timeoutSec, 1, 30, 5);
  var cmd = ["timeout", String(t), "openrgb", "-d", String(idx), "-m", s.mode];
  if (s.mode !== OFF) {
    cmd.push("-c", s.hex, "-b", String(s.brightness * 20));
    var info = modeInfo(s.mode);
    if (info !== null && info.speed) cmd.push("--speed", String(s.speed * 50));
  }
  return cmd;
}

function parseVersion(text) {
  if (typeof text !== "string") return null;
  var m = /OpenRGB\s+(\d+)\.(\d+)/.exec(text) || /Version:\s*(\d+)\.(\d+)/.exec(text);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function versionOk(v) {
  if (!v) return false;
  return v.major > MIN_VERSION[0] || (v.major === MIN_VERSION[0] && v.minor >= MIN_VERSION[1]);
}

// Only unindented "N: name" lines are devices; mode and zone lines are indented.
function parseDevices(text) {
  var out = [];
  if (typeof text !== "string") return out;
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^(\d+):\s+(.+?)\s*$/.exec(lines[i]);
    if (m) out.push({ index: parseInt(m[1], 10), name: m[2] });
  }
  return out;
}

function findDevice(devices) {
  for (var i = 0; i < devices.length; i++) {
    if (NAME_RE.test(devices[i].name)) return devices[i].index;
  }
  return null;
}

function parseUsb(text) {
  var out = [];
  if (typeof text !== "string") return out;
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{4})$/.exec(lines[i].trim());
    if (m) out.push({ vid: m[1].toLowerCase(), pid: m[2].toLowerCase() });
  }
  return out;
}

function supportedUsb(list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].vid === VENDOR && PRODUCTS.indexOf(list[i].pid) >= 0) return true;
  }
  return false;
}

function splitSections(text) {
  var out = {};
  var cur = null;
  var buf = [];
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^@(\w+)$/.exec(lines[i]);
    if (m) {
      if (cur !== null) out[cur] = buf.join("\n");
      cur = m[1];
      buf = [];
    } else if (cur !== null) {
      buf.push(lines[i]);
    }
  }
  if (cur !== null) out[cur] = buf.join("\n");
  return out;
}

// "MS-1563" for the first supported controller found, or null.
function usbModel(text) {
  var list = parseUsb(splitSections(text).usb || "");
  for (var i = 0; i < list.length; i++) {
    if (list[i].vid === VENDOR && PRODUCTS.indexOf(list[i].pid) >= 0) return "MS-" + list[i].pid;
  }
  return null;
}

function evaluateUsb(text) {
  var sec = splitSections(text);
  return supportedUsb(parseUsb(sec.usb || ""));
}

function evaluateRgb(text) {
  var sec = splitSections(text);
  var ver = parseVersion(sec.version || "");
  if (ver === null) return { kind: "no-openrgb" };
  if (!versionOk(ver)) return { kind: "old-openrgb", version: ver };
  var idx = findDevice(parseDevices(sec.devices || ""));
  if (idx === null) return { kind: "no-device", version: ver };
  return { kind: "ok", index: idx, version: ver };
}

// Absolute path or null. Relative values in the environment are ignored.
function statePath(env) {
  var e = env || {};
  var base = null;
  if (typeof e.XDG_STATE_HOME === "string" && e.XDG_STATE_HOME.charAt(0) === "/") base = e.XDG_STATE_HOME;
  else if (typeof e.HOME === "string" && e.HOME.charAt(0) === "/") base = e.HOME + "/.local/state";
  if (base === null) return null;
  return base.replace(/\/+$/, "") + "/candela-mystic-light/state.json";
}

// One job runs at a time. While one runs, only the newest waiting job is kept.
function createScheduler(start) {
  var busy = false;
  var pending = null;
  return {
    submit: function (job) {
      if (busy) {
        pending = job;
        return "queued";
      }
      busy = true;
      try {
        start(job);
      } catch (e) {
        busy = false;
        throw e;
      }
      return "started";
    },
    done: function () {
      if (pending !== null) {
        var j = pending;
        pending = null;
        busy = true;
        try {
          start(j);
        } catch (e) {
          busy = false;
          throw e;
        }
        return "next";
      }
      busy = false;
      return "idle";
    },
    isBusy: function () {
      return busy;
    }
  };
}
