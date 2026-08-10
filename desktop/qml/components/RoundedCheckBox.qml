import QtQuick
import QtQuick.Controls
import AmbitApp

// Real request 2026-08-09 ("for everything possible, never use true square stuff, always
// rounded corners") - QtQuick.Controls Basic style's CheckBox indicator has no radius at
// all (confirmed against the actual installed style's own CheckBox.qml - a plain square
// Rectangle). A drop-in replacement for `CheckBox { ... }` - extends CheckBox directly, so
// every existing property (checked/enabled/text/onToggled) keeps working unchanged.
CheckBox {
    id: root

    indicator: Rectangle {
        implicitWidth: 22
        implicitHeight: 22
        x: root.leftPadding
        y: root.topPadding + (root.availableHeight - height) / 2
        radius: Theme.radiusSmall
        color: root.checked ? Theme.primary : Theme.card
        border.width: 1
        // Real, 2026-08-10 ("the contour of the buttons when not selected...they are
        // black...not that visible") - see RoundedButton.qml's own comment on this same
        // fix across the Rounded* family.
        border.color: root.checked ? Theme.primary : Theme.mutedText
        Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }

        // No plain bare-checkmark glyph exists in this app's own subset font (see
        // assets/fonts/NOTICE.md - not guessed here) - checkCircle is the closest real,
        // already-available glyph and still reads clearly as "checked" at this size.
        Icon {
            anchors.centerIn: parent
            visible: root.checked
            glyph: Icons.checkCircle
            size: 16
            color: Theme.card
        }
    }

    contentItem: Text {
        text: root.text
        color: root.enabled ? Theme.text : Theme.mutedText
        font.pixelSize: Theme.fontSizeLabel
        leftPadding: root.indicator ? root.indicator.width + Theme.spacingSmall : 0
        verticalAlignment: Text.AlignVCenter
    }
}
