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

    // Real, 2026-08-09 ("Implement the sport modes like suunto link") - SuuntoLink's own
    // real Sport Modes list (assets/ambit3 pcap/v2/screens sports modes/sportsmodes.JPG)
    // gives every mode a colored circular badge. This app's real CustomModes data has no
    // sport-category/color field of its own to read (each mode is just a free-text name -
    // custom_modes_andre.md) - this table is a presentational-only convenience keyed on
    // this reference watch's own real mode names (confirmed identical to SuuntoLink's own
    // defaults: Cycling/Indoor training/Pool swimming/Run a route/Running/Trekking/Walk),
    // not a hardware-confirmed per-mode field. Deliberately reuses Theme's existing named
    // colors rather than inventing new hex swatches (this app's own "never hardcode colors"
    // rule), and Icons.sportModes for every badge rather than per-sport glyphs - Material
    // Symbols Rounded is subset to only the codepoints this app actually uses (see
    // assets/fonts/NOTICE.md), and adding real per-sport icons would mean fetching real
    // codepoints from Google's own repo and regenerating that font, a real but separate
    // undertaking not worth bundling into this pass. A renamed/custom mode not in this
    // table falls back to Theme.primary rather than guessing.
    readonly property var _sportBadgeColors: ({
        "Cycling": Theme.warning,
        "Indoor training": Theme.error,
        "Pool swimming": Theme.primary,
        "Run a route": Theme.accent,
        "Running": Theme.accent,
        "Trekking": Theme.success,
        "Walk": Theme.success,
    })
    function sportBadgeColor(name) {
        return _sportBadgeColors[name] || Theme.primary
    }

    // Real, 2026-08-09 ("sport mode return bad gateway") - the connected watch had become
    // Kailash, which genuinely has no CustomModes region at all (confirmed empty - see
    // custom_modes_andre.md's Kailash section), so custom_modes.py's own real flash read
    // fails with a real, correct hardware error (0x0b17 short reply) - a genuine "this watch
    // doesn't have this," not a bug, but showing that as a raw 502 is still wrong. NavRail
    // already hides this page's own nav entry for Kailash, but that alone doesn't cover
    // reaching this page some other way (open before a cable swap, deep navigation) - guard
    // here too, and directly, rather than trusting the nav item to always be the only way in.
    Component.onCompleted: {
        if (HomeViewModel.isKailash) return
        CustomModesService.refreshFieldTypes()
        CustomModesService.refresh()
        // Real, 2026-08-09 ("check if meters or imperial or advanced, and how the watch
        // deals with it") - needed for the real-unit Autolap display below. Explicit ""
        // (Ambit3) rather than trusting SettingsWriteService.device's already-set value -
        // this is a shared singleton, and a prior visit to Settings while a Kailash was
        // connected could otherwise leave it pointed at Kailash's own smaller table.
        SettingsWriteService.device = ""
        SettingsWriteService.refresh()
    }

    // Real, 2026-08-09 ("Autolap...let's make mit more elegant with a toggle => off or
    // when on value in the units of the watch (check if meters or imperial or advanced,
    // and how the watch deals with it)"). Units.Mode is the real master switch
    // (0=Metric, 1=Imperial, 2=Advanced, schema-confirmed) - Metric/Imperial force every
    // individual unit to follow the master choice; only in Advanced does the watch's own
    // separate Units.Distance (0=km, 1=mi) actually apply. Falls back to km (Metric) if
    // settings haven't loaded yet rather than showing nothing.
    function _settingValue(key, fallback) {
        for (const s of SettingsWriteService.settings) {
            if (s.key === key) return s.value
        }
        return fallback
    }
    readonly property bool autolapUsesMiles: {
        const mode = _settingValue("units_mode", 0)
        if (mode === 1) return true
        if (mode === 2) return _settingValue("distance_unit", 0) === 1
        return false
    }
    readonly property real autolapUnitDivisor: autolapUsesMiles ? 1609.344 : 1000
    readonly property string autolapUnitSuffix: autolapUsesMiles ? qsTr("mi") : qsTr("km")

    Text {
        visible: HomeViewModel.isKailash
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 560
        wrapMode: Text.WordWrap
        color: Theme.mutedText
        text: qsTr("Sport Modes isn't available on Kailash - it has no CustomModes region on this watch at all.")
    }

    Column {
        id: column
        visible: !HomeViewModel.isKailash
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 560
        spacing: Theme.spacingMedium

        Row {
            width: parent.width
            Text { text: qsTr("Sport Modes"); font.bold: true; font.pixelSize: Theme.fontSizeTitle; color: Theme.text }
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
            font.pixelSize: Theme.fontSizeLabel
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

                    // --- Header: real SuuntoLink-list-row shape (colored circular badge +
                    // name + screen count on the left, actions on the right) - see
                    // root._sportBadgeColors' own comment for what the badge color is (and
                    // isn't) based on. Renaming moved into the expanded Details section
                    // below (was inline here before) so this collapsed row stays as close
                    // to SuuntoLink's own minimal list look as this app's real edit
                    // capabilities allow. ---
                    Item {
                        width: parent.width
                        height: 44

                        Row {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Theme.spacingMedium

                            Rectangle {
                                width: 44; height: 44; radius: 22
                                color: root.sportBadgeColor(modeCard.modelData.name)
                                anchors.verticalCenter: parent.verticalCenter
                                Icon { anchors.centerIn: parent; glyph: Icons.sportModes; size: 22; color: Theme.card }
                            }

                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 2
                                Text {
                                    text: modeCard.modelData.name
                                    font.bold: true
                                    font.pixelSize: Theme.fontSizeBodyLarge
                                    color: Theme.text
                                }
                                Text {
                                    text: qsTr("%1 screen(s)").arg(modeCard.modelData.displays.length)
                                    color: Theme.mutedText
                                    font.pixelSize: Theme.fontSizeCaption
                                }
                            }
                        }

                        Row {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Theme.spacingSmall

                            Text {
                                visible: modeCard.busy
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("saving...")
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeCaption
                                font.italic: true
                            }
                            RoundedButton {
                                id: expandBtn
                                checkable: true
                                anchors.verticalCenter: parent.verticalCenter
                                text: checked ? qsTr("Hide details") : qsTr("Edit")
                            }
                        }
                    }

                    // --- Details: name / Autolap / HR limits / pods / displays ---
                    Column {
                        width: parent.width
                        spacing: Theme.spacingMedium
                        visible: modeCard.expanded

                        // --- Name (moved here from the collapsed header row, real
                        // 2026-08-09 - see the header Item's own comment) ---
                        Column {
                            width: parent.width
                            spacing: 2
                            Text { text: qsTr("Name"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                            Row {
                                spacing: 6
                                RoundedTextField {
                                    id: nameField
                                    width: 200
                                    enabled: !modeCard.busy
                                    // Real bug, found 2026-08-09 from a live screenshot
                                    // ("strange characters" in a mode's name field, even
                                    // though the real watch data was confirmed clean by
                                    // reading it directly): a plain
                                    // `text: modeCard.modelData.name` binding plus an
                                    // imperative `nameField.text = ...` inside a
                                    // Connections handler is a real QML footgun - the FIRST
                                    // imperative assignment permanently severs the
                                    // declarative binding (QML property bindings are
                                    // one-shot-broken by direct assignment, not
                                    // re-established), so `text` becomes a dead,
                                    // non-reactive value from then on. If that assignment
                                    // happened to run during a moment the Repeater's model
                                    // was mid-refresh (modelData transiently stale/
                                    // undefined), whatever it grabbed got frozen in
                                    // forever, with no further refresh ever able to fix it -
                                    // the real mechanism behind the garbled name. Fixed with
                                    // a proper `Binding` element instead, which
                                    // re-evaluates/re-applies correctly on every change
                                    // rather than dying after one direct assignment - same
                                    // "don't type in this exact field right now" guard,
                                    // correctly reactive this time.
                                    Binding {
                                        target: nameField
                                        property: "text"
                                        value: modeCard.modelData.name
                                        when: !nameField.activeFocus
                                    }
                                }
                                RoundedButton {
                                    text: qsTr("Rename")
                                    enabled: !modeCard.busy && nameField.text.length > 0
                                             && nameField.text !== modeCard.modelData.name
                                    onClicked: CustomModesService.renameMode(modeCard.modelData.name, nameField.text)
                                }
                            }
                        }

                        // --- Autolap - real, 2026-08-09 ("let's make mit more elegant
                        // with a toggle => off or when on value in the units of the
                        // watch"). The raw field is still real meters, 0=off (unchanged,
                        // confirmed via SuuntoLink's own real Autolap screen - assets/
                        // ambit3 pcap/v2/screens sports modes/autolap.JPG, a plain "Use
                        // autolap" checkbox + a distance shown in the real unit, "1.0 km"
                        // there) - this only changes how it's presented: a toggle instead
                        // of a raw-meters text field, and the value converted to/from
                        // whichever unit root.autolapUnitSuffix says the watch is
                        // actually configured for (see that property's own comment). ---
                        Column {
                            spacing: 2
                            Text { text: qsTr("Autolap"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                            Row {
                                spacing: 6
                                RoundedSwitch {
                                    id: autolapSwitch
                                    anchors.verticalCenter: parent.verticalCenter
                                    enabled: !modeCard.busy
                                    // A plain `checked: ...` binding here would suffer the
                                    // exact same footgun the Name field's own comment
                                    // documents (AbstractButton's click-handling assigns
                                    // `checked` itself, one-shot-breaking a declarative
                                    // binding) - a real risk for any interactive
                                    // checked/text property, not just TextField.text.
                                    Binding {
                                        target: autolapSwitch
                                        property: "checked"
                                        value: modeCard.modelData.autolap > 0
                                    }
                                    onToggled: {
                                        if (checked) {
                                            // SuuntoLink's own real Autolap screen shows
                                            // "1.0" as its example value when enabling -
                                            // used as the real default here too, in
                                            // whichever unit the watch is actually in.
                                            CustomModesService.writeField(modeCard.modelData.name,
                                                { "Autolap": Math.round(1 * root.autolapUnitDivisor) })
                                        } else {
                                            CustomModesService.writeField(modeCard.modelData.name,
                                                { "Autolap": 0 })
                                        }
                                    }
                                }
                                RoundedTextField {
                                    id: autolapField
                                    visible: autolapSwitch.checked
                                    width: 70
                                    enabled: !modeCard.busy
                                    validator: DoubleValidator {
                                        bottom: 0; decimals: 2
                                        notation: DoubleValidator.StandardNotation
                                    }
                                    Binding {
                                        target: autolapField
                                        property: "text"
                                        value: (modeCard.modelData.autolap / root.autolapUnitDivisor).toFixed(2)
                                        when: !autolapField.activeFocus
                                    }
                                }
                                Text {
                                    visible: autolapSwitch.checked
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: root.autolapUnitSuffix
                                    color: Theme.mutedText
                                    font.pixelSize: Theme.fontSizeLabel
                                }
                                RoundedButton {
                                    visible: autolapSwitch.checked
                                    text: qsTr("Set")
                                    enabled: !modeCard.busy
                                    onClicked: {
                                        const parsed = parseFloat(autolapField.text);
                                        if (isNaN(parsed) || parsed <= 0) return;
                                        CustomModesService.writeField(modeCard.modelData.name,
                                            { "Autolap": Math.round(parsed * root.autolapUnitDivisor) })
                                    }
                                }
                            }
                        }

                        // --- HR limits ---
                        Row {
                            width: parent.width
                            spacing: Theme.spacingLarge

                            Column {
                                spacing: 2
                                Text { text: qsTr("HR limits"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                                Row {
                                    spacing: 6
                                    RoundedSwitch {
                                        id: hrLimitsSwitch
                                        checked: modeCard.modelData.hrLimitsUse === 1
                                        enabled: !modeCard.busy
                                    }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: qsTr("enabled")
                                        color: Theme.text
                                        font.pixelSize: Theme.fontSizeLabel
                                    }
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: qsTr("Low (bpm)"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                                RoundedTextField {
                                    id: hrLowField
                                    width: 70
                                    validator: IntValidator { bottom: 0; top: 255 }
                                    text: modeCard.modelData.hrLow
                                    enabled: !modeCard.busy
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: qsTr("High (bpm)"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                                RoundedTextField {
                                    id: hrHighField
                                    width: 70
                                    validator: IntValidator { bottom: 0; top: 255 }
                                    text: modeCard.modelData.hrHigh
                                    enabled: !modeCard.busy
                                }
                            }
                            Column {
                                spacing: 2
                                Text { text: " "; font.pixelSize: Theme.fontSizeLabel }  // vertical alignment spacer
                                RoundedButton {
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
                            Text { text: qsTr("Pods"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                            Row {
                                spacing: Theme.spacingMedium
                                Repeater {
                                    model: root.podBits
                                    delegate: Row {
                                        id: podRow
                                        required property var modelData
                                        spacing: 4
                                        RoundedCheckBox {
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
                                            font.pixelSize: Theme.fontSizeLabel
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
                                font.pixelSize: Theme.fontSizeLabel
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
                                        font.pixelSize: Theme.fontSizeCaption
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
                                                font.pixelSize: Theme.fontSizeLabel
                                            }
                                            RoundedComboBox {
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
