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
        // Real, 2026-08-10 ("the contour of the buttons when not selected...they are
        // black...not that visible") - see RoundedButton.qml's own comment on this same
        // fix across the Rounded* family.
        border.color: root.activeFocus ? Theme.primary : Theme.mutedText
        Behavior on border.color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

    // Real, 2026-08-09 ("on the dropdow menus/buttons can we have the ext centered?") -
    // was left-aligned; centered within the text area (still excluding the reserved
    // rightPadding for the dropdown arrow, so centered text never overlaps it).
    contentItem: Text {
        text: root.displayText
        color: Theme.text
        font.pixelSize: Theme.fontSizeBody
        leftPadding: Theme.spacingMedium
        rightPadding: root.indicator.width + Theme.spacingSmall
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    popup.background: Rectangle {
        radius: Theme.radiusCard
        color: Theme.card
        border.width: 1
        // Real, 2026-08-10 ("the contour of the buttons when not selected...they are
        // black...not that visible") - see RoundedButton.qml's own comment on this same
        // fix across the Rounded* family.
        border.color: Theme.mutedText
    }

    // Real, 2026-08-10 ("I tested the other timezone and it shows the list, but the
    // letters are difficult to read, the grey is a little soft") - this file's own header
    // comment originally left the popup's delegate as "the platform default" on purpose
    // (couldn't be visually verified without a live tester); now confirmed live that the
    // Basic style's own default delegate text pulls an OS-palette grey, not Theme.text -
    // the same root cause as every other Rounded* fix tonight, just not caught until a
    // long (599-entry) list made it obvious.
    delegate: ItemDelegate {
        width: root.popup.width
        highlighted: root.highlightedIndex === index
        contentItem: Text {
            // Works for both existing call sites: a plain string-list model (this file's own
            // new timezone picker, no textRole set) and an object-list model with textRole
            // (SettingsPage.qml's own usages, e.g. textRole: "label").
            text: root.textRole ? model[root.textRole] : modelData
            color: Theme.text
            font.pixelSize: Theme.fontSizeBody
            elide: Text.ElideRight
            verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle {
            color: highlighted ? Theme.primary + "26" : "transparent"
        }
    }
}
