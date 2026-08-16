import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 11, the last one. General/Connections/Maps/Weather/Backup/About per the spec.
// Weather's "Manual location" is the one section that's fully real end to end - it's the
// first actual UI consumer of WeatherService's own settable latitude/longitude (built in
// Step 5 specifically so a location source could be swapped "without UI modifications" -
// this is that promise being kept, not a new mechanism).
PageFlickable {
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

    // The longitude half of Kailash's home location. The settings list is flat, so the
    // latitude row (which now presents the pair) has to look its partner up by key.
    readonly property real homeLongitudeValue: {
        const list = SettingsWriteService.settings
        for (let i = 0; i < list.length; i++) {
            if (list[i].path && list[i].path.endsWith("HomeLocation.Longitude"))
                return list[i].value
        }
        return 0
    }

    // Testing-mode device picker - a DIRECT child of the page (like the other dialogs), NOT
    // nested inside the Testing-mode card. Declared inside a scrolled card it opened positioned
    // at that card's off-screen origin, so "nothing appeared" (André, 2026-08-16); at page level
    // with centerIn:parent it centres on the viewport like every other Settings dialog.
    DemoDevicePicker {
        id: demoPicker
        anchors.centerIn: parent
        current: DeviceService.demoVariant
        onDeviceChosen: (variant) => DeviceService.setDemoMode(true, variant)
    }

    HomeLocationDialog {
        id: homePicker
        onPicked: (lat, lon) => {
            // Written one after the other, not both at once: SettingsWriteService handles a
            // single write at a time (writingKey), and firing two together would race for
            // the same USB connection. The longitude is queued and sent as soon as the
            // latitude write reports done.
            root.pendingHomeLongitude = lon
            SettingsWriteService.writeSetting("home_latitude", lat)
        }
    }

    // NaN means "nothing queued" - a real coordinate of 0 is a legitimate value (the Gulf of
    // Guinea), so 0 cannot be the sentinel here.
    property real pendingHomeLongitude: NaN

    Connections {
        target: SettingsWriteService
        function onWritingKeyChanged() {
            if (SettingsWriteService.writingKey !== "")
                return
            if (isNaN(root.pendingHomeLongitude))
                return
            const lon = root.pendingHomeLongitude
            root.pendingHomeLongitude = NaN
            SettingsWriteService.writeSetting("home_longitude", lon)
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

                // André, 2026-08-16: the same independent map/list choice for Routes and POIs.
                Text {
                    text: qsTr("Routes view")
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                    font.bold: true
                    topPadding: Theme.spacingSmall
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.routesView === "map"
                        text: qsTr("See as a map")
                        onClicked: Theme.routesView = "map"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.routesView === "list"
                        text: qsTr("See as a list")
                        onClicked: Theme.routesView = "list"
                    }
                }

                Text {
                    text: qsTr("POIs view")
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                    font.bold: true
                    topPadding: Theme.spacingSmall
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.poisView === "map"
                        text: qsTr("See as a map")
                        onClicked: Theme.poisView = "map"
                    }
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: Theme.poisView === "list"
                        text: qsTr("See as a list")
                        onClicked: Theme.poisView = "list"
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
                // with no screen (Kailash's whole table) fall into
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
                        // André, 2026-08-11: "remove the home latitude/longitude, call it:
                        // home coordinates". The watch stores them as ONE grouped field
                        // (entry 0x36, Latitude/Longitude sub-fields), so showing two rows
                        // was the app splitting something the device keeps whole. The
                        // latitude row now presents the pair and the longitude row is
                        // hidden - it is still read and still written, just not listed
                        // twice.
                        readonly property bool isHomeCoord:
                            item.path.endsWith("HomeLocation.Latitude")
                        readonly property bool isHomeCoordPartner:
                            item.path.endsWith("HomeLocation.Longitude")
                        // SuuntoLink's own field name where we have it; otherwise the old
                        // "display_dark" -> "Display dark" formatter, still used for Kailash.
                        readonly property string label: {
                            if (isHomeCoord)
                                return qsTr("Home coordinates");
                            if (item.label)
                                return item.label;
                            const parts = item.key.split("_");
                            parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                            return parts.join(" ");
                        }
                        visible: !isHomeCoordPartner
                        height: isHomeCoordPartner ? 0 : implicitHeight
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
                                // Bindings are evaluated for EVERY setting row, not just the
                                // ones where this slider is visible - so on an enum or bool
                                // field, which has no min/max at all, these read undefined
                                // and Qt logs "Unable to assign [undefined] to double" on
                                // every re-read. The values are unused when hidden; the
                                // fallbacks exist purely to keep the binding well-typed.
                                from: settingRow.item.min !== undefined ? settingRow.item.min : 0
                                to: settingRow.item.max !== undefined ? settingRow.item.max : 100
                                value: settingRow.item.value !== undefined ? settingRow.item.value : 0
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

                        // Kailash's HomeLocation, as a place rather than two numbers -
                        // see HomeLocationDialog.qml. The coordinates stay visible next to
                        // the button, which is what "then show the coordinates on the
                        // settings side" asked for.
                        Row {
                            visible: settingRow.control === "coord"
                            spacing: Theme.spacingSmall

                            RoundedButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("Pick on a map")
                                enabled: !settingRow.busy
                                onClicked: {
                                    homePicker.latitude = settingRow.item.value
                                    homePicker.longitude = root.homeLongitudeValue
                                    homePicker.open()
                                }
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("%1, %2").arg(settingRow.item.value.toFixed(6))
                                      .arg(root.homeLongitudeValue.toFixed(6))
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeBody
                            }
                        }

                        // Read-only: a field with no write path (Kailash's own
                        // enabled_navigation_systems), or a number with no confirmed range
                        // to build an editor from.
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
                // Dropbox / Google Drive / OneDrive - added 2026-08-12 as Backup & Restore
                // cloud destinations (see BackupPage.qml). Same self-serve OAuth shape as
                // Strava above (own registered app, paste the ID here) - see
                // ConnectionsService's header comment for the full reasoning.
                Row {
                    spacing: 6
                    TapHandler { onTapped: dropboxDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.dropboxConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.dropboxConnected
                            ? qsTr("Dropbox — connected")
                            : qsTr("Dropbox — tap to set up")
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
                Row {
                    spacing: 6
                    TapHandler { onTapped: googleDriveDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.googleDriveConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.googleDriveConnected
                            ? qsTr("Google Drive — connected")
                            : qsTr("Google Drive — tap to set up")
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
                Row {
                    spacing: 6
                    TapHandler { onTapped: oneDriveDialog.open() }
                    Rectangle {
                        width: 8; height: 8; radius: 4
                        anchors.verticalCenter: parent.verticalCenter
                        color: ConnectionsService.oneDriveConnected ? Theme.success : Theme.mutedText
                    }
                    Text {
                        text: ConnectionsService.oneDriveConnected
                            ? qsTr("OneDrive — connected")
                            : qsTr("OneDrive — tap to set up")
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

        // --- Dropbox / Google Drive / OneDrive connect dialogs (added 2026-08-12, Backup &
        // Restore cloud destinations). Same OAuth shape as stravaDialog above: paste your own
        // registered app's credentials, Connect opens the provider in the browser and the
        // callback returns here. OneDrive uses PKCE, so it has no Client Secret field. ---
        Dialog {
            id: dropboxDialog
            title: qsTr("Dropbox")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                dropboxClientIdField.text = ConnectionsService.dropboxClientId
                dropboxClientSecretField.text = ConnectionsService.dropboxConnected
                    ? ConnectionsService.dropboxClientSecret() : ""
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Register your own free app at dropbox.com/developers/apps " +
                                "(App folder access, Redirect URI http://localhost), then " +
                                "paste its App key and App secret below. Only your own " +
                                "\"AmbitApp Backups\" folder in Dropbox is ever touched.")
                }
                RoundedTextField {
                    id: dropboxClientIdField
                    width: parent.width
                    placeholderText: qsTr("App key")
                }
                RoundedTextField {
                    id: dropboxClientSecretField
                    width: parent.width
                    placeholderText: qsTr("App secret")
                    echoMode: TextInput.Password
                }
                Text {
                    visible: ConnectionsService.dropboxConnecting
                    text: qsTr("Waiting for you to approve in the browser...")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
                Text {
                    visible: !ConnectionsService.dropboxConnecting
                             && ConnectionsService.dropboxError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: ConnectionsService.dropboxError
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: ConnectionsService.dropboxConnecting
                            ? qsTr("Connecting...") : qsTr("Connect")
                        enabled: !ConnectionsService.dropboxConnecting
                                 && dropboxClientIdField.text.length > 0
                                 && dropboxClientSecretField.text.length > 0
                        onClicked: ConnectionsService.connectDropbox(
                            dropboxClientIdField.text, dropboxClientSecretField.text)
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.dropboxConnected
                        onClicked: {
                            ConnectionsService.disconnectDropbox()
                            dropboxDialog.close()
                        }
                    }
                }
            }
        }

        Dialog {
            id: googleDriveDialog
            title: qsTr("Google Drive")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                googleDriveClientIdField.text = ConnectionsService.googleDriveClientId
                googleDriveClientSecretField.text = ConnectionsService.googleDriveConnected
                    ? ConnectionsService.googleDriveClientSecret() : ""
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Register your own free app at console.cloud.google.com " +
                                "(enable the Google Drive API, OAuth Client ID of type " +
                                "\"Desktop app\"), then paste its Client ID and Client Secret " +
                                "below. Only files this app itself creates are ever visible to " +
                                "it (drive.file scope).")
                }
                RoundedTextField {
                    id: googleDriveClientIdField
                    width: parent.width
                    placeholderText: qsTr("Client ID")
                }
                RoundedTextField {
                    id: googleDriveClientSecretField
                    width: parent.width
                    placeholderText: qsTr("Client Secret")
                    echoMode: TextInput.Password
                }
                Text {
                    visible: ConnectionsService.googleDriveConnecting
                    text: qsTr("Waiting for you to approve in the browser...")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
                Text {
                    visible: !ConnectionsService.googleDriveConnecting
                             && ConnectionsService.googleDriveError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: ConnectionsService.googleDriveError
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: ConnectionsService.googleDriveConnecting
                            ? qsTr("Connecting...") : qsTr("Connect")
                        enabled: !ConnectionsService.googleDriveConnecting
                                 && googleDriveClientIdField.text.length > 0
                                 && googleDriveClientSecretField.text.length > 0
                        onClicked: ConnectionsService.connectGoogleDrive(
                            googleDriveClientIdField.text, googleDriveClientSecretField.text)
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.googleDriveConnected
                        onClicked: {
                            ConnectionsService.disconnectGoogleDrive()
                            googleDriveDialog.close()
                        }
                    }
                }
            }
        }

        Dialog {
            id: oneDriveDialog
            title: qsTr("OneDrive")
            modal: true
            anchors.centerIn: parent
            standardButtons: Dialog.Close

            onOpened: {
                oneDriveClientIdField.text = ConnectionsService.oneDriveClientId
            }

            Column {
                width: 320
                spacing: Theme.spacingSmall

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Register your own free app at entra.microsoft.com (platform " +
                                "\"Mobile and desktop applications\", Redirect URI " +
                                "http://localhost), then paste its Application (client) ID " +
                                "below — no secret needed, this uses PKCE. Only this app's own " +
                                "OneDrive app folder is ever touched.")
                }
                RoundedTextField {
                    id: oneDriveClientIdField
                    width: parent.width
                    placeholderText: qsTr("Application (client) ID")
                }
                Text {
                    visible: ConnectionsService.oneDriveConnecting
                    text: qsTr("Waiting for you to approve in the browser...")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
                Text {
                    visible: !ConnectionsService.oneDriveConnecting
                             && ConnectionsService.oneDriveError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: ConnectionsService.oneDriveError
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: ConnectionsService.oneDriveConnecting
                            ? qsTr("Connecting...") : qsTr("Connect")
                        enabled: !ConnectionsService.oneDriveConnecting
                                 && oneDriveClientIdField.text.length > 0
                        onClicked: ConnectionsService.connectOneDrive(oneDriveClientIdField.text)
                    }
                    RoundedButton {
                        text: qsTr("Disconnect")
                        visible: ConnectionsService.oneDriveConnected
                        onClicked: {
                            ConnectionsService.disconnectOneDrive()
                            oneDriveDialog.close()
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
                    // Straight from the provider record, so a provider added to
                    // MapService needs no second edit here to name itself correctly.
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Provider: %1").arg(MapService.providerName)
                    color: Theme.text
                    font.pixelSize: Theme.fontSizeBody
                }
                Flow {
                    width: parent.width
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
                    // André, 2026-08-11: "ok add IGN to desktop" - for parity with Android,
                    // which has had it and defaults to it. Same layer, so both versions draw
                    // the identical map.
                    RoundedRadioButton {
                        autoExclusive: false
                        checked: MapService.provider === "ign"
                        text: qsTr("IGN (France)")
                        onClicked: MapService.provider = "ign"
                    }
                }

                // Offline tile cache - real, 2026-08-11 (André: "put this offline map cache
                // in the desktop version", matching Android's own SettingsScreen.tsx cache
                // size + "Clear map cache" row). This is the SAME cache every map tile
                // (browsed or explicitly downloaded via MapWindow's own "Download for
                // offline" button) lands in - one number, one clear action, not a separate
                // "offline tiles" store to manage.
                Row {
                    width: parent.width
                    spacing: Theme.spacingSmall
                    Text {
                        width: parent.width - clearCacheButton.width - Theme.spacingSmall
                        anchors.verticalCenter: parent.verticalCenter
                        wrapMode: Text.WordWrap
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                        text: qsTr("Offline tile cache: %1 MB")
                              .arg((TileCacheService.cacheSizeBytes / (1024 * 1024)).toFixed(1))
                    }
                    RoundedButton {
                        id: clearCacheButton
                        anchors.verticalCenter: parent.verticalCenter
                        text: qsTr("Clear")
                        enabled: TileCacheService.cacheSizeBytes > 0
                        onClicked: TileCacheService.clearCache()
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

        // --- Testing mode. Real request, 2026-08-11 (André): "add on feature on settings:
        // testing mode, where it simulates that an ambit 3 is connected, so people can test
        // it without the watch. for usability could be cool." Then, same day: "put it on the
        // bottom of the site before the about... opens a window and we can choose device,
        // based on all the characteristics we already know...always linked..and we add the
        // garmin etrex".
        //
        // "Always linked" is what makes this worth having rather than a mock: the Suunto
        // devices come from the generated capability table and the eTrex from a real folder
        // tree, so every page runs its normal code - the same decoder, encoder, round-trip
        // guard and GPX reader hardware goes through. Edits land on a sample device and are
        // thrown away when the app closes; nothing reaches a real one.
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
                    text: qsTr("Pretend a device is connected, so you can look around the app " +
                                "without one. Changes are made to a sample device and " +
                                "forgotten when you close the app - nothing is written to a " +
                                "real one.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedSwitch {
                        anchors.verticalCenter: parent.verticalCenter
                        checked: DeviceService.demoMode
                        onToggled: DeviceService.setDemoMode(checked, "")
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        // The device's name is the status: "On" alone would leave the one
                        // thing you actually want confirmed - which device - unsaid.
                        text: DeviceService.demoMode
                              ? qsTr("On - showing %1").arg(DeviceService.demoDeviceName
                                                            || qsTr("a sample device"))
                              : qsTr("Off")
                        color: DeviceService.demoMode ? Theme.primary : Theme.mutedText
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
                Row {
                    spacing: Theme.spacingSmall
                    visible: DeviceService.demoMode
                    RoundedButton {
                        anchors.verticalCenter: parent.verticalCenter
                        text: qsTr("Change device")
                        onClicked: demoPicker.open()
                    }
                }
            }

        }

        // --- Suunto Smart Sensor. Real, 2026-08-13 (André: "add a card on settings to
        // pair the Suunto Smart Sensor and that it reports firmware, battery charge,
        // serial, HR etc") - the old Ambit-era HR belt, unrelated to the connected watch.
        // Standard BLE GATT reads (SmartSensorService/tools/smart_sensor.py), real
        // hardware-confirmed: it identifies itself as a Movesense-platform sensor, not the
        // "BlueBelt" name that's only Suunto's own device-catalog codename. ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.watch; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        text: qsTr("Suunto Smart Sensor")
                        font.bold: true
                        font.pixelSize: Theme.fontSizeBodyLarge
                        color: Theme.text
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("The HR belt (not the watch) - reads its battery, firmware, " +
                                "and a live heart rate sample over Bluetooth.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        // No PIN/passkey here (Just Works pairing, confirmed live
                        // 2026-08-13) - "pairing" is just discovering + connecting, which
                        // refresh() already does on its own whenever the belt isn't
                        // already known to Bluetooth. Label reflects that instead of
                        // always saying "Refresh", since a first press genuinely does
                        // more work than a later one.
                        text: SmartSensorService.loading
                            ? qsTr("Searching…")
                            : (SmartSensorService.checked && SmartSensorService.ok && SmartSensorService.found
                                ? qsTr("Refresh") : qsTr("Pair"))
                        enabled: !SmartSensorService.loading
                        onClicked: SmartSensorService.refresh()
                    }
                    // Real request, 2026-08-13 ("just add a button to forget") - only
                    // shown once there's actually something paired to forget. Not
                    // destructive to the belt itself (see SmartSensorService::forget()'s
                    // own comment): it holds no bond secret worth losing, so this is a
                    // safely repeatable Bluetooth-side reset, freeing Pair to be tried
                    // again from a clean slate.
                    RoundedButton {
                        visible: SmartSensorService.checked && SmartSensorService.ok && SmartSensorService.found
                        text: qsTr("Forget")
                        enabled: !SmartSensorService.loading
                        onClicked: SmartSensorService.forget()
                    }
                }
                Text {
                    visible: SmartSensorService.checked && !SmartSensorService.ok
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: SmartSensorService.errorText
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeBody
                }
                Text {
                    visible: SmartSensorService.checked && SmartSensorService.ok && !SmartSensorService.found
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Not found - make sure it's powered on and nearby, then refresh.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Column {
                    visible: SmartSensorService.checked && SmartSensorService.ok && SmartSensorService.found
                    width: parent.width
                    spacing: 2
                    Text { text: qsTr("Model: %1 (%2)").arg(SmartSensorService.model).arg(SmartSensorService.manufacturer); color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    Text { text: qsTr("Serial: %1").arg(SmartSensorService.serial); color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    Text { text: qsTr("Firmware: %1  (hw %2, sw %3)").arg(SmartSensorService.fwRevision).arg(SmartSensorService.hwRevision).arg(SmartSensorService.swRevision); color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    Text { text: qsTr("Battery: %1").arg(SmartSensorService.batteryPercent >= 0 ? SmartSensorService.batteryPercent + "%" : qsTr("unknown")); color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    Text {
                        text: qsTr("Heart rate: %1").arg(
                            SmartSensorService.heartRateBpm > 0
                                ? SmartSensorService.heartRateBpm + " bpm"
                                : qsTr("not worn / no reading"))
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeBody
                    }
                }
            }
        }

        // --- Experimental Features. Real decision, 2026-08-11 (André, after a live BLE
        // session that same night hit real reliability trouble - see HANDOFF.md Milestone
        // 7 items 16-19): Bluetooth stays real, but opt-in and clearly labeled as still
        // being hardened, rather than part of the default cable-first Home experience.
        // "By default, only cable" - this toggle is what switches Home's own Bluetooth
        // section (HomePage.qml) on, off by default, persisted like Testing mode above. ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Row {
                    spacing: Theme.spacingSmall
                    Icon { glyph: Icons.watch; size: 20; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                    Text { text: qsTr("Experimental features"); font.bold: true; font.pixelSize: Theme.fontSizeBodyLarge; color: Theme.text; anchors.verticalCenter: parent.verticalCenter }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Bluetooth connectivity (Linux only). Still being hardened - " +
                                "cable stays the reliable default. Turning this on adds a " +
                                "\"Connect via Bluetooth\" option to the Home screen.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedSwitch {
                        anchors.verticalCenter: parent.verticalCenter
                        checked: DeviceService.bleExperimentEnabled
                        onToggled: DeviceService.bleExperimentEnabled = checked
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: DeviceService.bleExperimentEnabled ? qsTr("On") : qsTr("Off")
                        color: DeviceService.bleExperimentEnabled ? Theme.primary : Theme.mutedText
                        font.pixelSize: Theme.fontSizeBody
                    }
                }

                // --- Mark synced workouts. Opt-in, OFF by default (André, 2026-08-16).
                // Writes the watch's own per-move synced flag after this app reads a
                // workout, so the official Suunto app / SuuntoLink treat it as already
                // synced. Deliberately spells out the tradeoff so nobody turns it on
                // without understanding the data-loss risk. ---
                Item { width: 1; height: Theme.spacingSmall }
                Text {
                    text: qsTr("Mark synced workouts as synced for Suunto app and SuuntoLink")
                    font.bold: true
                    font.pixelSize: Theme.fontSizeBody
                    color: Theme.text
                    width: parent.width
                    wrapMode: Text.WordWrap
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Once a workout has been read here, tell the watch it is already " +
                                "synced. This avoids duplicated workouts in the Suunto app and " +
                                "SuuntoLink - but it also means the workout can no longer be " +
                                "retrieved again from the watch if the Suunto app fails to keep " +
                                "it. Leave off unless you understand this tradeoff.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeBody
                }
                Row {
                    spacing: Theme.spacingSmall
                    RoundedSwitch {
                        anchors.verticalCenter: parent.verticalCenter
                        checked: DeviceService.markSyncedEnabled
                        onToggled: DeviceService.markSyncedEnabled = checked
                    }
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: DeviceService.markSyncedEnabled ? qsTr("On") : qsTr("Off")
                        color: DeviceService.markSyncedEnabled ? Theme.primary : Theme.mutedText
                        font.pixelSize: Theme.fontSizeBody
                    }
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
