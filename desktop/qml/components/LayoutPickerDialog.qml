import QtQuick
import QtQuick.Controls
import AmbitApp

// Pick a display's layout by looking at it - André's own suggestion, 2026-08-11, following
// SuuntoLink: "you click the display to select if 3 data fields, 2 data fields, 1 data field,
// Graph, this being made on a little window that opens and show visually how they look. If it
// is an empty display, you click (which means, add display) and then the same opens."
//
// One dialog serves both: `displayIndex >= 0` changes that display's layout, `-1` adds a new
// one with the chosen layout and selects it. That replaced a row of four type buttons plus a
// separate Add button, and removed the state where Add sat next to a filled display doing
// nothing.
ThemedDialog {
    id: root

    // -1 means "add a new display with this layout".
    property int displayIndex: -1
    property int currentTemplateId: -1
    property var types: []

    // Chosen layout key ("3-row" / "2-row" / "1-row" / "graph"), and whether it is an add.
    signal layoutChosen(int displayIndex, string typeKey)

    title: displayIndex >= 0 ? qsTr("Display layout") : qsTr("Add a display")
    standardButtons: Dialog.Cancel
    width: 420

    function openFor(index) {
        displayIndex = index
        open()
    }

    contentItem: Column {
        spacing: Theme.spacingMedium

        Text {
            width: parent.width
            wrapMode: Text.WordWrap
            text: root.displayIndex >= 0
                ? qsTr("Choose how this display is laid out.")
                : qsTr("Choose the layout for the new display.")
            color: Theme.mutedText
            font.pixelSize: Theme.fontSizeBody
        }

        // The four layouts drawn as the watch draws them, rather than named in a button.
        Grid {
            columns: 2
            spacing: Theme.spacingMedium

            Repeater {
                model: root.types
                delegate: Column {
                    id: option
                    required property var modelData
                    spacing: 4

                    WatchFacePreview {
                        diameter: 96
                        layoutType: option.modelData.preview
                        selected: option.modelData.templateId === root.currentTemplateId
                        TapHandler {
                            onTapped: {
                                root.layoutChosen(root.displayIndex, option.modelData.key)
                                root.close()
                            }
                        }
                    }
                    Text {
                        width: 96
                        horizontalAlignment: Text.AlignHCenter
                        text: option.modelData.label
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeCaption
                    }
                }
            }
        }
    }
}
