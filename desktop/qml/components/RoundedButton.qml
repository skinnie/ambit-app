import QtQuick
import QtQuick.Controls
import AmbitApp

// Real request 2026-08-09 ("can you just used rounded squares on sport modes buttons and
// settings buttons/sliders?"). Plain QtQuick.Controls Button renders with the platform
// Basic style's own minimal look - the same gap RoundedComboBox.qml already closed for
// dropdowns. A drop-in replacement for `Button { ... }` - extends Button directly, so every
// existing property/signal (text/enabled/checkable/checked/onClicked) keeps working
// unchanged.
Button {
    id: root

    hoverEnabled: true
    implicitHeight: 36
    leftPadding: Theme.spacingMedium
    rightPadding: Theme.spacingMedium

    background: Rectangle {
        implicitHeight: 36
        radius: Theme.radiusSmall
        color: root.checked ? Theme.primary
            : ((root.pressed || root.hovered) ? Theme.background : Theme.card)
        border.width: root.checked ? 0 : 1
        // Real, 2026-08-10 ("the contour of the buttons when not selected...they are
        // black...not that visible") - Theme.background is the darkest color in the whole
        // dark palette, so a border drawn in it all but disappears against Theme.card (this
        // button's own idle fill) or the page behind it. WatchFacePreview.qml's own
        // selected/unselected border already established the right pattern for this exact
        // case (Theme.mutedText, real contrast in both themes) - this was the one place
        // that didn't follow it, not a new color invented here.
        border.color: Theme.mutedText
        Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

    contentItem: Text {
        text: root.text
        color: root.checked ? Theme.card : (root.enabled ? Theme.text : Theme.mutedText)
        font.pixelSize: Theme.fontSizeBody
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

    opacity: root.enabled ? 1.0 : 0.5
    Behavior on opacity { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
}
