import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Logic.js" as Logic

Panel {
  id: root
  moduleName: "io.github.sanayscripts.candela-mystic-light"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  // desired keyboard state; always replaced as a whole, never mutated in place
  property var st: Logic.sanitizeState(null)
  property string phase: "probing" // probing | ready | unsupported | error
  property string errorText: ""
  property int devIndex: -1
  property bool reprobing: false
  property bool retried: false
  property bool jobActive: false
  property bool saveAgain: false
  property bool hadState: false
  property string model: "MS-156x"

  readonly property bool ready: phase === "ready"
  readonly property var rgb: Logic.hexToRgb(st.hex)
  readonly property var info: Logic.modeInfo(st.mode)
  readonly property string fontFam: root.bar ? root.bar.fontFamily : Style.font.family
  readonly property color dim: Qt.alpha(root.barForeground, 0.25)
  readonly property color warn: (root.bar && root.bar.urgent) ? root.bar.urgent : "#e06c75"

  property var sched: Logic.createScheduler(function (job) { root.startJob(job) })

  function open() { root.controller.show() }
  function close() { root.controller.hide() }
  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.hostWidget || root, direction)
    return false
  }

  function setState(patch) {
    var n = {}
    var k
    for (k in st) n[k] = st[k]
    for (k in patch) n[k] = patch[k]
    st = Logic.sanitizeState(n)
  }

  // ---- applying -------------------------------------------------------

  function apply() {
    if (!ready) return
    var cmd = Logic.buildCommand(st, devIndex, 5)
    if (cmd === null) { errorText = Logic.message("no-device"); return }
    sched.submit(cmd)
  }

  function startJob(job) {
    jobActive = true
    applyProc.command = job
    applyProc.running = true
    watchdog.restart()
  }

  function jobDone(code) {
    if (!jobActive) return
    jobActive = false
    watchdog.stop()
    var next = sched.done()
    if (code === 0) {
      errorText = ""
      retried = false
      if (next === "idle") saveState()
      return
    }
    if (code === 124 || code === -1) { errorText = Logic.message("timeout"); return }
    // The device index can change when other RGB devices come and go: look it up again once.
    if (!retried) { retried = true; reprobing = true; probeRgb(); return }
    errorText = Logic.message("failed", code)
  }

  function setMode(key) {
    setState({ mode: key, lastOn: key })
    apply()
  }

  function setHex(hex) {
    if (hex === null) return
    setState({ hex: hex })
    apply()
  }

  function useTheme() {
    setState({ hex: Logic.colorToHex(root.barForeground) })
    apply()
  }

  onBarForegroundChanged: if (st.follow && ready) useTheme()

  // ---- probing and state ---------------------------------------------

  function recheck() {
    phase = "probing"
    errorText = ""
    usbProc.running = true
  }

  function onUsb(text) {
    model = Logic.usbModel(text) || "MS-156x"
    if (!Logic.evaluateUsb(text)) {
      phase = "unsupported"
      errorText = Logic.message("no-keyboard")
      return
    }
    probeRgb()
  }

  function probeRgb() {
    if (!rgbProc.running) rgbProc.running = true
  }

  function onRgb(text) {
    var ev = Logic.evaluateRgb(text)
    if (ev.kind !== "ok") {
      reprobing = false
      phase = "error"
      errorText = Logic.message(ev.kind)
      return
    }
    devIndex = ev.index
    if (reprobing) {
      reprobing = false
      apply()
      return
    }
    loadState()
  }

  function statePath() {
    return Logic.statePath({
      HOME: Quickshell.env("HOME"),
      XDG_STATE_HOME: Quickshell.env("XDG_STATE_HOME")
    })
  }

  function loadState() {
    var p = statePath()
    if (!p) { onState(""); return }
    catProc.command = ["cat", p]
    catProc.running = true
  }

  function onState(text) {
    var parsed = Logic.parseState(text)
    hadState = parsed !== null
    if (parsed !== null) st = parsed
    phase = "ready"
    errorText = ""
    if (st.follow) useTheme()
    else if (hadState) apply() // put the keyboard back the way it was
  }

  function saveState() {
    var p = statePath()
    if (!p) return
    if (saveProc.running) { saveAgain = true; return }
    saveProc.command = ["sh", "-c", Logic.SAVE_SCRIPT, "candela", Logic.serializeState(st), p]
    saveProc.running = true
  }

  Component.onCompleted: usbProc.running = true

  Process {
    id: usbProc
    command: ["sh", "-c", Logic.PROBE_USB]
    stdout: StdioCollector {
      id: usbOut
      onStreamFinished: root.onUsb(usbOut.text)
    }
  }

  Process {
    id: rgbProc
    command: ["sh", "-c", Logic.PROBE_RGB]
    stdout: StdioCollector {
      id: rgbOut
      onStreamFinished: root.onRgb(rgbOut.text)
    }
  }

  Process {
    id: catProc
    stdout: StdioCollector {
      id: catOut
      onStreamFinished: root.onState(catOut.text)
    }
  }

  Process {
    id: saveProc
    onExited: {
      if (root.saveAgain) { root.saveAgain = false; root.saveState() }
    }
  }

  Process {
    id: applyProc
    onExited: function (code) { root.jobDone(code) }
  }

  // If the process never reports back, give up on it so the panel cannot jam.
  Timer {
    id: watchdog
    interval: 8000
    onTriggered: {
      applyProc.running = false
      root.jobDone(-1)
    }
  }

  // ---- small controls -------------------------------------------------

  component Btn: Rectangle {
    id: b
    property string label: ""
    property bool active: false
    signal clicked()
    implicitHeight: Style.space(28)
    radius: 3
    color: active ? Qt.alpha(root.barForeground, 0.18) : "transparent"
    border.width: 1
    border.color: active ? root.barForeground : root.dim
    Text {
      anchors.centerIn: parent
      width: parent.width - 12
      horizontalAlignment: Text.AlignHCenter
      elide: Text.ElideRight
      text: b.label
      color: root.barForeground
      font.family: root.fontFam
      font.pixelSize: 13
    }
    MouseArea { anchors.fill: parent; onClicked: b.clicked() }
  }

  component Slide: Item {
    id: s
    property real value: 0
    property real maxValue: 255
    property color fill: root.barForeground
    signal moved(real v)
    signal released()
    implicitHeight: Style.space(18)
    Rectangle {
      width: parent.width
      height: 6
      radius: 3
      anchors.verticalCenter: parent.verticalCenter
      color: root.dim
      Rectangle {
        width: parent.width * Math.max(0, Math.min(1, s.value / s.maxValue))
        height: parent.height
        radius: 3
        color: s.fill
      }
    }
    Rectangle {
      width: 14
      height: 14
      radius: 7
      anchors.verticalCenter: parent.verticalCenter
      x: (s.width - 14) * Math.max(0, Math.min(1, s.value / s.maxValue))
      color: s.fill
      border.width: 1
      border.color: root.barForeground
    }
    MouseArea {
      anchors.fill: parent
      function setFrom(x) { s.moved(Math.max(0, Math.min(1, x / s.width)) * s.maxValue) }
      onPressed: function(m) { setFrom(m.x) }
      onPositionChanged: function(m) { if (pressed) setFrom(m.x) }
      onReleased: s.released()
    }
  }

  // ---- layout ---------------------------------------------------------

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(300))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: content
        width: parent.width
        spacing: Style.space(10)

        Row {
          width: parent.width
          spacing: Style.space(10)
          Rectangle {
            width: Style.space(36); height: Style.space(36); radius: 4
            color: "#" + root.st.hex
            border.width: 1; border.color: root.barForeground
          }
          Column {
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)
            Text {
              text: "CANDELA"
              color: root.barForeground
              font.family: root.fontFam
              font.pixelSize: Style.font.subtitle
              font.bold: true
            }
            Text {
              text: "for MSI Mystic Light " + root.model
              color: Qt.alpha(root.barForeground, 0.7)
              font.family: root.fontFam
              font.pixelSize: 11
            }
          }
        }

        Text {
          visible: root.errorText !== ""
          width: parent.width
          text: root.errorText
          wrapMode: Text.WordWrap
          color: root.warn
          font.family: root.fontFam
          font.pixelSize: 12
        }

        Btn {
          visible: root.phase === "error" || root.phase === "unsupported"
          width: parent.width
          label: "Check again"
          onClicked: root.recheck()
        }

        Column {
          width: parent.width
          spacing: Style.space(10)
          enabled: root.ready
          opacity: root.ready ? 1.0 : 0.4

          Grid {
            width: parent.width
            columns: 3
            spacing: Style.space(6)
            Repeater {
              model: Logic.MODES
              delegate: Btn {
                width: (content.width - Style.space(12)) / 3
                label: modelData.label
                active: root.st.mode === modelData.key
                onClicked: root.setMode(modelData.key)
              }
            }
          }

          Row {
            width: parent.width
            spacing: Style.space(6)
            Repeater {
              model: ["ff0000", "ff7a00", "ffff00", "00ff00", "00ffff", "0066ff", "8000ff", "ff00aa", "ffffff"]
              delegate: Rectangle {
                width: (content.width - Style.space(48)) / 9
                height: width
                radius: 3
                color: "#" + modelData
                border.width: 1
                border.color: root.dim
                MouseArea {
                  anchors.fill: parent
                  onClicked: root.setHex(modelData)
                }
              }
            }
          }

          Slide {
            width: parent.width; value: root.rgb.r; fill: "#ff4444"
            onMoved: function(v) { root.setState({ hex: Logic.rgbToHex(Math.round(v), root.rgb.g, root.rgb.b) }) }
            onReleased: root.apply()
          }
          Slide {
            width: parent.width; value: root.rgb.g; fill: "#44ff44"
            onMoved: function(v) { root.setState({ hex: Logic.rgbToHex(root.rgb.r, Math.round(v), root.rgb.b) }) }
            onReleased: root.apply()
          }
          Slide {
            width: parent.width; value: root.rgb.b; fill: "#4488ff"
            onMoved: function(v) { root.setState({ hex: Logic.rgbToHex(root.rgb.r, root.rgb.g, Math.round(v)) }) }
            onReleased: root.apply()
          }

          Row {
            width: parent.width
            spacing: Style.space(8)
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "HEX"
              color: root.barForeground
              font.family: root.fontFam
              font.pixelSize: 12
            }
            Rectangle {
              width: Style.space(110); height: Style.space(28); radius: 3
              color: "transparent"
              border.width: 1; border.color: root.dim
              TextInput {
                anchors.fill: parent
                anchors.margins: 6
                verticalAlignment: TextInput.AlignVCenter
                color: root.barForeground
                font.family: root.fontFam
                font.pixelSize: 13
                text: root.st.hex
                maximumLength: 7
                selectByMouse: true
                onEditingFinished: {
                  root.setHex(Logic.normalizeHex(text))
                  text = Qt.binding(function() { return root.st.hex })
                }
              }
            }
            Btn {
              width: Style.space(110)
              label: "Theme color"
              onClicked: root.useTheme()
            }
          }

          Text {
            text: "BRIGHTNESS  " + root.st.brightness + "/5"
            color: root.barForeground
            font.family: root.fontFam
            font.pixelSize: 11
          }
          Slide {
            width: parent.width
            maxValue: 4
            value: root.st.brightness - 1
            onMoved: function(v) { root.setState({ brightness: Math.round(v) + 1 }) }
            onReleased: root.apply()
          }

          Text {
            visible: root.info !== null && root.info.speed
            text: "SPEED  " + (root.st.speed + 1) + "/3"
            color: root.barForeground
            font.family: root.fontFam
            font.pixelSize: 11
          }
          Slide {
            visible: root.info !== null && root.info.speed
            width: parent.width
            maxValue: 2
            value: root.st.speed
            onMoved: function(v) { root.setState({ speed: Math.round(v) }) }
            onReleased: root.apply()
          }

          Row {
            width: parent.width
            spacing: Style.space(6)
            Btn {
              width: (content.width - Style.space(12)) / 3
              label: "Off"
              active: root.st.mode === "Off"
              onClicked: { root.setState({ mode: "Off" }); root.apply() }
            }
            Btn {
              width: (content.width - Style.space(12)) / 3
              label: "On"
              onClicked: { root.setState({ mode: root.st.mode === "Off" ? root.st.lastOn : root.st.mode }); root.apply() }
            }
            Btn {
              width: (content.width - Style.space(12)) / 3
              label: "Sync theme"
              active: root.st.follow
              onClicked: {
                root.setState({ follow: !root.st.follow })
                if (root.st.follow) root.useTheme()
                else root.saveState()
              }
            }
          }
        }
      }
    }
  }
}
