import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 11, the last one. General/Connections/Maps/Weather/Backup/About per the spec.
// Weather's "Manual location" is the one section that's fully real end to end - it's the
// first actual UI consumer of WeatherService's own settable latitude/longitude (built in
// Step 5 specifically so a location source could be swapped "without UI modifications" -
// this is that promise being kept, not a new mechanism).
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    // Real, 2026-08-08 ("Settings on ambit 3 - if they are already cracked to be changed by
    // cable, we will need to build a UI for it"). Cable settings-write is now confirmed
    // working for both the Ambit3 (SettingsWriteService's own header comment: André
    // confirmed Display.Invert visibly switching the watch Light -> Dark) and, checked the
    // same way right after, Kailash too - SettingsWriteService.device picks which curated
    // table the backend uses (see its own header comment). Fetched here so the Settings
    // card below has real data as soon as this page opens, matching how HomePage.qml
    // already fires its own service refreshes from Component.onCompleted.
    Component.onCompleted: {
        if (!HomeViewModel.isGarmin) {
            SettingsWriteService.device = HomeViewModel.isKailash ? "kailash" : "";
            SettingsWriteService.refresh();
        }
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        // Real, 2026-08-09 ("more coherence and simplicity") - was spacingMedium, the same
        // gap used *inside* every card between its own rows - so the whole page read as one
        // undifferentiated stack rather than distinct sections. Larger gap between cards
        // than within them is a real, deliberate hierarchy cue, not a bigger version of the
        // same thing.
        spacing: Theme.spacingLarge

        // --- Appearance - real, 2026-08-10 ("on desktop mode, put the menu on settings for
        // dark mode/system"). Theme.qml's own header comment anticipated exactly this back
        // when `override`/isDark were first built - this is that control, finally wired up.
        // Same RadioButton pattern (autoExclusive:false + onClicked, not checked bindings
        // fighting QQC2's own exclusivity - see the real bug that caused further down in
        // the Maps card) as every other exclusive-choice control on this page. ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.weatherSunny; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Appearance"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    text: qsTr("Choose light or dark, or follow your system setting.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.override === "light"
                        text: qsTr("Light")
                        onClicked: Theme.override = "light"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.override === "dark"
                        text: qsTr("Dark")
                        onClicked: Theme.override = "dark"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.override === "system"
                        text: qsTr("System")
                        onClicked: Theme.override = "system"
                    }
                }

                // André, 2026-08-11 (item 16): "for activities, in settings let's add the
                // option: see as a map, see as a list. the first is the one we already have."
                // Lives here rather than on the Activities page itself so it is a preference
                // that persists, like the theme above, not a toggle to re-set every visit.
                Text {
                    text: qsTr("Activities view")
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                    font.bold: true
                    topPadding: Theme.spacingSmall
                }
                Text {
                    text: qsTr("Cards show each track on a map. The list is lighter and " +
                                "shows more at once.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.activitiesView === "map"
                        text: qsTr("See as a map")
                        onClicked: Theme.activitiesView = "map"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.activitiesView === "list"
                        text: qsTr("See as a list")
                        onClicked: Theme.activitiesView = "list"
                    }
                }
            }
        }

        // --- Testing mode - real request, 2026-08-11 (André): "add on feature on settings:
        // testing mode, where it simulates that an ambit 3 is connected, so people can test
        // it without the watch. for usability could be cool."
        //
        // The backend answers from a real captured CustomModes region, so the whole app -
        // sport modes, the display editor, the row picker - works exactly as it does against
        // hardware, decoder, encoder and round-trip guard included. Edits persist for the
        // session and are thrown away when it ends.
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.watch; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Testing mode"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Pretend an Ambit3 Peak is connected, so you can look around " +
                                "the app without a watch. Changes are made to a sample watch " +
                                "and forgotten when you close the app - nothing is written to " +
                                "a real device.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedSwitch {
                        anchors.verticalCenter: parent.verticalCenter
                        checked: DeviceService.demoMode
                        onToggled: DeviceService.setDemoMode(checked)
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: DeviceService.demoMode ? qsTr("On - showing a sample watch")
                                                     : qsTr("Off")
                        color: DeviceService.demoMode ? Theme.primary : Theme.mutedText
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
            }
        }

        // --- General - Suunto-specific (it's reporting the Python backend bridge's own
        // status, which Garmin support has nothing to do with - GarminService talks
        // directly to a mounted filesystem, no backend involved at all). Real, 2026-08-08:
        // swapped for a plain "Supported devices" card while a Garmin is connected, rather
        // than just hidden outright - own suggestion, in place of showing nothing here. ---
        Card {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                // Real, 2026-08-09 ("This settings page merits supervision by a designer,
                // to have more coherence and simplicity") - every section header on this
                // page used to be a bare bold Text with no explicit size (relying on
                // whatever the platform default happens to be) and no icon, unlike every
                // other headed card in the app (Home's device card, Sport Modes' rows).
                // Standardized to icon + Theme.fontSizeBodyLarge everywhere on this page.
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.settings; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("General"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    text: qsTr("AmbitApp V2 — see AMBITAPP_SPEC.md")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
                Row {
                    spacing: 6
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: HomeViewModel.connectionStatusColor
                    }
                    Text {
                        text: qsTr("Backend: %1").arg(HomeViewModel.connectionStatusText)
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeLabel
                    }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Backend address is fixed to 127.0.0.1:8766 for now - making " +
                                "it configurable needs every Service updated together, not " +
                                "done here (see DeviceService's own comment on this).")
                }
            }
        }
        Card {
            width: parent.width
            visible: HomeViewModel.isGarmin
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.settings; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Supported devices"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Row {
                    spacing: 6
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: Theme.mutedText
                    }
                    Text {
                        text: qsTr("Suunto Ambit 3 (USB, via the local backend)")
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeLabel
                    }
                }
                Row {
                    spacing: 6
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: Theme.success
                    }
                    Text {
                        text: qsTr("Garmin eTrex — connected (%1)").arg(GarminService.model)
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeLabel
                    }
                }
            }
        }

        // --- Watch Settings - real, 2026-08-08. Generic, schema-driven: one delegate per
        // row, picking Switch/ComboBox/Slider off `kind` (bool/enum/number) rather than a
        // hand-built widget per field - SettingsWriteService.settings already carries
        // exactly that shape from tools/settings_write.py's own describe_field(). Writes
        // fire immediately on interaction (no separate confirm step), matching this app's
        // own "an explicit tap/selection in the page itself is the confirmation" rule
        // (DeviceService's GPS-orbit "tap to update" already works this way) - a Settings
        // page toggling immediately, like any OS settings screen, is also the expected UX
        // here, not a new pattern invented for this card. Kailash now included too, real,
        // same day: SettingsWriteService.device (set in Component.onCompleted above) picks
        // Kailash's own separately-curated table (sourced from the real 7R app's own
        // screenshots, not the Ambit3's) - both tables independently hardware-confirmed,
        // see custom_modes_andre.md's "Kailash settings ARE writable over cable too"
        // section. ---
        Card {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            Column {
                id: settingsColumn
                width: parent.width
                spacing: Theme.spacingMedium

                // Real, 2026-08-10: the curated table grew from 18 to 34 fields once the
                // Unit and Personal screens were covered, and one flat run of 34 rows is
                // not a settings screen anyone can use. settings_write.py now reports the
                // `screen` each field lives on - the same three SuuntoLink itself groups
                // them into, which is the grouping the watch's owner already knows - so
                // the grouping needs no second table here to drift out of sync. Fields
                // with no screen (Kailash's whole table, and display_contrast) fall into
                // "other" and are still shown.
                function rowsForScreen(name) {
                    const out = [];
                    for (const s of SettingsWriteService.settings) {
                        if ((s.screen ? s.screen : "other") === name) out.push(s);
                    }
                    return out;
                }

                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.watch; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        // Real, 2026-08-09 ("it says Ambit3 settings, please link this to
                        // the name of the device, since tomorrow we will support more
                        // devices") - was hardcoded to one of two fixed strings; now reads
                        // the real connected device's own name (HomeViewModel.
                        // deviceDisplayName, the same one Home's own device card already
                        // shows) so a future third/fourth supported device needs no new
                        // branch here at all.
                        text: qsTr("%1 Settings").arg(HomeViewModel.deviceDisplayName)
                        font.bold: true
                        font.pixelSize: Theme.fontSizeBodyLarge
                        color: Theme.text
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }

                Text {
                    visible: SettingsWriteService.loading && SettingsWriteService.settings.length === 0
                    color: Theme.mutedText
                    text: qsTr("Reading settings off the watch...")
                }

                ErrorBanner {
                    width: parent.width
                    detail: SettingsWriteService.ok ? "" : SettingsWriteService.lastError
                    context: qsTr("reading or writing watch settings")
                }

                // --- Orbital data - real, 2026-08-10 (André: "let's enable by default for
                // traverse, traverse and kailash. on kailash settings, give the option to
                // disable it, name it ephemeris gps only with a little i that shows").
                //
                // Shown only when the WATCH itself declares a GlonassSGEE region
                // (DeviceService.glonassSupported, answered by sgee.py's glonass_status),
                // never from a model list - Suunto's own Devices.xml hardcodes three
                // models and forgot the Kailash, which is why that watch has never had
                // GLONASS ephemeris from any Suunto software.
                //
                // This is an APP preference, not a field on the watch, which is why it
                // sits in its own titled group rather than among the real device settings
                // the Repeater below renders from the watch's own blob.
                Column {
                    id: orbitalGroup
                    width: parent.width
                    spacing: Theme.spacingSmall
                    visible: DeviceService.glonassSupported
                    property bool infoOpen: false

                    Text {
                        text: qsTr("Orbital data")
                        color: Theme.mutedText
                        font.bold: true
                        font.pixelSize: Theme.fontSizeLabel
                        topPadding: Theme.spacingSmall
                    }

                    Row {
                        spacing: Theme.spacingSmall
                        RoundedCheckBox {
                            anchors.verticalCenter: parent.verticalCenter
                            text: qsTr("Ephemeris GPS only")
                            checked: DeviceService.ephemerisGpsOnly
                            onToggled: DeviceService.ephemerisGpsOnly = checked
                        }
                        // The "little i" - tap to expand, tap again to collapse. Not a hover
                        // tooltip: hover doesn't exist on Android, and this same pattern has
                        // to work identically there.
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            width: 18; height: 18; radius: 9
                            color: "transparent"
                            border.width: 1
                            border.color: orbitalGroup.infoOpen ? Theme.primary : Theme.mutedText
                            Text {
                                anchors.centerIn: parent
                                text: "i"
                                font.pixelSize: Theme.fontSizeCaption
                                font.bold: true
                                color: orbitalGroup.infoOpen ? Theme.primary : Theme.mutedText
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: orbitalGroup.infoOpen = !orbitalGroup.infoOpen
                            }
                        }
                    }

                    Text {
                        visible: orbitalGroup.infoOpen
                        width: parent.width
                        wrapMode: Text.WordWrap
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeCaption
                        text: qsTr("This watch can also use GLONASS satellites, and has its " +
                                    "own storage for their orbital data. Suunto's software " +
                                    "never sends it to this model, so those satellites start " +
                                    "cold every time. AmbitApp sends both GPS and GLONASS " +
                                    "orbital data, which can speed up getting a fix. Tick " +
                                    "this to send GPS only.")
                    }
                }

                Repeater {
                    model: [
                        { screen: "general",  title: qsTr("General settings") },
                        { screen: "units",    title: qsTr("Unit settings") },
                        { screen: "personal", title: qsTr("Personal settings") },
                        { screen: "other",    title: qsTr("Other") }
                    ]
                    delegate: Column {
                        id: screenGroup
                        width: parent.width
                        spacing: Theme.spacingSmall
                        readonly property var rows: settingsColumn.rowsForScreen(modelData.screen)
                        readonly property string groupTitle: modelData.title
                        visible: rows.length > 0

                        Text {
                            text: screenGroup.groupTitle
                            color: Theme.mutedText
                            font.bold: true
                            font.pixelSize: Theme.fontSizeLabel
                            topPadding: Theme.spacingSmall
                        }

                        Repeater {
                    model: screenGroup.rows
                    // Real, 2026-08-10 (André: "everything visual you can inspire on suunto
                    // link... it is what the watch shows"). SuuntoLink puts the field name
                    // ABOVE its control, stacks 2-3 choices as vertical radio buttons, uses a
                    // checkbox for a standalone boolean and a dropdown only for a long list -
                    // so that is what this renders, driven by the `control` hint
                    // settings_write.py now reports (AMBIT3_DISPLAY) rather than by guessing
                    // from the raw type. A device with no display metadata (Kailash) falls
                    // back to the old kind-based rendering, unchanged.
                    delegate: Column {
                        id: settingRow
                        width: parent.width
                        spacing: 4
                        bottomPadding: Theme.spacingSmall

                        readonly property var item: modelData
                        readonly property bool editable: item.writable !== false
                        readonly property bool busy: SettingsWriteService.writingKey === item.key
                        readonly property string unitSuffix: item.unit ? item.unit : ""
                        readonly property var choices: item.choices ? item.choices : []
                        readonly property bool hasRange:
                            item.min !== undefined && item.min !== null
                            && item.max !== undefined && item.max !== null
                        readonly property bool isHomeCoord:
                            item.path.endsWith("HomeLocation.Latitude")
                            || item.path.endsWith("HomeLocation.Longitude")
                        // SuuntoLink's own field name where we have it; otherwise the old
                        // "display_dark" -> "Display dark" formatter, still used for Kailash.
                        readonly property string label: {
                            if (item.label)
                                return item.label;
                            const parts = item.key.split("_");
                            parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                            return parts.join(" ");
                        }
                        readonly property string control: {
                            if (item.control)
                                return item.control;
                            if (item.kind === "bool") return "checkbox";
                            if (item.kind === "enum") return "dropdown";
                            if (item.kind === "text") return "text";
                            if (item.kind === "number")
                                return isHomeCoord ? "coord" : (hasRange ? "slider" : "readonly");
                            return "readonly";
                        }

                        function commit(v) { SettingsWriteService.writeSetting(item.key, v) }

                        Row {
                            spacing: Theme.spacingSmall
                            Text {
                                text: settingRow.label
                                color: Theme.text
                                font.pixelSize: Theme.fontSizeBody
                                font.bold: true
                            }
                            Text {
                                visible: settingRow.busy
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("saving...")
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeCaption
                                font.italic: true
                            }
                        }

                        // --- radio: SuuntoLink stacks its 2-3 choices vertically ---
                        Column {
                            visible: settingRow.control === "radio" && settingRow.editable
                            spacing: 0
                            Repeater {
                                model: settingRow.choices
                                delegate: RoundedRadioButton {
                                    // autoExclusive:false + onClicked, never a `checked`
                                    // binding fighting QQC2's own exclusivity - the same
                                    // pattern every other exclusive choice on this page uses.
                                    autoExclusive: false
                                    checked: modelData.value === settingRow.item.value
                                    text: modelData.label
                                    enabled: !settingRow.busy
                                    onClicked: settingRow.commit(modelData.value)
                                }
                            }
                        }

                        RoundedCheckBox {
                            visible: settingRow.control === "checkbox" && settingRow.editable
                            checked: settingRow.item.value === 1 || settingRow.item.value === true
                            enabled: !settingRow.busy
                            onToggled: settingRow.commit(checked ? 1 : 0)
                        }

                        RoundedComboBox {
                            visible: settingRow.control === "dropdown" && settingRow.editable
                            width: 260
                            model: settingRow.choices
                            textRole: "label"
                            valueRole: "value"
                            enabled: !settingRow.busy
                            currentIndex: {
                                for (let i = 0; i < settingRow.choices.length; i++) {
                                    if (settingRow.choices[i].value === settingRow.item.value)
                                        return i;
                                }
                                return -1;
                            }
                            onActivated: settingRow.commit(currentValue)
                        }

                        Row {
                            visible: settingRow.control === "slider" && settingRow.editable
                            spacing: 8
                            RoundedSlider {
                                anchors.verticalCenter: parent.verticalCenter
                                width: 200
                                from: settingRow.item.min
                                to: settingRow.item.max
                                value: settingRow.item.value
                                enabled: !settingRow.busy
                                onMoved: settingRow.commit(Math.round(value))
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: settingRow.item.value + " " + settingRow.unitSuffix
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeLabel
                            }
                        }

                        // --- number / year / text: typed, then committed with Set, so a
                        // half-typed value is never sent to the watch ---
                        Row {
                            visible: (settingRow.control === "number"
                                      || settingRow.control === "year"
                                      || settingRow.control === "text") && settingRow.editable
                            spacing: 8
                            RoundedTextField {
                                id: valueField
                                anchors.verticalCenter: parent.verticalCenter
                                width: settingRow.control === "text" ? 140 : 90
                                text: String(settingRow.item.value)
                                enabled: !settingRow.busy
                            }
                            Text {
                                visible: settingRow.unitSuffix.length > 0
                                anchors.verticalCenter: parent.verticalCenter
                                text: settingRow.unitSuffix
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeBody
                            }
                            RoundedButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("Set")
                                enabled: !settingRow.busy
                                onClicked: {
                                    if (settingRow.control === "text") {
                                        settingRow.commit(valueField.text);
                                        return;
                                    }
                                    const parsed = parseFloat(valueField.text);
                                    if (isNaN(parsed)) return;
                                    settingRow.commit(parsed);
                                }
                            }
                        }

                        // --- compass declination: SuuntoLink's own "Use compass declination"
                        // checkbox, then a West/East choice and a 0-90 magnitude. On the wire
                        // this is ONE signed float32 in radians with East positive, and Off is
                        // simply 0.0 - there is no separate enable flag in the schema at all
                        // (checked: the descriptor has exactly one declination field, and every
                        // read before the first write in `ambit3declination` shows 0.0). The
                        // tool converts degrees<->radians, so this only deals in degrees.
                        Column {
                            id: declRow
                            visible: settingRow.control === "declination"
                            spacing: 4
                            property bool useDecl: settingRow.item.value !== 0
                            property bool west: settingRow.item.value < 0
                            function send() {
                                if (!useDecl) { settingRow.commit(0); return; }
                                const mag = Math.abs(parseFloat(declField.text));
                                if (isNaN(mag)) return;
                                settingRow.commit(west ? -mag : mag);
                            }
                            RoundedCheckBox {
                                text: qsTr("Use compass declination")
                                checked: declRow.useDecl
                                enabled: !settingRow.busy
                                onToggled: { declRow.useDecl = checked; if (!checked) declRow.send(); }
                            }
                            Row {
                                visible: declRow.useDecl
                                spacing: 8
                                RoundedRadioButton {
                                    autoExclusive: false
                                    text: qsTr("West")
                                    checked: declRow.west
                                    enabled: !settingRow.busy
                                    onClicked: { declRow.west = true; declRow.send(); }
                                }
                                RoundedRadioButton {
                                    autoExclusive: false
                                    text: qsTr("East")
                                    checked: !declRow.west
                                    enabled: !settingRow.busy
                                    onClicked: { declRow.west = false; declRow.send(); }
                                }
                                RoundedTextField {
                                    id: declField
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: 70
                                    text: Math.abs(settingRow.item.value).toFixed(1)
                                    enabled: !settingRow.busy
                                }
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "°"
                                    color: Theme.mutedText
                                    font.pixelSize: Theme.fontSizeBody
                                }
                                RoundedButton {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: qsTr("Set")
                                    enabled: !settingRow.busy
                                    onClicked: declRow.send()
                                }
                            }
                        }

                        // Kailash's HomeLocation - free-text degrees, no sensible slider range.
                        Row {
                            visible: settingRow.control === "coord"
                            spacing: 8
                            RoundedTextField {
                                id: coordField
                                anchors.verticalCenter: parent.verticalCenter
                                width: 110
                                text: settingRow.item.value.toFixed(6)
                                enabled: !settingRow.busy
                            }
                            RoundedButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("Set")
                                enabled: !settingRow.busy
                                onClicked: {
                                    const parsed = parseFloat(coordField.text);
                                    if (isNaN(parsed)) return;
                                    settingRow.commit(parsed);
                                }
                            }
                        }

                        // Read-only: a field on no real SuuntoLink screen (display_contrast),
                        // or a number with no confirmed range to build an editor from.
                        Text {
                            visible: settingRow.control === "readonly" || !settingRow.editable
                            text: settingRow.item.value + (settingRow.unitSuffix.length
                                                           ? " " + settingRow.unitSuffix : "")
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeBody
                        }

                        // Why a field is not editable, when the backend can say. A row that
                        // is simply greyed out reads as broken; one that says the units mode
                        // owns it, and how to take it back, reads as the watch's own rule -
                        // which it is.
                        Text {
                            visible: !settingRow.editable
                                     && settingRow.item.note !== undefined
                                     && settingRow.item.note.length > 0
                            width: parent.width
                            wrapMode: Text.WordWrap
                            text: settingRow.item.note ? settingRow.item.note : ""
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeCaption
                        }
                    }
                        }
                    }
                }
            }
        }

        // --- Connections ---
        // Found 2026-08-07 via real testing: this used to be static, no way to click into
        // any of it. Checked what the real Android app does before building each one -
        // Intervals.icu AND Runalyze both use simple personal-API-key auth (no OAuth) - the
        // first version of this wrongly assumed Runalyze needed OAuth too, corrected once
        // actually checked (src/services/ApiRunalyze.ts). Strava genuinely does need real
        // OAuth2 (src/services/ApiStrava.ts) - built for real the same day, via a local
        // loopback HTTP callback server instead of the Android app's custom URL scheme; see
        // ConnectionsService's own header comment for why.
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.sync; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Connections"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }

                // Real, 2026-08-09: these three rows used spacing:8 while every other
                // status-dot row on this page (General/Supported devices above) used 6 -
                // unified to 6.
                Row {
                    spacing: 6
                    TapHandler { onTapped: intervalsIcuDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.intervalsIcuConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.intervalsIcuConnected
                            ? qsTr("Intervals.icu — connected (athlete %1)")
                                .arg(ConnectionsService.intervalsIcuAthleteId)
                            : qsTr("Intervals.icu — tap to set up")
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
                Row {
                    spacing: 6
                    TapHandler { onTapped: runalyzeDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.runalyzeConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.runalyzeConnected
                            ? qsTr("Runalyze — connected")
                            : qsTr("Runalyze — tap to set up")
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
                Row {
                    spacing: 6
                    TapHandler { onTapped: stravaDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.stravaConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.stravaConnected
                            ? qsTr("Strava — connected")
                            : qsTr("Strava — tap to set up")
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
            }
        }

        Dialog {
            id: intervalsIcuDialog
            title: qsTr("Intervals.icu")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                athleteIdField.text = ConnectionsService.intervalsIcuAthleteId
                apiKeyField.text = ConnectionsService.intervalsIcuConnected
                    ? ConnectionsService.intervalsIcuApiKey() : ""
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Athlete ID and API key from intervals.icu → Settings → " +
                                "Developer Settings. Stored locally on this computer, not " +
                                "sent anywhere except intervals.icu itself.")
                }
                RoundedTextField {
                    id: athleteIdField
                    width: parent.width
                    placeholderText: qsTr("Athlete ID (e.g. i12345)")
                }
                RoundedTextField {
                    id: apiKeyField
                    width: parent.width
                    placeholderText: qsTr("API key")
                    echoMode: TextInput.Password
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: qsTr("Save")
                        enabled: athleteIdField.text.length > 0 && apiKeyField.text.length > 0
                        onClicked: {
                            ConnectionsService.saveIntervalsIcu(athleteIdField.text, apiKeyField.text)
                            intervalsIcuDialog.close()
                        }
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.intervalsIcuConnected
                        onClicked: {
                            ConnectionsService.disconnectIntervalsIcu()
                            intervalsIcuDialog.close()
                        }
                    }
                }
            }
        }

        Dialog {
            id: runalyzeDialog
            title: qsTr("Runalyze")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                runalyzeApiKeyField.text = ConnectionsService.runalyzeConnected
                    ? ConnectionsService.runalyzeApiKey() : ""
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("API key from your Runalyze account. Stored locally on " +
                                "this computer, not sent anywhere except runalyze.com " +
                                "itself.")
                }
                RoundedTextField {
                    id: runalyzeApiKeyField
                    width: parent.width
                    placeholderText: qsTr("API key")
                    echoMode: TextInput.Password
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: qsTr("Save")
                        enabled: runalyzeApiKeyField.text.length > 0
                        onClicked: {
                            ConnectionsService.saveRunalyze(runalyzeApiKeyField.text)
                            runalyzeDialog.close()
                        }
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.runalyzeConnected
                        onClicked: {
                            ConnectionsService.disconnectRunalyze()
                            runalyzeDialog.close()
                        }
                    }
                }
            }
        }

        Dialog {
            id: stravaDialog
            title: qsTr("Strava")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                stravaClientIdField.text = ConnectionsService.stravaClientId
                stravaClientSecretField.text = ConnectionsService.stravaConnected
                    ? ConnectionsService.stravaClientSecret() : ""
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Real OAuth2, not a personal API key like the other two - " +
                                "register your own app at strava.com/settings/api first " +
                                "(Authorization Callback Domain: localhost), then paste its " +
                                "Client ID and Client Secret below. Connect opens Strava in " +
                                "your browser; approving there sends you back here " +
                                "automatically.")
                }
                RoundedTextField {
                    id: stravaClientIdField
                    width: parent.width
                    placeholderText: qsTr("Client ID")
                }
                RoundedTextField {
                    id: stravaClientSecretField
                    width: parent.width
                    placeholderText: qsTr("Client Secret")
                    echoMode: TextInput.Password
                }
                Text {
                    visible: ConnectionsService.stravaConnecting
                    text: qsTr("Waiting for you to approve in the browser...")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
                Text {
                    visible: !ConnectionsService.stravaConnecting
                             && ConnectionsService.stravaError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: ConnectionsService.stravaError
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: ConnectionsService.stravaConnecting
                            ? qsTr("Connecting...") : qsTr("Connect")
                        enabled: !ConnectionsService.stravaConnecting
                                 && stravaClientIdField.text.length > 0
                                 && stravaClientSecretField.text.length > 0
                        onClicked: ConnectionsService.connectStrava(
                            stravaClientIdField.text, stravaClientSecretField.text)
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.stravaConnected
                        onClicked: {
                            ConnectionsService.disconnectStrava()
                            stravaDialog.close()
                        }
                    }
                }
            }
        }

        // --- Maps ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.routes; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Maps"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    text: qsTr("Provider: tiles from %1")
                        .arg(MapService.provider === "osm" ? "OpenStreetMap" : "CyclOSM")
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    // autoExclusive (QQC2's default for same-parent RadioButtons) fights
                    // with these declarative `checked` bindings - it explicitly assigns
                    // `checked` on whichever button loses, which silently destroys that
                    // button's binding so it stops following MapService.provider. Exclusivity
                    // is already fully handled by the shared property (only one of these two
                    // comparisons can ever be true), so autoExclusive is switched off, and
                    // onClicked (a real user action) is used instead of onCheckedChanged
                    // (which also fires from binding evaluation, not just clicks) - real bug,
                    // 2026-08-07, likely also the cause of the earlier "clicks for CyclOSM
                    // don't do anything" report.
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: MapService.provider === "osm"
                        text: qsTr("OpenStreetMap (standard)")
                        onClicked: MapService.provider = "osm"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: MapService.provider === "cyclosm"
                        text: qsTr("CyclOSM (cycling-focused)")
                        onClicked: MapService.provider = "cyclosm"
                    }
                }
            }
        }

        // --- Weather: the real, functional section ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.weatherSunny; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Weather"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    text: qsTr("Provider: Open-Meteo")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }

                Text { text: qsTr("Location source"); color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                Row {
                    spacing: Theme.spacingSmall
                    // IP-based is the real default now (Main.qml calls
                    // WeatherService.detectLocationFromIp() on startup, not refresh()) - this
                    // radio just reflects/re-triggers that, matching HomeViewModel's own
                    // startup call rather than owning the decision itself.
                    RoundedRadioButton {
                        checked: true
                        text: qsTr("This computer (IP-based)")
                        onCheckedChanged: if (checked) WeatherService.detectLocationFromIp()
                    }
                    RoundedRadioButton { text: qsTr("Manual") }
                }

                Row {
                    width: parent.width
                    spacing: Theme.spacingSmall
                    RoundedTextField {
                        id: latField
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Latitude")
                        text: WeatherService.latitude.toString()
                    }
                    RoundedTextField {
                        id: lonField
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Longitude")
                        text: WeatherService.longitude.toString()
                    }
                }
                RoundedButton {
                    text: qsTr("Apply")
                    onClicked: {
                        const lat = parseFloat(latField.text);
                        const lon = parseFloat(lonField.text);
                        if (!isNaN(lat)) WeatherService.latitude = lat;
                        if (!isNaN(lon)) WeatherService.longitude = lon;
                        WeatherService.refresh();
                    }
                }
            }
        }

        // --- Backup ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.backup; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Backup"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Create/list/restore backups from the Backup page in the " +
                                "main navigation - not duplicated here.")
                }
            }
        }

        // --- About ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                // No icon here - unlike the other section headers, this app's own subset
                // icon font (assets/fonts/NOTICE.md) has no real "info" glyph to reuse
                // honestly, and guessing one isn't worth it for a header that's otherwise
                // just a label. Still gets the same size fix as every other header.
                Text { text: qsTr("About"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text }
                Text {
                    text: qsTr("AmbitApp V2.5.11")
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Independent, unofficial software - not affiliated with, " +
                                "endorsed by, or supported by Suunto or Garmin. Map data © " +
                                "OpenStreetMap contributors. Icons: Google Material " +
                                "Symbols (Apache License 2.0).")
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    // Real text, not a placeholder - matches LICENSE and CREDITS.md at the
                    // repo root, which existed before this was wired into the app itself
                    // (found 2026-08-07: added to the repo, never surfaced here - fixed).
                    text: qsTr("Licensed under the GNU GPLv3, the same license as openambit, " +
                                "whose real, working libambit this project's own protocol " +
                                "work is checked against throughout.")
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Built on real prior work: openambit, opensportsync, " +
                                "marguslt (firmware-download recipe, gists, openmoves), " +
                                "sebchastang (published Suunto App Zone interval-training " +
                                "scripts), the Suunto forum community, and wanarun.net. " +
                                "Full credits in CREDITS.md.")
                }
            }
        }
    }
}
