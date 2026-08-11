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
//
// Real, 2026-08-09 ("Full SuuntoLink-style redesign"): restructured from a single
// expand-in-place card list into a real List<->Detail flow (same pattern
// ActivitiesPage.qml's own selectedActivity already uses), matching SuuntoLink's own real
// "EDIT SPORT MODE" screen (assets/ambit3 pcap/v2/screens sports modes/8displaysmax.JPG) -
// a watch-face preview filmstrip through the mode's real screens (custom_modes.py's own
// screenNumber/isBuiltIn, so built-in system screens like Compass/Map are shown but not
// numbered as if they were user screens), and a real "SELECT DATA FOR ROW" picker
// (display1row1graphoptions.JPG) that now includes real Suunto App search/install
// alongside the existing field-type list. Adapted from SuuntoLink's own one-screen-at-a-
// time mobile paging to a horizontal filmstrip - the same real information and actions,
// fitted to this app's much wider desktop layout rather than a literal phone-screen clone.
Flickable {
    id: root
    contentWidth: width
    contentHeight: (root.selectedMode ? detailColumn.height : listColumn.height) + Theme.spacingLarge * 2
    clip: true

    property string selectedModeName: ""
    readonly property var selectedMode: {
        for (const m of CustomModesService.modes) {
            if (m.name === selectedModeName) return m
        }
        return null
    }
    readonly property int selectedModeIndex: {
        const modes = CustomModesService.modes
        for (let i = 0; i < modes.length; i++) {
            if (modes[i].name === selectedModeName) return i
        }
        return -1
    }
    property int currentDisplayIndex: 0
    // Staged edits belong to the mode they were made on, but they only get a mode name at
    // save time - so switching modes with edits pending would apply mode A's changes to
    // mode B. Dropping them here is the safe reading: nothing has been sent to the watch,
    // and silently retargeting them would be the one outcome nobody wants.
    onSelectedModeNameChanged: {
        currentDisplayIndex = 0
        root.pendingEdits = []
    }

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
    // Superseded 2026-08-10 by ActivityTypes (keyed on activityId, 84 real activities with
    // Suunto's own category colours). Kept only as a fallback for a caller that has a name
    // but no id; the badge itself no longer uses it.
    function sportBadgeColor(name) {
        return Theme.primary
    }

    // --- staged display edits (items 6 and 7) -------------------------------------------
    // The watch has no per-field command for sport modes: every save rewrites the whole
    // ~7.5 KB CustomModes region. So edits are staged here and written ONCE on Save, the
    // way SuuntoLink does - writing per click would cost a full region write per click.
    // Each entry is exactly what the backend expects:
    //   {op:"add", type:"3-row"} | {op:"remove", display:N}
    //   {op:"setType", display:N, type:"graph"} | {op:"setRow", display:N, row:"Bottom", values:[...]}
    property var pendingEdits: []
    readonly property bool hasPendingEdits: pendingEdits.length > 0
    readonly property var displayTypes: [
        { key: "3-row", label: qsTr("3 data fields") },
        { key: "2-row", label: qsTr("2 data fields") },
        { key: "1-row", label: qsTr("1 data field") },
        { key: "graph", label: qsTr("Graph") }
    ]

    function stageEdit(edit) {
        const next = pendingEdits.slice();
        next.push(edit);
        pendingEdits = next;
    }
    function discardEdits() { pendingEdits = [] }
    function saveEdits() {
        if (!hasPendingEdits || !root.selectedModeName)
            return;
        CustomModesService.applyDisplayEdits(root.selectedModeName, pendingEdits);
        pendingEdits = [];
    }
    // How many editable displays the mode has right now, plus whatever adds/removes are
    // staged - so the 8 limit and the "can I remove this" checks reflect what Save would
    // actually produce, not just what is on the watch.
    function stagedDisplayCount() {
        const mode = CustomModesService.modes.find(m => m.name === root.selectedModeName);
        let n = mode && mode.displays
            ? mode.displays.filter(d => !d.isBuiltIn).length : 0;
        for (const e of pendingEdits) {
            if (e.op === "add") n++;
            else if (e.op === "remove") n--;
        }
        return n;
    }

    // Real, 2026-08-09 - maps a real display's own template/field-count (custom_modes.py's
    // own decode) to WatchFacePreview's own layoutType. See custom_modes.py's
    // system_tail_length()/_displays_to_json() for isBuiltIn/screenNumber themselves.
    function displayLayoutType(disp) {
        if (disp.isBuiltIn) {
            return disp.template === "PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW" ? "map" : "builtin"
        }
        if (disp.template.indexOf("GRAPH") >= 0) return "graph"
        const n = disp.fields.length
        return n === 1 ? "1row" : n === 2 ? "2rows" : "3rows"
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

    // ============================== LIST VIEW ==============================
    Column {
        id: listColumn
        visible: !HomeViewModel.isKailash && !root.selectedMode
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

        ErrorBanner {
            width: parent.width
            detail: CustomModesService.ok ? "" : CustomModesService.lastError
            context: qsTr("reading or writing sport modes")
        }

        Repeater {
            model: CustomModesService.modes
            delegate: Card {
                id: modeCard
                width: listColumn.width
                required property var modelData
                readonly property bool busy: CustomModesService.writingMode === modelData.name

                TapHandler { onTapped: root.selectedModeName = modeCard.modelData.name }

                Item {
                    width: parent.width
                    height: 44

                    Row {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Theme.spacingMedium

                        // Real, 2026-08-10: colour AND symbol both come from the mode's own
                        // activityId (ActivityTypes, generated from
                        // assets/activity_types.json), not from its English name - the name
                        // is free text the owner can rename, and no other language matched
                        // the old lookup table at all.
                        ActivityBadge {
                            activityId: modeCard.modelData.activityId !== undefined
                                ? modeCard.modelData.activityId : -1
                            size: 44
                            anchors.verticalCenter: parent.verticalCenter
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
                                // Real, 2026-08-09 - counts only real, user-configurable
                                // screens (custom_modes.py's own screenNumber/isBuiltIn),
                                // not the built-in system screens - matches SuuntoLink's
                                // own real reported counts exactly (see that module's
                                // system_tail_length() docstring).
                                text: qsTr("%1 display(s)").arg(
                                    modeCard.modelData.displays.filter(d => !d.isBuiltIn).length)
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
                        Icon { glyph: Icons.chevronRight; size: 20; color: Theme.mutedText; anchors.verticalCenter: parent.verticalCenter }
                    }
                }
            }
        }
    }

    // ============================= DETAIL VIEW ==============================
    // Unsaved-changes bar. Sits above the detail view so it is impossible to miss - the
    // whole point of staging is that nothing reaches the watch until Save, so the state has
    // to be visible rather than implied.
    Card {
        id: pendingBar
        visible: root.hasPendingEdits && !HomeViewModel.isKailash && root.selectedMode
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingSmall
        width: 560
        z: 10
        Row {
            width: parent.width
            spacing: Theme.spacingMedium
            Column {
                width: parent.width - 240
                anchors.verticalCenter: parent.verticalCenter
                Text {
                    text: qsTr("%1 unsaved change(s)").arg(root.pendingEdits.length)
                    color: Theme.text
                    font.bold: true
                    font.pixelSize: Theme.fontSizeBody
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    text: qsTr("Nothing has been sent to the watch yet. Saving rewrites this "
                                + "mode's displays in one go.")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                }
            }
            RoundedButton {
                anchors.verticalCenter: parent.verticalCenter
                text: qsTr("Discard")
                enabled: !CustomModesService.writingMode
                onClicked: root.discardEdits()
            }
            RoundedButton {
                anchors.verticalCenter: parent.verticalCenter
                text: CustomModesService.writingMode ? qsTr("Saving...") : qsTr("Save to watch")
                enabled: !CustomModesService.writingMode
                onClicked: root.saveEdits()
            }
        }
    }

    Column {
        id: detailColumn
        visible: !HomeViewModel.isKailash && root.selectedMode
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: root.hasPendingEdits ? pendingBar.bottom : parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 560
        spacing: Theme.spacingMedium

        Row {
            width: parent.width
            spacing: Theme.spacingSmall
            RoundedButton {
                text: qsTr("< Back")
                onClicked: root.selectedModeName = ""
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.selectedMode ? root.selectedMode.name : ""
                font.bold: true
                font.pixelSize: Theme.fontSizeTitle
                color: Theme.text
            }
        }

        Card {
            width: parent.width
            visible: root.selectedMode !== null
            Column {
                id: modeColumn
                width: parent.width
                spacing: Theme.spacingMedium

                readonly property var mode: root.selectedMode
                readonly property bool busy: mode && CustomModesService.writingMode === mode.name

                // --- Name ---
                Column {
                    width: parent.width
                    spacing: 2
                    Text { text: qsTr("Name"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                    Row {
                        spacing: 6
                        RoundedTextField {
                            id: nameField
                            width: 200
                            enabled: !modeColumn.busy
                            // Real bug, found 2026-08-09 from a live screenshot ("strange
                            // characters" in a mode's name field, even though the real
                            // watch data was confirmed clean by reading it directly): a
                            // plain `text: ...` binding plus an imperative assignment
                            // elsewhere is a real QML footgun - the first imperative
                            // assignment permanently severs the declarative binding. Fixed
                            // with a proper `Binding` element instead, which re-evaluates
                            // correctly on every change.
                            Binding {
                                target: nameField
                                property: "text"
                                value: modeColumn.mode ? modeColumn.mode.name : ""
                                when: !nameField.activeFocus
                            }
                        }
                        RoundedButton {
                            text: qsTr("Rename")
                            enabled: modeColumn.mode && !modeColumn.busy && nameField.text.length > 0
                                     && nameField.text !== modeColumn.mode.name
                            onClicked: {
                                CustomModesService.renameMode(modeColumn.mode.name, nameField.text)
                                root.selectedModeName = nameField.text
                            }
                        }
                    }
                }

                // --- Autolap - real, 2026-08-09 ("let's make mit more elegant with a
                // toggle => off or when on value in the units of the watch"). Confirmed
                // via SuuntoLink's own real Autolap screen (assets/ambit3 pcap/v2/screens
                // sports modes/autolap.JPG): a plain "Use autolap" checkbox, and when on,
                // a distance shown in the real unit ("1.0 km"). ---
                Column {
                    spacing: 2
                    Text { text: qsTr("Autolap"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                    Row {
                        spacing: 6
                        RoundedSwitch {
                            id: autolapSwitch
                            anchors.verticalCenter: parent.verticalCenter
                            enabled: !modeColumn.busy
                            Binding {
                                target: autolapSwitch
                                property: "checked"
                                value: modeColumn.mode ? modeColumn.mode.autolap > 0 : false
                            }
                            onToggled: {
                                if (checked) {
                                    CustomModesService.writeField(modeColumn.mode.name,
                                        { "Autolap": Math.round(1 * root.autolapUnitDivisor) })
                                } else {
                                    CustomModesService.writeField(modeColumn.mode.name, { "Autolap": 0 })
                                }
                            }
                        }
                        RoundedTextField {
                            id: autolapField
                            visible: autolapSwitch.checked
                            width: 70
                            enabled: !modeColumn.busy
                            validator: DoubleValidator { bottom: 0; decimals: 2; notation: DoubleValidator.StandardNotation }
                            Binding {
                                target: autolapField
                                property: "text"
                                value: modeColumn.mode ? (modeColumn.mode.autolap / root.autolapUnitDivisor).toFixed(2) : "0"
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
                            enabled: !modeColumn.busy
                            onClicked: {
                                const parsed = parseFloat(autolapField.text);
                                if (isNaN(parsed) || parsed <= 0) return;
                                CustomModesService.writeField(modeColumn.mode.name,
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
                                checked: modeColumn.mode ? modeColumn.mode.hrLimitsUse === 1 : false
                                enabled: !modeColumn.busy
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
                            text: modeColumn.mode ? modeColumn.mode.hrLow : 0
                            enabled: !modeColumn.busy
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("High (bpm)"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        RoundedTextField {
                            id: hrHighField
                            width: 70
                            validator: IntValidator { bottom: 0; top: 255 }
                            text: modeColumn.mode ? modeColumn.mode.hrHigh : 0
                            enabled: !modeColumn.busy
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: " "; font.pixelSize: Theme.fontSizeLabel }  // vertical alignment spacer
                        RoundedButton {
                            text: qsTr("Set")
                            enabled: !modeColumn.busy
                            onClicked: CustomModesService.writeField(modeColumn.mode.name, {
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
                                    checked: modeColumn.mode ? (modeColumn.mode.useHw & podRow.modelData.bit) !== 0 : false
                                    enabled: !modeColumn.busy
                                    onToggled: {
                                        const newUseHw = checked
                                            ? (modeColumn.mode.useHw | podRow.modelData.bit)
                                            : (modeColumn.mode.useHw & ~podRow.modelData.bit)
                                        CustomModesService.writeField(modeColumn.mode.name, { "UseHw": newUseHw })
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
            }
        }

        // --- Displays: real SuuntoLink-style watch-face filmstrip + per-row editing ---
        Card {
            width: parent.width
            visible: root.selectedMode !== null
            Column {
                id: displaysColumn
                width: parent.width
                spacing: Theme.spacingMedium

                readonly property var displays: root.selectedMode ? root.selectedMode.displays : []
                readonly property var realDisplays: displays.filter(d => !d.isBuiltIn)

                Text {
                    text: qsTr("Displays (%1/8)").arg(displaysColumn.realDisplays.length)
                    font.bold: true
                    font.pixelSize: Theme.fontSizeBodyLarge
                    color: Theme.text
                }

                // Filmstrip - adapted from SuuntoLink's own one-at-a-time paging
                // (assets/ambit3 pcap/v2/screens sports modes/8displaysmax.JPG) to a
                // horizontal scroll, better suited to this app's own wide desktop layout.
                Flickable {
                    width: parent.width
                    height: 140
                    contentWidth: filmRow.width
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds

                    Row {
                        id: filmRow
                        spacing: Theme.spacingMedium
                        Repeater {
                            model: displaysColumn.displays
                            delegate: Column {
                                id: filmItem
                                required property var modelData
                                required property int index
                                spacing: 4
                                WatchFacePreview {
                                    diameter: 100
                                    layoutType: root.displayLayoutType(filmItem.modelData)
                                    selected: index === root.currentDisplayIndex
                                    TapHandler { onTapped: root.currentDisplayIndex = filmItem.index }
                                }
                                Text {
                                    width: 100
                                    horizontalAlignment: Text.AlignHCenter
                                    text: filmItem.modelData.isBuiltIn
                                        ? qsTr("Built-in")
                                        : qsTr("Display %1").arg(filmItem.modelData.screenNumber)
                                    color: Theme.mutedText
                                    font.pixelSize: Theme.fontSizeCaption
                                }
                            }
                        }
                    }
                }

                // Current screen's own detail - matches SuuntoLink's own "DISPLAY: N ROWS"
                // list (display3rows_down5max.JPG): one row per field, each tappable to
                // open the data picker below.
                Column {
                    id: currentScreenColumn
                    width: parent.width
                    spacing: Theme.spacingSmall
                    visible: displaysColumn.displays.length > root.currentDisplayIndex

                    readonly property var current: visible ? displaysColumn.displays[root.currentDisplayIndex] : null

                    Text {
                        visible: currentScreenColumn.current
                        text: currentScreenColumn.current
                            ? (currentScreenColumn.current.isBuiltIn
                               ? qsTr("Built-in: %1").arg(currentScreenColumn.current.templateLabel)
                               : qsTr("Display %1").arg(currentScreenColumn.current.screenNumber))
                            : ""
                        font.bold: true
                        color: Theme.text
                    }
                    Text {
                        visible: currentScreenColumn.current && currentScreenColumn.current.isBuiltIn
                        width: parent.width
                        wrapMode: Text.WordWrap
                        text: qsTr("A built-in watch display (Compass, Navigation, Map, " +
                                    "etc.) - not one of your own configurable displays, " +
                                    "so its data isn't editable here.")
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeCaption
                    }

                    // --- display type (item 7) ------------------------------------
                    Row {
                        visible: currentScreenColumn.current && !currentScreenColumn.current.isBuiltIn
                        spacing: Theme.spacingSmall
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: qsTr("Type")
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeBody
                        }
                        Repeater {
                            model: root.displayTypes
                            delegate: RoundedButton {
                                required property var modelData
                                text: modelData.label
                                enabled: !CustomModesService.writingMode
                                onClicked: root.stageEdit({
                                    "op": "setType",
                                    "display": root.currentDisplayIndex,
                                    "type": modelData.key
                                })
                            }
                        }
                    }

                    // --- add / remove a display (item 6) ---------------------------------
                    Row {
                        spacing: Theme.spacingSmall
                        RoundedButton {
                            text: qsTr("Add display")
                            // SuuntoLink's own getMaxDisplays() for this watch family is 8;
                            // counted against the staged result, not just what is on the
                            // watch, so two staged adds cannot overshoot.
                            enabled: root.stagedDisplayCount() < 8 && !CustomModesService.writingMode
                            onClicked: root.stageEdit({ "op": "add", "type": "3-row" })
                        }
                        RoundedButton {
                            text: qsTr("Remove this display")
                            enabled: currentScreenColumn.current
                                && !currentScreenColumn.current.isBuiltIn
                                && root.stagedDisplayCount() > 1
                                && !CustomModesService.writingMode
                            onClicked: root.stageEdit({
                                "op": "remove",
                                "display": root.currentDisplayIndex
                            })
                        }
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: qsTr("%1 of 8 displays").arg(root.stagedDisplayCount())
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeCaption
                        }
                    }

                    Repeater {
                        model: (currentScreenColumn.current && !currentScreenColumn.current.isBuiltIn)
                            ? currentScreenColumn.current.fields : []
                        delegate: Row {
                            id: fieldRow
                            required property var modelData
                            required property int index
                            width: parent.width
                            spacing: Theme.spacingSmall

                            // Real, 2026-08-10 (André, item 11). A row is named
                            // Top/Center/Bottom on the watch (sport_mode.js FieldId), not
                            // numbered - and it can hold SEVERAL values, which
                            // custom_modes.py now reports as `values`. Showing only
                            // `typeLabel` hid every extra value: Openwater swim's bottom row
                            // carries both Swim Pace (average) and Stroke Rate (average) and
                            // rendered as one meaningless entry.
                            Text {
                                width: 56
                                anchors.verticalCenter: parent.verticalCenter
                                text: fieldRow.modelData.rowLabel
                                    ? fieldRow.modelData.rowLabel
                                    : qsTr("%1.").arg(fieldRow.index + 1)
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeBody
                            }
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 1
                                Repeater {
                                    model: fieldRow.modelData.values
                                        ? fieldRow.modelData.values
                                        : [{ "label": fieldRow.modelData.typeLabel }]
                                    delegate: Text {
                                        required property var modelData
                                        text: modelData.label
                                        color: Theme.text
                                        font.pixelSize: Theme.fontSizeBody
                                    }
                                }
                                // Only the bottom row can hold more than one value, and the
                                // wearer steps through them with a button - automatically
                                // only when the mode's own autoscroll is on (André).
                                Text {
                                    visible: fieldRow.modelData.isMultiValue === true
                                    text: qsTr("%1 values - press to step through")
                                        .arg(fieldRow.modelData.values.length)
                                    color: Theme.mutedText
                                    font.pixelSize: Theme.fontSizeCaption
                                }
                            }
                            Item { width: 1; height: 1 }
                            RoundedButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("Change")
                                onClicked: {
                                    // The picker needs the row's full context, not just
                                    // which row: what may go on it depends on the mode's
                                    // sport, the display's type and which row it is.
                                    dataPicker.displayIndex = root.currentDisplayIndex
                                    dataPicker.fieldIndex = fieldRow.index
                                    dataPicker.activityId = root.selectedMode
                                        ? root.selectedMode.activityId : 1
                                    dataPicker.displayTemplate =
                                        currentScreenColumn.current
                                            ? currentScreenColumn.current.templateId : 260
                                    dataPicker.rowName = fieldRow.modelData.rowLabel
                                        ? fieldRow.modelData.rowLabel.toUpperCase()
                                        : "TOP"
                                    dataPicker.selected =
                                        (fieldRow.modelData.values || [])
                                            .map(v => v.type)
                                            .filter(v => v !== undefined)
                                    dataPicker.open()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    DataPickerDialog {
        id: dataPicker
        modeName: root.selectedMode ? root.selectedMode.name : ""
        modeIndex: root.selectedModeIndex
        hasPendingEdits: root.hasPendingEdits
        anchors.centerIn: Overlay.overlay

        // Staged, not written - one Save means one region write, the same as every other
        // display edit on this page.
        onRowChosen: (displayIndex, rowName, fieldIds) => root.stageEdit({
            "op": "setRow",
            "display": displayIndex,
            "row": rowName.charAt(0) + rowName.slice(1).toLowerCase(),
            "values": fieldIds
        })
    }
}
