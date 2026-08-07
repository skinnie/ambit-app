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
            glyph: root.glyph
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
