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

    // Real, 2026-08-09 ("they seem big" - compared side by side with the brightness/
    // contrast RoundedSlider's own ~18px handle) - shrunk from 44x24/18px-handle down
    // closer to that same visual scale, rather than Basic style's own default touch-target
    // sizing.
    indicator: Rectangle {
        implicitWidth: 36
        implicitHeight: 20
        x: root.leftPadding
        y: root.topPadding + (root.availableHeight - height) / 2
        radius: height / 2  // a true pill, not Basic style's own modest corner-round
        color: root.checked ? Theme.primary : Theme.background
        Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }

        Rectangle {
            x: root.checked ? parent.width - width - 2 : 2
            y: (parent.height - height) / 2
            width: 16
            height: 16
            radius: 8  // circular handle
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
