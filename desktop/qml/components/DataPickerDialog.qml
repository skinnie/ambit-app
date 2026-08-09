import QtQuick
import QtQuick.Controls
import AmbitApp

// Real, 2026-08-09 ("Full SuuntoLink-style redesign") - matches SuuntoLink's own real
// "SELECT DATA FOR ROW" screen (assets/ambit3 pcap/v2/screens sports modes/
// display1row1graphoptions.JPG): a searchable list of built-in field types, plus a real
// "Suunto Apps" section - search this app's own bundled catalog (AppsService) and install
// directly onto this exact display/field slot. Both write paths already existed
// separately (CustomModesService.writeDisplayField for built-in types,
// AppsService.install for catalog apps) - this dialog is the one real place a user picks
// between them, matching SuuntoLink's own single combined screen.
Dialog {
    id: root
    title: qsTr("Select Data")
    modal: true
    width: 420
    height: 560
    standardButtons: Dialog.Close

    property string modeName: ""
    property int modeIndex: -1
    property int displayIndex: -1
    property int fieldIndex: -1

    onOpened: {
        fieldSearchField.text = ""
        appSearchField.text = ""
        AppsService.searchCatalog("", DeviceService.model, -1)
    }

    Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.height
        clip: true

        Column {
            id: contentColumn
            width: parent.width
            spacing: Theme.spacingMedium

            // --- Built-in field types ---
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Text { text: qsTr("Field types"); font.bold: true; color: Theme.text }
                RoundedTextField {
                    id: fieldSearchField
                    width: parent.width
                    placeholderText: qsTr("Search field types...")
                }
                Repeater {
                    model: {
                        const q = fieldSearchField.text.trim().toLowerCase()
                        const all = CustomModesService.fieldTypes
                        if (!q) return all
                        return all.filter(f => f.label.toLowerCase().indexOf(q) >= 0)
                    }
                    delegate: Item {
                        id: typeRow
                        required property var modelData
                        width: contentColumn.width
                        height: 32
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: typeRow.modelData.label
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                        }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: {
                                CustomModesService.writeDisplayField(
                                    root.modeName, root.displayIndex, root.fieldIndex,
                                    typeRow.modelData.name)
                                root.close()
                            }
                        }
                    }
                }
            }

            // --- Suunto Apps - real, 2026-08-09 ("2 bigger. Let's ship the full
            // catalog"). Filtered to whichever watch variant is actually connected
            // (compatibleVariants - see extract_apps_catalog.py's own comment on where
            // that real data comes from). ---
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Text { text: qsTr("Suunto Apps"); font.bold: true; color: Theme.text }
                RoundedTextField {
                    id: appSearchField
                    width: parent.width
                    placeholderText: qsTr("Search Suunto Apps...")
                    onTextChanged: AppsService.searchCatalog(text, DeviceService.model, -1)
                }
                Text {
                    visible: AppsService.searching
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Searching...")
                }
                Text {
                    visible: !AppsService.searching && AppsService.searchResults.length === 0
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("No matching apps.")
                }
                Repeater {
                    model: AppsService.searchResults
                    delegate: Column {
                        id: appRow
                        required property var modelData
                        width: contentColumn.width
                        spacing: 2
                        Text {
                            text: appRow.modelData.name
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                            font.bold: true
                        }
                        Text {
                            width: parent.width
                            visible: text.length > 0
                            text: appRow.modelData.description || ""
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeCaption
                            wrapMode: Text.WordWrap
                            maximumLineCount: 2
                            elide: Text.ElideRight
                        }
                        MouseArea {
                            width: parent.width
                            height: 40
                            onClicked: {
                                AppsService.install(root.modeIndex, root.displayIndex,
                                                     root.fieldIndex, appRow.modelData.ruleId, true)
                                root.close()
                            }
                        }
                    }
                }
            }
        }
    }
}
