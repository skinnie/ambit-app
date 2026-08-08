import QtQuick
import AmbitApp

// One glyph from Icons.qml, rendered at a given size/color. `Icon { glyph: Icons.home }`
// everywhere an icon is needed - AMBITAPP_SPEC.md's "Material Symbols Rounded, no emoji, no
// platform-specific icons" rule lives here and nowhere else.
Text {
    id: root
    property alias glyph: root.text
    property int size: 24

    font.family: Icons.fontFamily
    font.pixelSize: size
    color: Theme.text
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
}
