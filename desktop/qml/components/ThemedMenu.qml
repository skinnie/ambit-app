import QtQuick
import QtQuick.Controls
import AmbitApp

// A QtQuick.Controls Menu restyled to the app's rounded-card language (André, 2026-08-16:
// "those dropdown menus, can't we make them square with round corners like all app
// language?"). Same rounded background/border as RoundedComboBox's popup. Pair with
// ThemedMenuItem for the rows. A drop-in for `Menu { ... }`.
Menu {
    id: root
    padding: 4
    implicitWidth: 220

    background: Rectangle {
        radius: Theme.radiusCard
        color: Theme.card
        border.width: 1
        border.color: Theme.mutedText
    }
}
