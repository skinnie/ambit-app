import QtQuick
import QtQuick.Controls
import AmbitApp

// Every dialog in this app, themed - real bug, 2026-08-11 (André, on the row picker): "the
// screen that appears has white background and grey letters not being visible, and not
// matching the theme (I am on dark theme, the background should be dark)."
//
// The cause is that a plain QQC2 Dialog draws its background, header and footer from the
// platform Basic style, which is light regardless of what the app is doing - the same class
// of problem the Rounded* components were made for. Fixed in one place rather than per
// dialog so a new dialog cannot reintroduce it.
//
// The `palette` assignments matter as much as the explicit background: the standard buttons
// (Ok/Cancel/Close) are drawn by the style, not by us, and they read their colours from the
// palette. Without these they stayed light-on-light and effectively invisible - exactly the
// symptom André described, one level down from the background itself.
Dialog {
    id: root

    modal: true

    palette.window: Theme.card
    palette.windowText: Theme.text
    palette.base: Theme.card
    palette.text: Theme.text
    palette.button: Theme.card
    palette.buttonText: Theme.primary
    palette.highlight: Theme.primary
    palette.highlightedText: Theme.card
    palette.mid: Theme.mutedText
    palette.dark: Theme.mutedText

    background: Rectangle {
        color: Theme.card
        radius: Theme.radiusCard
        border.width: 1
        border.color: Theme.mutedText
    }

    header: Text {
        text: root.title
        visible: root.title.length > 0
        color: Theme.text
        font.bold: true
        font.pixelSize: Theme.fontSizeBodyLarge
        elide: Text.ElideRight
        padding: Theme.spacingMedium
    }

    // The button row needs its background removed, not just recoloured - real bug, 2026-08-11
    // (André: "on item 5 the bottom borders are not rendering ok"). A DialogButtonBox paints
    // its own opaque, SQUARE-cornered background, and it sits at the very bottom of the
    // dialog - so it covered the rounded background's two bottom corners and the border ran
    // out into a straight edge. Exactly the same shape of fault as the combo-box popup
    // highlight earlier today: a child painting past a rounded parent.
    //
    // Making it transparent lets the dialog's own rounded background show through, so the
    // border closes properly on all four corners. `standardButtons` is forwarded because
    // replacing the footer replaces the box Dialog would have built from it - Dialog still
    // wires accepted/rejected from whatever DialogButtonBox is here.
    footer: DialogButtonBox {
        standardButtons: root.standardButtons
        visible: root.standardButtons !== 0
        background: Rectangle { color: "transparent" }
    }
}
