import QtQuick
import QtQuick.Controls
import AmbitApp

// Real request 2026-08-09 ("display dark and storm alarm still have squared buttons") -
// the installed Qt Basic style's own Switch.qml does round its track (radius: 8 on a
// 56x28 shape), but that's a modest corner-round, not a true pill - noticeably squarer
// than everything else in the app now that RoundedButton/RoundedComboBox etc. use much
// more generous rounding. A drop-in replacement for `Switch { ... }` - extends Switch
// directly, so every existing property (checked/enabled/onToggled) keeps working
// unchanged.
Switch {
    id: root

    indicator: Rectangle {
        implicitWidth: 44
        implicitHeight: 24
        x: root.leftPadding
        y: root.topPadding + (root.availableHeight - height) / 2
        radius: height / 2  // a true pill, not Basic style's own modest corner-round
        color: root.checked ? Theme.primary : Theme.background
        Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }

        Rectangle {
            x: root.checked ? parent.width - width - 3 : 3
            y: (parent.height - height) / 2
            width: 18
            height: 18
            radius: 9  // circular handle
            color: Theme.card
            Behavior on x { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
        }
    }

    contentItem: Text {
        text: root.text
        color: Theme.text
        font.pixelSize: Theme.fontSizeBody
        leftPadding: root.indicator ? root.indicator.width + Theme.spacingSmall : 0
        verticalAlignment: Text.AlignVCenter
    }
}
