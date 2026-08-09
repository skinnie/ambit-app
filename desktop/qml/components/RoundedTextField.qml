import QtQuick
import QtQuick.Controls
import AmbitApp

// Real request 2026-08-09 ("for everything possible, never use true square stuff, always
// rounded corners") - QtQuick.Controls Basic style's TextField background has no radius at
// all (confirmed against the actual installed style's own TextField.qml - a plain square
// Rectangle). A drop-in replacement for `TextField { ... }` - extends TextField directly,
// so every existing property (text/width/enabled/validator) keeps working unchanged.
TextField {
    id: root

    color: Theme.text
    font.pixelSize: Theme.fontSizeBody
    selectionColor: Theme.primary
    selectedTextColor: Theme.card
    verticalAlignment: Text.AlignVCenter
    leftPadding: Theme.spacingSmall
    rightPadding: Theme.spacingSmall

    background: Rectangle {
        implicitWidth: 120
        implicitHeight: 36
        radius: Theme.radiusSmall
        color: Theme.card
        border.width: root.activeFocus ? 2 : 1
        border.color: root.activeFocus ? Theme.primary : Theme.background
        Behavior on border.color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }
}
