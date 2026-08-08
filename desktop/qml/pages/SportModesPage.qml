import QtQuick
import QtQuick.Controls
import AmbitApp

// Real, 2026-08-08 ("This weekend we will full debug the two watches and built the apps" -
// full-throttle continuation of the same session's CustomModes work). No longer a future
// placeholder: renaming a mode, editing Autolap/HR limits/pod search, and changing which
// data a display row shows are all real, hardware-confirmed capabilities as of this
// session (custom_modes_andre.md) - CustomModesService wraps the same backend endpoints
// already live-verified over real HTTP. Still gated behind FeatureFlags.sportModes (see
// this file's own git history) so the flag flip stays the single point of "is this ready
// to ship," matching AMBITAPP_SPEC.md's own "no redesign required later" design.
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    // Real, confirmed bits only - see custom_modes_andre.md's "Resolves hrbelt_and_pods"
    // section. Bit 0x0004 is deliberately absent: confirmed present on the reference
    // watch's own baseline but never isolated to one specific pod, so there's nothing
    // honest to label it with.
    readonly property var podBits: [
        { bit: 0x0001, label: qsTr("HR belt") },
        { bit: 0x0040, label: qsTr("Power pod") },
        { bit: 0x0100, label: qsTr("Foot pod") },
        { bit: 0x0800, label: qsTr("Bike pod") },
    ]

    Component.onCompleted: {
        CustomModesService.refreshFieldTypes()
        CustomModesService.refresh()
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 560
        spacing: Theme.spacingMedium

        Row {
            width: parent.width
            Text { text: qsTr("Sport Modes"); font.bold: true; font.pixelSize: 18; color: Theme.text }
        }

        Text {
            visible: CustomModesService.loading && CustomModesService.modes.length === 0
            color: Theme.mutedText
            text: qsTr("Reading sport modes off the watch...")
        }

        Text {
            visible: !CustomModesService.ok && CustomModesService.lastError.length > 0
            width: parent.width
            wrapMode: Text.WordWrap
            color: Theme.error
            font.pixelSize: 12
            text: CustomModesService.lastError
        }

        Repeater {
            model: CustomModesService.modes
            delegate: Card {
                id: modeCard
                width: column.width
                required property var modelData
                readonly property bool busy: CustomModesService.writingMode === modelData.name
                readonly property bool expanded: expandBtn.checked

                Column {
                    width: parent.width
                    spacing: Theme.spacingMedium

                    // --- Header: name (editable), expand toggle ---
                    Row {
                        width: parent.width
                        spacing: Theme.spacingSmall

                        TextField {
                            id: nameField
                            width: 200
                            enabled: !modeCard.busy
                            // Real bug, found 2026-08-09 from a live screenshot ("strange
                            // characters" in a mode's name field, even though the real
                            // watch data was confirmed clean by reading it directly): a
                            // plain `text: modeCard.modelData.name` binding plus an
                            // imperative `nameField.text = ...` inside a Connections
                            // handler is a real QML footgun - the FIRST imperative
                            // assignment permanently severs the declarative binding (QML
                            // property bindings are one-shot-broken by direct assignment,
                            // not re-established), so `text` becomes a dead, non-reactive
                            // value from then on. If that assignment happened to run during
                            // a moment the Repeater's model was mid-refresh (modelData
                            // transiently stale/undefined), whatever it grabbed got frozen
                            // in forever, with no further refresh ever able to fix it - the
                            // real mechanism behind the garbled name. Fixed with a proper
                            // `Binding` element instead, which re-evaluates/re-applies
                            // correctly on every change rather than dying after one direct
                            // assignment - same "don't type in this exact field right now"
                            // guard, correctly reactive this time.
                            Binding {
                                target: nameField
                                property: "text"
                                value: modeCard.modelData.name
                                when: !nameField.activeFocus
                            }
                        }
                        Button {
                            text: qsTr("Rename")
                            enabled: !modeCard.busy && nameField.text.length > 0
                                     && nameField.text !== modeCard.modelData.name
                            onClicked: CustomModesService.renameMode(modeCard.modelData.name, nameField.text)
                        }
                        Item { width: 1; height: 1 }
                        Button {
                            id: expandBtn
                            checkable: true
                            text: checked ? qsTr("Hide details") : qsTr("Edit")
                        }
                        Text {
                            visible: modeCard.busy
                            anchors.verticalCenter: parent.verticalCenter
                            text: qsTr("saving...")
                            color: Theme.mutedText
                            font.pixelSize: 11
                            font.italic: true
                        }
                    }

                    // --- Details: Autolap / HR limits / pods / displays ---
                    Column {
                        width: parent.width
                        spacing: Theme.spacingMedium
                        visible: modeCard.expanded

                        // --- Autolap ---
                        Column {
                            spacing: 2
                            Text { text: qsTr("Autolap (m, 0 = off)"); color: Theme.mutedText; font.pixelSize: 12 }
                            Row {
                                spacing: 6
                                TextField {
                                    id: autolapField
                                    width: 80
                                    validator: IntValidator { bottom: 0; top: 100000 }
                                    text: modeCard.modelData.autolap
                                    enabled: !modeCard.busy
                                }
                                Button {
                                    text: qsTr("Set")
                                    enabled: !modeCard.busy && autolapField.text !== String(modeCard.modelData.autolap)
                                    onClicked: CustomModesService.writeField(modeCard.modelData.name,
                                        { "Autolap": parseInt(autolapField.text || "0") })
                                }
                            }
                        }

                        // --- HR limits ---
                        Row {
                            width: parent.width
                            spacing: Theme.spacingLarge

                            Column {
                                spacing: 2
                                Text { text: qsTr("HR limits"); color: Theme.mutedText; font.pixelSize: 12 }
                                Row {
                                    spacing: 6
                                    Switch {
                                        id: hrLimitsSwitch
                                        checked: modeCard.modelData.hrLimitsUse === 1
                                        enabled: !modeCard.busy
                                    }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: qsTr("enabled")
                                        color: Theme.text
                                        font.pixelSize: 12
                                    }
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: qsTr("Low (bpm)"); color: Theme.mutedText; font.pixelSize: 12 }
                                TextField {
                                    id: hrLowField
                                    width: 70
                                    validator: IntValidator { bottom: 0; top: 255 }
                                    text: modeCard.modelData.hrLow
                                    enabled: !modeCard.busy
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: qsTr("High (bpm)"); color: Theme.mutedText; font.pixelSize: 12 }
                                TextField {
                                    id: hrHighField
                                    width: 70
                                    validator: IntValidator { bottom: 0; top: 255 }
                                    text: modeCard.modelData.hrHigh
                                    enabled: !modeCard.busy
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: " "; font.pixelSize: 12 }  // vertical alignment spacer
                                Button {
                                    text: qsTr("Set")
                                    enabled: !modeCard.busy
                                    onClicked: CustomModesService.writeField(modeCard.modelData.name, {
                                        "HrLow": parseInt(hrLowField.text || "0"),
                                        "HrHigh": parseInt(hrHighField.text || "0"),
                                        "HrLimitsUse": hrLimitsSwitch.checked ? 1 : 0,
                                    })
                                }
                            }
                        }

                        // --- Pods (UseHw bitmask) ---
                        Column {
                            width: parent.width
                            spacing: 4
                            Text { text: qsTr("Pods"); color: Theme.mutedText; font.pixelSize: 12 }
                            Row {
                                spacing: Theme.spacingMedium
                                Repeater {
                                    model: root.podBits
                                    delegate: Row {
                                        id: podRow
                                        required property var modelData
                                        spacing: 4
                                        CheckBox {
                                            checked: (modeCard.modelData.useHw & podRow.modelData.bit) !== 0
                                            enabled: !modeCard.busy
                                            onToggled: {
                                                const newUseHw = checked
                                                    ? (modeCard.modelData.useHw | podRow.modelData.bit)
                                                    : (modeCard.modelData.useHw & ~podRow.modelData.bit)
                                                CustomModesService.writeField(modeCard.modelData.name,
                                                    { "UseHw": newUseHw })
                                            }
                                        }
                                        Text {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: podRow.modelData.label
                                            color: Theme.text
                                            font.pixelSize: 12
                                        }
                                    }
                                }
                            }
                        }

                        // --- Displays: which data each row shows. Real, live-confirmed
                        // 2026-08-08: "type" (not "index") is the actual content selector
                        // for the common case every real display uses - see
                        // CustomModesService's own header comment. ---
                        Column {
                            width: parent.width
                            spacing: Theme.spacingSmall
                            Text {
                                text: qsTr("Displays (%1)").arg(modeCard.modelData.displays.length)
                                color: Theme.mutedText
                                font.pixelSize: 12
                            }
                            Repeater {
                                model: modeCard.modelData.displays
                                delegate: Column {
                                    id: dispCol
                                    required property var modelData
                                    width: parent.width
                                    spacing: 2
                                    Text {
                                        text: qsTr("Screen %1 - %2").arg(dispCol.modelData.index).arg(dispCol.modelData.templateLabel)
                                        color: Theme.mutedText
                                        font.pixelSize: 11
                                    }
                                    Repeater {
                                        model: dispCol.modelData.fields
                                        delegate: Row {
                                            id: fieldRow
                                            required property var modelData
                                            spacing: 6
                                            Text {
                                                width: 90
                                                anchors.verticalCenter: parent.verticalCenter
                                                text: fieldRow.modelData.field === 0 ? qsTr("Top")
                                                    : fieldRow.modelData.field === 1 ? qsTr("Middle") : qsTr("Bottom")
                                                color: Theme.text
                                                font.pixelSize: 12
                                            }
                                            ComboBox {
                                                id: typeCombo
                                                width: 260
                                                model: CustomModesService.fieldTypes
                                                // Real, 2026-08-09 ("shows the variable
                                                // names, can't we have the normal names?") -
                                                // textRole shows the human label, but the
                                                // write below must still send the real raw
                                                // FIELD_TYPES name (custom_modes.py's own
                                                // --type resolver only knows those, not the
                                                // display labels) - CustomModesService.
                                                // fieldTypes[currentIndex].name, not
                                                // textAt(currentIndex).
                                                textRole: "label"
                                                valueRole: "value"
                                                enabled: !modeCard.busy
                                                currentIndex: {
                                                    for (let i = 0; i < CustomModesService.fieldTypes.length; i++) {
                                                        if (CustomModesService.fieldTypes[i].value === fieldRow.modelData.type) return i;
                                                    }
                                                    return -1;
                                                }
                                                onActivated: {
                                                    if (currentValue === fieldRow.modelData.type) return;
                                                    CustomModesService.writeDisplayField(
                                                        modeCard.modelData.name, dispCol.modelData.index,
                                                        fieldRow.modelData.field,
                                                        CustomModesService.fieldTypes[currentIndex].name)
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
