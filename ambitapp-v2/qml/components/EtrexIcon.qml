import QtQuick
import AmbitApp

// A simple, real silhouette of a Garmin eTrex handheld GPS unit - a tall body, an antenna/
// GPS bump on top, a screen rectangle, two button dots - real request 2026-08-08 ("create
// an etrex icon similar to the ambit, based on the garmin etrex"). Drawn from plain shapes
// rather than a font glyph: no icon in this app's Material Symbols subset represents a
// handheld GPS unit, and adding one would mean re-subsetting the bundled font (see assets/
// fonts/NOTICE.md) for a single icon. Sized/colored the same way Icon.qml is (`size`/
// `color`), so it drops into the exact same call sites (`EtrexIcon { size: 32 }`).
Item {
    id: root
    property int size: 24
    property color color: Theme.text

    implicitWidth: size
    implicitHeight: size

    // Body - taller than wide, matching the eTrex's real proportions (a vertical handheld,
    // not a square watch face).
    Rectangle {
        id: body
        width: root.size * 0.6
        height: root.size * 0.86
        radius: width * 0.22
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        color: "transparent"
        border.color: root.color
        border.width: Math.max(1, root.size * 0.07)
    }

    // GPS/antenna bump protruding from the top - the eTrex's own real, distinctive
    // silhouette detail that a plain rounded rectangle alone wouldn't read as "eTrex."
    Rectangle {
        width: root.size * 0.24
        height: root.size * 0.16
        radius: width * 0.3
        anchors.horizontalCenter: body.horizontalCenter
        anchors.bottom: body.top
        anchors.bottomMargin: -height * 0.45
        color: "transparent"
        border.color: root.color
        border.width: Math.max(1, root.size * 0.06)
    }

    // Screen
    Rectangle {
        width: body.width * 0.62
        height: body.height * 0.4
        radius: width * 0.12
        anchors.horizontalCenter: body.horizontalCenter
        anchors.top: body.top
        anchors.topMargin: body.height * 0.16
        color: root.color
        opacity: 0.85
    }

    // Two button dots below the screen
    Row {
        anchors.horizontalCenter: body.horizontalCenter
        anchors.bottom: body.bottom
        anchors.bottomMargin: body.height * 0.14
        spacing: body.width * 0.22
        Rectangle { width: root.size * 0.09; height: width; radius: width / 2; color: root.color }
        Rectangle { width: root.size * 0.09; height: width; radius: width / 2; color: root.color }
    }
}
