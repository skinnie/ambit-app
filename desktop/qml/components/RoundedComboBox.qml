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
        // Same rounded-square shape as RoundedTextField (radiusSmall, not radiusCard) and the
        // same focus-border growth - a dropdown is an input control, so it should read as one,
        // matching the text fields it sits beside (André, 2026-08-13).
        radius: Theme.radiusSmall
        color: Theme.card
        border.width: root.activeFocus ? 2 : 1
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
            // Real bug, found 2026-08-10 (André: "the drop down menus don't show values")
            // - this was `model[root.textRole]`, and the comment above it claimed to work
            // for both call sites while only the string-list one had ever been looked at
            // live. For a variant-list model (which is exactly what SettingsWriteService
            // hands over: a QVariantList of {value, label} maps) the delegate exposes the
            // row as `modelData`, not `model`, so `model["label"]` was undefined and every
            // popup row rendered BLANK. The closed box looked right the whole time because
            // it uses root.displayText, which ComboBox resolves internally from textRole -
            // so the values were always read correctly off the watch; only the open
            // popup's labels were missing. Tries modelData first (variant/object list),
            // falls back to model (a real QML ListModel, where modelData is undefined).
            text: {
                if (!root.textRole)
                    return modelData;
                if (modelData !== undefined && modelData !== null
                        && modelData[root.textRole] !== undefined)
                    return modelData[root.textRole];
                return model[root.textRole];
            }
            color: Theme.text
            font.pixelSize: Theme.fontSizeBody
            elide: Text.ElideRight
            verticalAlignment: Text.AlignVCenter
        }
        // Real bug, 2026-08-11 (André, S5): this was a square Rectangle filling the whole
        // delegate, so on the FIRST and LAST rows its corners stuck out past the popup's own
        // rounded border and the selection read as a rectangle pasted onto a rounded box.
        // Rounding the highlight and insetting it by the border width keeps it inside the
        // popup's shape on every row - no clipping or layer effect needed, which matters on
        // this project's old hardware.
        background: Rectangle {
            anchors.fill: parent
            anchors.margins: 2
            radius: Theme.radiusCard
            color: highlighted ? Theme.primary + "26" : "transparent"
        }
    }
}
