import QtQuick 2.15
import QtTest 1.15
import "../../Logic.js" as Logic

// Runs the same logic inside Qt's own JS engine, which is the one the shell uses.
TestCase {
  name: "Logic"

  function j(x) { return JSON.stringify(x) }

  function test_hex() {
    compare(Logic.normalizeHex("#FF00aa"), "ff00aa")
    compare(Logic.normalizeHex("$(id)"), null)
    compare(Logic.normalizeHex(5), null)
    compare(Logic.rgbToHex(255, 0, 128), "ff0080")
  }

  function test_buildCommand() {
    compare(j(Logic.buildCommand({ mode: "Breathing", hex: "ff0000", brightness: 3, speed: 2 }, 1, 5)),
            j(["timeout", "5", "openrgb", "-d", "1", "-m", "Breathing", "-c", "ff0000", "-b", "60", "--speed", "100"]))
    compare(j(Logic.buildCommand({ mode: "Off" }, 0, 5)),
            j(["timeout", "5", "openrgb", "-d", "0", "-m", "Off"]))
    compare(Logic.buildCommand({}, -1, 5), null)
  }

  function test_hostile() {
    var cmd = Logic.buildCommand({ mode: "Static; rm -rf /", hex: "$(id)", brightness: "9e9", speed: -5 }, 0, 999)
    compare(cmd[1], "30")
    compare(cmd[6], "Static")
    for (var i = 0; i < cmd.length; i++)
      verify(/^[A-Za-z0-9 .\-]+$/.test(cmd[i]), cmd[i])
  }

  function test_probeParsing() {
    var txt = "@version\nOpenRGB 1.1, for controlling RGB lighting.\n@devices\n0: Mouse\n  Type: Mouse\n1: MSI MysticLight MS-1563 v0001\n@end\n"
    var ev = Logic.evaluateRgb(txt)
    compare(ev.kind, "ok")
    compare(ev.index, 1)
    compare(Logic.evaluateRgb("@version\nOpenRGB 0.9\n@devices\n@end").kind, "old-openrgb")
    compare(Logic.evaluateUsb("@usb\n04d9:a09f\n1462:1563\n@end"), true)
    compare(Logic.evaluateUsb("@usb\n1462:7b94\n@end"), false)
  }

  function test_state() {
    var s = Logic.parseState('{"mode":"Flashing","hex":"#AABBCC","brightness":2,"speed":0}')
    compare(s.mode, "Flashing")
    compare(s.hex, "aabbcc")
    compare(Logic.parseState("not json"), null)
    compare(Logic.parseState(""), null)
    compare(Logic.statePath({ HOME: "/home/a" }), "/home/a/.local/state/candela-mystic-light/state.json")
    compare(Logic.statePath({ HOME: "rel" }), null)
  }

  function test_scheduler() {
    var started = []
    var s = Logic.createScheduler(function (job) { started.push(job) })
    compare(s.submit("A"), "started")
    compare(s.submit("B"), "queued")
    compare(s.submit("C"), "queued")
    compare(s.done(), "next")
    compare(j(started), j(["A", "C"]))
    compare(s.done(), "idle")
  }
}
