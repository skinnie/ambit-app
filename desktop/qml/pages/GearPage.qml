import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import AmbitApp

// Gear tracker (v3, desktop) — parity with Android. Imports bikes/shoes + components + service
// reminders from intervals.icu (GearService) and lets you edit them (write-through: each edit
// pushes to intervals.icu then re-imports). Reminder due-ness is computed LOCALLY. No device
// gating — it's about your gear, not the connected watch.
Item {
    id: root

    readonly property var allGear: GearService.gears
    function topOfType(t) {
        return allGear.filter(function (g) { return !g.parentId && g.type.toLowerCase().indexOf(t) === 0 })
    }
    function partsOf(id) {
        return allGear.filter(function (g) { return g.parentId === id })
    }
    readonly property var bikes: topOfType("bike")
    readonly property var shoes: topOfType("shoe")

    // Default gear per decoded sport (D2-c/D2-a). Sport names match ActivityTypes' decoded names.
    readonly property var sportList: ["Running", "Trail running", "Cycling", "Mountain biking",
                                      "Indoor cycling", "Walking", "Trekking", "Orienteering"]
    function gearChoices() {
        var out = [{ text: qsTr("None"), id: "" }]
        for (var i = 0; i < allGear.length; ++i) {
            var g = allGear[i]
            if (!g.parentId && !g.retired) out.push({ text: g.name, id: g.id })
        }
        return out
    }
    function assignedIndex(sport, choices) {
        var id = GearService.assignments[sport] || ""
        for (var i = 0; i < choices.length; ++i) if (choices[i].id === id) return i
        return 0
    }

    // ── Small input dialogs (name / reminder / confirm) ──
    function askName(title, initial, cb) {
        nameDialog.title = title; nameField.text = initial; nameDialog.cb = cb
        nameDialog.open(); nameField.forceActiveFocus(); nameField.selectAll()
    }
    function askReminder(gearId) {
        remDialog.gearId = gearId; remName.text = ""; remValue.text = ""; remUnit.currentIndex = 0
        remDialog.open()
    }
    function confirmDelete(id, name) {
        confirmDialog.gearId = id; confirmLabel.text = qsTr("Delete “%1” from Intervals.icu?").arg(name)
        confirmDialog.open()
    }

    Dialog {
        id: nameDialog
        property var cb: null
        anchors.centerIn: Overlay.overlay
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        TextField { id: nameField; implicitWidth: 320; onAccepted: nameDialog.accept() }
        onAccepted: { if (cb && nameField.text.trim().length > 0) cb(nameField.text.trim()); cb = null }
    }

    Dialog {
        id: remDialog
        property string gearId: ""
        title: qsTr("Add reminder")
        anchors.centerIn: Overlay.overlay
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        ColumnLayout {
            spacing: Theme.spacingSmall
            TextField { id: remName; implicitWidth: 320; placeholderText: qsTr("Name (e.g. check chain)") }
            RowLayout {
                TextField { id: remValue; Layout.fillWidth: true; placeholderText: qsTr("Every…"); inputMethodHints: Qt.ImhFormattedNumbersOnly }
                RoundedComboBox { id: remUnit; model: ["km", "h", "days", "activities"]; Layout.preferredWidth: 140 }
            }
        }
        onAccepted: {
            const v = parseFloat(remValue.text) || 0
            GearService.addReminder(gearId, remName.text.trim() || qsTr("Reminder"),
                                    remUnit.currentText === "km" ? v : 0,
                                    remUnit.currentText === "h" ? v : 0,
                                    remUnit.currentText === "days" ? Math.round(v) : 0,
                                    remUnit.currentText === "activities" ? Math.round(v) : 0)
        }
    }

    Dialog {
        id: confirmDialog
        property string gearId: ""
        title: qsTr("Confirm")
        anchors.centerIn: Overlay.overlay
        modal: true
        standardButtons: Dialog.Yes | Dialog.No
        Label { id: confirmLabel }
        onAccepted: GearService.removeGear(gearId)
    }

    Rectangle { anchors.fill: parent; color: Theme.background }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spacingLarge
        spacing: Theme.spacingMedium

        // Header + actions
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacingSmall
            Text {
                text: qsTr("Gear")
                color: Theme.text
                font.pixelSize: Theme.fontSizeTitle
                font.bold: true
                Layout.fillWidth: true
            }
            BusyIndicator { running: GearService.loading; visible: GearService.loading; implicitWidth: 22; implicitHeight: 22 }
            RoundedButton {
                text: qsTr("Add bike")
                enabled: GearService.connected && !GearService.loading
                onClicked: root.askName(qsTr("Add bike"), "", function (n) { GearService.addGear(n, "Bike") })
            }
            RoundedButton {
                text: qsTr("Add shoes")
                enabled: GearService.connected && !GearService.loading
                onClicked: root.askName(qsTr("Add shoes"), "", function (n) { GearService.addGear(n, "Shoes") })
            }
            // Import from Intervals.icu moved to Settings -> Intervals.icu connection
            // (André, 2026-08-18). This page just shows and edits your gear now.
        }

        Text {
            Layout.fillWidth: true
            visible: !GearService.connected
            text: qsTr("Connect Intervals.icu in Settings to import your gear.")
            color: Theme.warning
            wrapMode: Text.WordWrap
        }
        Text {
            Layout.fillWidth: true
            visible: GearService.lastError.length > 0
            text: GearService.lastError
            color: Theme.error
            wrapMode: Text.WordWrap
        }

        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ColumnLayout {
                width: root.width - 2 * Theme.spacingLarge
                spacing: Theme.spacingMedium

                Text {
                    visible: root.allGear.length === 0
                    text: qsTr("No gear yet. Connect Intervals.icu and import, or add one above.")
                    color: Theme.mutedText
                }

                // Default gear per sport — used when attributing an activity's mileage to gear.
                Rectangle {
                    Layout.fillWidth: true
                    visible: root.allGear.length > 0
                    color: Theme.card
                    radius: Theme.radiusCard
                    implicitHeight: defaultsCol.implicitHeight + 2 * Theme.spacingMedium
                    ColumnLayout {
                        id: defaultsCol
                        anchors.fill: parent
                        anchors.margins: Theme.spacingMedium
                        spacing: 4
                        Text { text: qsTr("Default gear per sport"); color: Theme.text; font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge }
                        Repeater {
                            model: root.sportList
                            delegate: RowLayout {
                                required property var modelData
                                Layout.fillWidth: true
                                readonly property var choices: root.gearChoices()
                                Text { Layout.fillWidth: true; text: modelData; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                                RoundedComboBox {
                                    Layout.preferredWidth: 200
                                    model: choices
                                    textRole: "text"
                                    currentIndex: root.assignedIndex(modelData, choices)
                                    onActivated: GearService.setAssignment(modelData, choices[currentIndex].id)
                                }
                            }
                        }
                    }
                }

                Repeater {
                    model: [{ label: qsTr("Bikes"), list: root.bikes }, { label: qsTr("Shoes"), list: root.shoes }]
                    delegate: ColumnLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: Theme.spacingSmall
                        visible: modelData.list.length > 0

                        Text { text: modelData.label; color: Theme.text; font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge }

                        Repeater {
                            model: modelData.list
                            delegate: Rectangle {
                                required property var modelData
                                Layout.fillWidth: true
                                color: Theme.card
                                radius: Theme.radiusCard
                                opacity: modelData.retired ? 0.6 : 1.0
                                implicitHeight: gearCol.implicitHeight + 2 * Theme.spacingMedium

                                ColumnLayout {
                                    id: gearCol
                                    anchors.fill: parent
                                    anchors.margins: Theme.spacingMedium
                                    spacing: 4

                                    RowLayout {
                                        Layout.fillWidth: true
                                        Text {
                                            Layout.fillWidth: true
                                            text: modelData.name + (modelData.retired ? qsTr("  · retired") : "")
                                            color: Theme.text; font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge
                                        }
                                        Text {
                                            text: modelData.distanceKm + " km"
                                                  + (modelData.addedKm > 0 ? qsTr(" (+%1 here)").arg(modelData.addedKm) : "")
                                            color: modelData.addedKm > 0 ? Theme.primary : Theme.mutedText
                                        }
                                    }

                                    // Gear actions
                                    RowLayout {
                                        spacing: Theme.spacingSmall
                                        Button { flat: true; text: qsTr("Rename"); onClicked: root.askName(qsTr("Rename"), modelData.name, function (n) { GearService.renameGear(modelData.id, n) }) }
                                        Button { flat: true; text: modelData.retired ? qsTr("Un-retire") : qsTr("Retire"); onClicked: GearService.setRetired(modelData.id, !modelData.retired) }
                                        Button { flat: true; text: qsTr("Add part"); onClicked: root.askName(qsTr("Add component"), "", function (n) { GearService.addComponent(modelData.id, n, "Other") }) }
                                        Button { flat: true; text: qsTr("Add reminder"); onClicked: root.askReminder(modelData.id) }
                                        Button { flat: true; text: qsTr("Delete"); onClicked: root.confirmDelete(modelData.id, modelData.name) }
                                    }

                                    // Reminders on the gear
                                    Repeater {
                                        model: modelData.reminders
                                        delegate: RowLayout {
                                            required property var modelData
                                            property var parentGear: gearCol.parent.modelData
                                            Text {
                                                Layout.fillWidth: true
                                                text: "⚠ " + modelData.name + " · " + modelData.label
                                                      + (modelData.due ? qsTr(" · due") : modelData.soon ? qsTr(" · soon") : "")
                                                color: modelData.due ? Theme.error : modelData.soon ? Theme.warning : Theme.mutedText
                                                font.pixelSize: Theme.fontSizeCaption
                                            }
                                            Button { flat: true; text: "×"; onClicked: GearService.removeReminder(parentGear.id, modelData.id) }
                                        }
                                    }

                                    // Components (parts)
                                    Repeater {
                                        model: root.partsOf(modelData.id)
                                        delegate: ColumnLayout {
                                            required property var modelData
                                            Layout.fillWidth: true
                                            spacing: 2
                                            RowLayout {
                                                Layout.fillWidth: true
                                                Text { Layout.fillWidth: true; text: "• " + modelData.name; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                                                Button { flat: true; text: qsTr("Add reminder"); onClicked: root.askReminder(modelData.id) }
                                                Button { flat: true; text: qsTr("Delete"); onClicked: root.confirmDelete(modelData.id, modelData.name) }
                                            }
                                            Repeater {
                                                model: modelData.reminders
                                                delegate: RowLayout {
                                                    required property var modelData
                                                    property var parentPart: gearCol.parent.modelData
                                                    Layout.leftMargin: Theme.spacingMedium
                                                    Text {
                                                        Layout.fillWidth: true
                                                        text: "⚠ " + modelData.name + " · " + modelData.label
                                                              + (modelData.due ? qsTr(" · due") : modelData.soon ? qsTr(" · soon") : "")
                                                        color: modelData.due ? Theme.error : modelData.soon ? Theme.warning : Theme.mutedText
                                                        font.pixelSize: Theme.fontSizeCaption
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
