import QtQuick
import AmbitApp

// One row in NavRail.qml - icon, label, and its own selected/hover state. Split out from
// NavRail itself so Sport Modes (hidden behind FeatureFlags.sportModes) is just one more
// instance of this, not a special case.
Rectangle {
    id: root

    signal clicked

    property string glyph
    property string label
    property bool selected: false
    // Real, 2026-08-08 (Intervals nav entry): set true to swap the Material Symbols glyph
    // for IntervalsIcon - the same "two icons, one visible" pattern HomePage.qml's own Ambit/
    // Garmin hero icon already uses, rather than a generic Component-swap mechanism for what
    // is, so far, exactly one non-glyph nav icon.
    property bool useIntervalsIcon: false

    implicitHeight: 44
    radius: Theme.radiusSmall
    color: selected ? Theme.primary : (hoverHandler.hovered ? Theme.card : "transparent")

    HoverHandler { id: hoverHandler }
    TapHandler { onTapped: root.clicked() }

    Row {
        anchors.left: parent.left
        anchors.leftMargin: Theme.spacingMedium
        anchors.verticalCenter: parent.verticalCenter
        spacing: Theme.spacingSmall

        Icon {
            visible: !root.useIntervalsIcon
            glyph: root.glyph
            size: 20
            color: root.selected ? Theme.card : Theme.text
            anchors.verticalCenter: parent.verticalCenter
        }
        IntervalsIcon {
            visible: root.useIntervalsIcon
            size: 20
            color: root.selected ? Theme.card : Theme.text
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            text: root.label
            color: root.selected ? Theme.card : Theme.text
            font.pixelSize: 14
            anchors.verticalCenter: parent.verticalCenter
        }
    }
}
