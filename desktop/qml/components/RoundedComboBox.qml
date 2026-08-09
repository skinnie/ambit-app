import QtQuick
import QtQuick.Controls
import AmbitApp

// Real request 2026-08-09 ("Settings for the drop down menus could we have something
// rounder, similar style to the cards?"). Plain QtQuick.Controls ComboBox renders with the
// platform Basic style's own square, minimal look, which doesn't match this app's rounded-
// card visual language used everywhere else. A drop-in replacement for `ComboBox { ... }` -
// extends ComboBox directly (not a wrapper), so every property/signal the two existing
// call sites use (model/textRole/valueRole/currentIndex/enabled/onActivated) keeps working
// unchanged.
//
// Deliberately narrow in scope: only the closed box and the popup's own background/border
// are restyled here. The popup's internal ListView/delegate model wiring is left as the
// platform default rather than reimplemented - customizing that risks real selection bugs
// that can't be visually verified from here, for a part of the control that's far less
// visible than the closed box most users actually look at.
ComboBox {
    id: root

    implicitHeight: 36

    background: Rectangle {
        implicitHeight: 36
        radius: Theme.radiusCard
        color: Theme.card
        border.width: 1
        border.color: root.activeFocus ? Theme.primary : Theme.background
        Behavior on border.color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

    contentItem: Text {
        text: root.displayText
        color: Theme.text
        font.pixelSize: Theme.fontSizeBody
        leftPadding: Theme.spacingMedium
        rightPadding: root.indicator.width + Theme.spacingSmall
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    popup.background: Rectangle {
        radius: Theme.radiusCard
        color: Theme.card
        border.width: 1
        border.color: Theme.background
    }
}
