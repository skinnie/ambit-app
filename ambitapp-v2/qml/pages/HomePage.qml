import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 4: real device-hero layout. Step 5 adds real weather. Last Activity made real
// 2026-08-07 once ActivityService actually worked - see its own card comment below.
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    Component.onCompleted: {
        DeviceService.refresh();
        // IP-based location by default, real request 2026-08-07 (was a hardcoded central-
        // Europe default before) - detectLocationFromIp() calls refresh() itself once it has
        // real coordinates, or falls back to refresh()-with-whatever-it-had if the IP lookup
        // itself fails, so this always ends in a real fetch attempt either way.
        WeatherService.detectLocationFromIp();
        ActivityService.refresh();
        DeviceService.checkGpsOrbitStatus();
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        spacing: Theme.spacingMedium

        // --- Device hero card: the watch is the hero, only one, per the spec ---
        Card {
            width: parent.width

            Column {
                width: parent.width
                spacing: Theme.spacingMedium

                Row {
                    width: parent.width
                    spacing: Theme.spacingMedium

                    // Standing in for the real Ambit3 Peak Sapphire product photo the spec
                    // asks for (from Suunto's own Android app resources) - not pulled in
                    // yet on purpose: those images are proprietary Suunto assets
                    // (assets/ is gitignored for exactly this reason project-wide), so
                    // using one here needs a real licensing check first, the same care
                    // already applied to not reusing SuuntoLink's own icon for this app's
                    // icon. A real product photo replaces this once that's settled.
                    Rectangle {
                        width: 64
                        height: 64
                        radius: Theme.radiusSmall
                        color: Theme.background
                        Icon { anchors.centerIn: parent; glyph: Icons.watch; size: 32 }
                    }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2

                        Text {
                            // Real when the backend/watch answer (DeviceService.model, via
                            // tools/device_info.py, confirmed working on real hardware
                            // 2026-08-07) - falls back to the static reference-watch name
                            // otherwise, same as before.
                            text: HomeViewModel.deviceDisplayName
                            font.pixelSize: 18
                            font.bold: true
                            color: Theme.text
                        }
                        Row {
                            spacing: 6
                            Rectangle {
                                width: 8; height: 8; radius: 4
                                anchors.verticalCenter: parent.verticalCenter
                                color: HomeViewModel.connectionStatusColor
                            }
                            Text {
                                text: HomeViewModel.connectionStatusText
                                color: Theme.mutedText
                                font.pixelSize: 13
                            }
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge

                    Column {
                        spacing: 2
                        Text { text: qsTr("Battery"); color: Theme.mutedText; font.pixelSize: 12 }
                        Text { text: HomeViewModel.batteryText; color: Theme.text; font.pixelSize: 13 }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Firmware"); color: Theme.mutedText; font.pixelSize: 12 }
                        Text { text: HomeViewModel.firmwareText; color: Theme.text; font.pixelSize: 13 }
                    }
                    Column {
                        width: 140
                        spacing: 2
                        Text { text: qsTr("GPS orbit"); color: Theme.mutedText; font.pixelSize: 12 }
                        // Real, 2026-08-07 (was "Not available yet" - the backend side,
                        // sgee_andre.md, was already built and hardware-verified, only this
                        // UI was missing). Passively shows the watch's own currently-stored
                        // orbit date on every Home load (checkGpsOrbitStatus(), read-only,
                        // works even offline); tapping runs the real update flow
                        // (updateGpsOrbit()) - download-if-online-and-stale, else honestly
                        // report why not, matching this app's own "explicit tap for any
                        // write" rule elsewhere (Routes/Backup) rather than writing to the
                        // watch just from loading this page.
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            text: DeviceService.gpsOrbitBusy
                                ? qsTr("Checking...")
                                : (DeviceService.gpsOrbitStatusText || qsTr("Tap to check"))
                            color: Theme.primary
                            font.pixelSize: 13
                            font.underline: !DeviceService.gpsOrbitBusy
                            TapHandler {
                                enabled: !DeviceService.gpsOrbitBusy
                                onTapped: DeviceService.updateGpsOrbit()
                            }
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge

                    Column {
                        spacing: 2
                        Text { text: qsTr("Serial number"); color: Theme.mutedText; font.pixelSize: 12 }
                        Text { text: HomeViewModel.serialText; color: Theme.text; font.pixelSize: 13 }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Hardware"); color: Theme.mutedText; font.pixelSize: 12 }
                        Text { text: HomeViewModel.hardwareText; color: Theme.text; font.pixelSize: 13 }
                    }
                }

                Button {
                    text: DeviceService.loading ? qsTr("Checking...") : qsTr("Refresh")
                    enabled: !DeviceService.loading
                    onClicked: DeviceService.refresh()
                }

                Text {
                    visible: DeviceService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 12
                    text: DeviceService.lastError
                }
            }
        }

        // --- Weather (Step 5) - collapses to nothing on its own if unavailable ---
        WeatherCard {}

        // --- Last Activity - real, 2026-08-07 (was a Step 7 placeholder before
        // ActivityService actually worked; "New Activities" and the Home "Connections" card
        // were both dropped the same day - New Activities duplicated this card with nothing
        // else to say, and Connections already has a real home on Settings). ---
        Card {
            width: parent.width
            visible: ActivityService.loading || lastActivityColumn.activity !== null
                     || ActivityService.lastError.length > 0
            Column {
                id: lastActivityColumn
                width: parent.width
                spacing: Theme.spacingSmall

                readonly property var activity: ActivityViewModel.mostRecent(ActivityService.activities)

                Row {
                    spacing: Theme.spacingSmall
                    Text { text: qsTr("Last Activity"); font.bold: true; color: Theme.text }
                    Text {
                        visible: ActivityService.showingCachedData
                        anchors.verticalCenter: parent.verticalCenter
                        text: qsTr("(cached)")
                        font.italic: true
                        font.pixelSize: 11
                        color: Theme.mutedText
                    }
                }

                Text {
                    visible: ActivityService.loading
                    color: Theme.mutedText
                    text: qsTr("Reading activities off the watch...")
                }

                Text {
                    visible: !ActivityService.loading && ActivityService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 12
                    text: ActivityService.lastError
                }

                Row {
                    visible: !ActivityService.loading && lastActivityColumn.activity !== null
                    width: parent.width
                    spacing: Theme.spacingMedium

                    Icon { glyph: Icons.activities; size: 28; color: Theme.primary }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            text: lastActivityColumn.activity
                                  ? (lastActivityColumn.activity.name || qsTr("Untitled activity"))
                                  : ""
                            font.bold: true
                            color: Theme.text
                            font.pixelSize: 14
                        }
                        Text {
                            text: lastActivityColumn.activity
                                  ? ActivityViewModel.formatDate(lastActivityColumn.activity.startTime)
                                  : ""
                            color: Theme.mutedText
                            font.pixelSize: 12
                        }
                    }
                }

                Row {
                    visible: !ActivityService.loading && lastActivityColumn.activity !== null
                    width: parent.width
                    spacing: Theme.spacingLarge
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatDistance(lastActivityColumn.activity.distanceMeters)
                              : ""
                        color: Theme.text
                        font.pixelSize: 12
                    }
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatDuration(lastActivityColumn.activity.durationSeconds)
                              : ""
                        color: Theme.text
                        font.pixelSize: 12
                    }
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatElevation(lastActivityColumn.activity.ascentMeters)
                              : ""
                        color: Theme.text
                        font.pixelSize: 12
                    }
                }
            }
        }
    }
}
