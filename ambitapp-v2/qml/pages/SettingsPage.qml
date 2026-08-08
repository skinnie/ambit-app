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
                    font.pixelSize: 12
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
                        font.pixelSize: 12
                    }
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: 11
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
                        text: qsTr("Suunto Ambit3 (USB, via the local backend)")
                        color: Theme.mutedText
                        font.pixelSize: 12
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
                        font.pixelSize: 12
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
                        font.pixelSize: 13
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
                        font.pixelSize: 13
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
                        font.pixelSize: 13
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
                    font.pixelSize: 11
                    text: qsTr("Athlete ID and API key from intervals.icu → Settings → " +
                                "Developer Settings. Stored locally on this computer, not " +
                                "sent anywhere except intervals.icu itself.")
                }
                TextField {
                    id: athleteIdField
                    width: parent.width
                    placeholderText: qsTr("Athlete ID (e.g. i12345)")
                }
                TextField {
                    id: apiKeyField
                    width: parent.width
                    placeholderText: qsTr("API key")
                    echoMode: TextInput.Password
                }
                Row {
                    spacing: Theme.spacingSmall
                    Button {
                        text: qsTr("Save")
                        enabled: athleteIdField.text.length > 0 && apiKeyField.text.length > 0
                        onClicked: {
                            ConnectionsService.saveIntervalsIcu(athleteIdField.text, apiKeyField.text)
                            intervalsIcuDialog.close()
                        }
                    }
                    Button {
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
                    font.pixelSize: 11
                    text: qsTr("API key from your Runalyze account. Stored locally on " +
                                "this computer, not sent anywhere except runalyze.com " +
                                "itself.")
                }
                TextField {
                    id: runalyzeApiKeyField
                    width: parent.width
                    placeholderText: qsTr("API key")
                    echoMode: TextInput.Password
                }
                Row {
                    spacing: Theme.spacingSmall
                    Button {
                        text: qsTr("Save")
                        enabled: runalyzeApiKeyField.text.length > 0
                        onClicked: {
                            ConnectionsService.saveRunalyze(runalyzeApiKeyField.text)
                            runalyzeDialog.close()
                        }
                    }
                    Button {
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
                    font.pixelSize: 11
                    text: qsTr("Real OAuth2, not a personal API key like the other two - " +
                                "register your own app at strava.com/settings/api first " +
                                "(Authorization Callback Domain: localhost), then paste its " +
                                "Client ID and Client Secret below. Connect opens Strava in " +
                                "your browser; approving there sends you back here " +
                                "automatically.")
                }
                TextField {
                    id: stravaClientIdField
                    width: parent.width
                    placeholderText: qsTr("Client ID")
                }
                TextField {
                    id: stravaClientSecretField
                    width: parent.width
                    placeholderText: qsTr("Client Secret")
                    echoMode: TextInput.Password
                }
                Text {
                    visible: ConnectionsService.stravaConnecting
                    text: qsTr("Waiting for you to approve in the browser...")
                    color: Theme.mutedText
                    font.pixelSize: 12
                }
                Text {
                    visible: !ConnectionsService.stravaConnecting
                             && ConnectionsService.stravaError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 12
                    text: ConnectionsService.stravaError
                }
                Row {
                    spacing: Theme.spacingSmall
                    Button {
                        text: ConnectionsService.stravaConnecting
                            ? qsTr("Connecting...") : qsTr("Connect")
                        enabled: !ConnectionsService.stravaConnecting
                                 && stravaClientIdField.text.length > 0
                                 && stravaClientSecretField.text.length > 0
                        onClicked: ConnectionsService.connectStrava(
                            stravaClientIdField.text, stravaClientSecretField.text)
                    }
                    Button {
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
                    font.pixelSize: 13
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
                    font.pixelSize: 12
                }

                Text { text: qsTr("Location source"); color: Theme.text; font.pixelSize: 13 }
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
                    TextField {
                        id: latField
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Latitude")
                        text: WeatherService.latitude.toString()
                    }
                    TextField {
                        id: lonField
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Longitude")
                        text: WeatherService.longitude.toString()
                    }
                }
                Button {
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
                    font.pixelSize: 12
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
                    text: qsTr("AmbitApp V2.5.0")
                    color: Theme.text
                    font.pixelSize: 13
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: 11
                    text: qsTr("Independent, unofficial software - not affiliated with, " +
                                "endorsed by, or supported by Suunto or Garmin. Map data © " +
                                "OpenStreetMap contributors. Icons: Google Material " +
                                "Symbols (Apache License 2.0).")
                }
                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: 11
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
                    font.pixelSize: 11
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
