import QtQuick
import AmbitApp

// Real, 2026-08-09 ("Full SuuntoLink-style redesign") - matches SuuntoLink's own real
// circular screen-preview mockup (assets/ambit3 pcap/v2/screens sports modes/
// 8displaysmax.JPG, displaytype.JPG) - a plain circle showing the current screen's row
// layout. Deliberately shows row *position* (numbered, or a small graph glyph), not real
// field content - SuuntoLink's own mockup does the same (its circles just show "1"/"2"/"3",
// not the actual assigned data), and this project has no live sample values to show
// honestly here anyway.
Item {
    id: root

    // "1row" | "2rows" | "3rows" | "graph" | "map" | "builtin" - builtin/map get a plain
    // icon instead of numbered rows (there's real, confirmed data for what a built-in
    // screen's own row count even means - see custom_modes.py's system_tail_length()).
    property string layoutType: "3rows"
    property bool selected: false
    property real diameter: 120

    implicitWidth: diameter
    implicitHeight: diameter

    Rectangle {
        anchors.fill: parent
        radius: width / 2
        color: Theme.background
        border.width: root.selected ? 3 : 1
        border.color: root.selected ? Theme.primary : Theme.mutedText
        Behavior on border.color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }

        Column {
            anchors.centerIn: parent
            width: parent.width * 0.6
            spacing: parent.height * 0.06
            visible: root.layoutType === "1row" || root.layoutType === "2rows"
                     || root.layoutType === "3rows"

            Repeater {
                model: root.layoutType === "1row" ? 1 : root.layoutType === "2rows" ? 2 : 3
                delegate: Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: String(index + 1)
                    font.pixelSize: root.diameter * 0.16
                    font.bold: true
                    color: Theme.text
                }
            }
        }

        // "1 Row with graph" - a small squiggle standing in for the real graph area
        // (matches SuuntoLink's own icon in displaytype.JPG), plus the one real data row
        // below it.
        Column {
            anchors.centerIn: parent
            width: parent.width * 0.7
            spacing: parent.height * 0.05
            visible: root.layoutType === "graph"

            Canvas {
                width: parent.width
                height: root.diameter * 0.28
                onPaint: {
                    const ctx = getContext("2d")
                    ctx.reset()
                    ctx.strokeStyle = Theme.primary
                    ctx.lineWidth = 2
                    ctx.beginPath()
                    ctx.moveTo(0, height * 0.7)
                    ctx.lineTo(width * 0.25, height * 0.2)
                    ctx.lineTo(width * 0.5, height * 0.6)
                    ctx.lineTo(width * 0.75, height * 0.1)
                    ctx.lineTo(width, height * 0.5)
                    ctx.stroke()
                }
            }
            Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: "1"
                font.pixelSize: root.diameter * 0.14
                font.bold: true
                color: Theme.text
            }
        }

        Icon {
            visible: root.layoutType === "map"
            anchors.centerIn: parent
            glyph: Icons.routes
            size: root.diameter * 0.32
            color: Theme.mutedText
        }

        Icon {
            visible: root.layoutType === "builtin"
            anchors.centerIn: parent
            glyph: Icons.watch
            size: root.diameter * 0.32
            color: Theme.mutedText
        }
    }
}
