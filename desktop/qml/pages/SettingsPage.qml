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
        spacing: Theme.spacingMedium

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
                Text { text: qsTr("General"); font.bold: true; color: Theme.text }
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
                Text { text: qsTr("Supported devices"); font.bold: true; color: Theme.text }
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
                width: parent.width
                spacing: Theme.spacingMedium

                Text {
                    // Real, 2026-08-09 ("it says Ambit3 settings, please link this to the
                    // name of the device, since tomorrow we will support more devices") -
                    // was hardcoded to one of two fixed strings; now reads the real
                    // connected device's own name (HomeViewModel.deviceDisplayName, the same
                    // one Home's own device card already shows) so a future third/fourth
                    // supported device needs no new branch here at all.
                    text: qsTr("%1 Settings").arg(HomeViewModel.deviceDisplayName)
                    font.bold: true
                    color: Theme.text
                }

                Text {
                    visible: SettingsWriteService.loading && SettingsWriteService.settings.length === 0
                    color: Theme.mutedText
                    text: qsTr("Reading settings off the watch...")
                }

                Text {
                    visible: !SettingsWriteService.ok && SettingsWriteService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: SettingsWriteService.lastError
                }

                Repeater {
                    model: SettingsWriteService.settings
                    delegate: Row {
                        width: parent.width
                        spacing: Theme.spacingSmall

                        // "display_dark" -> "Display dark" - a light label formatter, not a
                        // second name table to keep in sync with settings_write.py's own.
                        readonly property string label: {
                            const parts = modelData.key.split("_");
                            parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                            return parts.join(" ");
                        }
                        readonly property bool hasRange:
                            modelData.min !== undefined && modelData.min !== null
                            && modelData.max !== undefined && modelData.max !== null
                        // Real, 2026-08-08, Kailash only - HomeLocation.Latitude/Longitude
                        // (entry 0x36, a GROUP - see settings_write.py's own KAILASH_SETTINGS
                        // comment and the ambit_app_kailash_home_location_field memory).
                        // describe_field() reports these as a plain "number" with no min/max
                        // (like compass_declination), but unlike that field these ARE meant
                        // to be editable - keyed off `path` since `kind` alone can't tell
                        // them apart from compass_declination's own read-only display.
                        readonly property bool isHomeCoord:
                            modelData.path.endsWith("HomeLocation.Latitude")
                            || modelData.path.endsWith("HomeLocation.Longitude")

                        Text {
                            width: 170
                            anchors.verticalCenter: parent.verticalCenter
                            text: parent.label
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                        }

                        RoundedSwitch {
                            visible: modelData.kind === "bool"
                            anchors.verticalCenter: parent.verticalCenter
                            checked: modelData.value === 1 || modelData.value === true
                            enabled: SettingsWriteService.writingKey !== modelData.key
                            onToggled: SettingsWriteService.writeSetting(modelData.key, checked ? 1 : 0)
                        }

                        RoundedComboBox {
                            visible: modelData.kind === "enum"
                            width: 220
                            model: modelData.choices
                            textRole: "label"
                            valueRole: "value"
                            enabled: SettingsWriteService.writingKey !== modelData.key
                            currentIndex: {
                                for (let i = 0; i < modelData.choices.length; i++) {
                                    if (modelData.choices[i].value === modelData.value) return i;
                                }
                                return -1;
                            }
                            onActivated: SettingsWriteService.writeSetting(modelData.key, currentValue)
                        }

                        Row {
                            visible: modelData.kind === "number" && parent.hasRange
                            spacing: 8
                            RoundedSlider {
                                anchors.verticalCenter: parent.verticalCenter
                                width: 160
                                from: modelData.min
                                // Real screenshot range for brightness/contrast is 0-100%
                                // even though the schema's own uint8 type allows up to
                                // 255 - clamped to the range SuuntoLink itself exposes.
                                to: Math.min(modelData.max, 100)
                                value: modelData.value
                                enabled: SettingsWriteService.writingKey !== modelData.key
                                onMoved: SettingsWriteService.writeSetting(modelData.key, Math.round(value))
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData.value
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeLabel
                            }
                        }

                        // A "number" field with no confirmed min/max (compass_declination) -
                        // shown, not editable, rather than guessing at a sensible slider range.
                        Text {
                            visible: modelData.kind === "number" && !parent.hasRange && !parent.isHomeCoord
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData.value
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeBody
                        }

                        // HomeLocation.Latitude/Longitude - free-text degrees input rather
                        // than a slider (no sensible min/max range for a GPS coordinate) or
                        // a stepper (needs a leading "-" and sub-degree precision a +-N
                        // button can't offer). Matches the Weather "Manual location" editor's
                        // own TextField+Button pattern further down this same page.
                        Row {
                            visible: modelData.kind === "number" && !parent.hasRange && parent.isHomeCoord
                            spacing: 8
                            RoundedTextField {
                                id: coordField
                                anchors.verticalCenter: parent.verticalCenter
                                width: 110
                                text: modelData.value.toFixed(6)
                                enabled: SettingsWriteService.writingKey !== modelData.key
                            }
                            RoundedButton {
                                anchors.verticalCenter: parent.verticalCenter
                                text: qsTr("Set")
                                enabled: SettingsWriteService.writingKey !== modelData.key
                                onClicked: {
                                    const parsed = parseFloat(coordField.text);
                                    if (isNaN(parsed)) return;
                                    SettingsWriteService.writeSetting(modelData.key, parsed);
                                }
                            }
                        }

                        Text {
                            visible: SettingsWriteService.writingKey === modelData.key
                            anchors.verticalCenter: parent.verticalCenter
                            text: qsTr("saving...")
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeCaption
                            font.italic: true
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
                Text { text: qsTr("Connections"); font.bold: true; color: Theme.text }

                Row {
                    spacing: 8
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
                    spacing: 8
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
                    spacing: 8
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
                Text { text: qsTr("Maps"); font.bold: true; color: Theme.text }
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
                    RadioButton {
                        autoExclusive: false
                        checked: MapService.provider === "osm"
                        text: qsTr("OpenStreetMap (standard)")
                        onClicked: MapService.provider = "osm"
                    }
                    RadioButton {
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

                Text { text: qsTr("Weather"); font.bold: true; color: Theme.text }
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
                    RadioButton {
                        checked: true
                        text: qsTr("This computer (IP-based)")
                        onCheckedChanged: if (checked) WeatherService.detectLocationFromIp()
                    }
                    RadioButton { text: qsTr("Manual") }
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
                Text { text: qsTr("Backup"); font.bold: true; color: Theme.text }
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
                Text { text: qsTr("About"); font.bold: true; color: Theme.text }
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
