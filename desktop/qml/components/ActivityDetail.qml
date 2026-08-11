import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import AmbitApp

// AMBITAPP_SPEC.md: "Selecting an activity opens: Large MapLibre map, Overview, Charts,
// Laps, Export, Upload, Notes." Overview and Export (real, 2026-08-07 - see below) are
// real; the rest stay honest placeholders - each needs its own real piece of work not yet
// done (a charting library choice for Charts, lap-boundary parsing exercise_log.py doesn't
// expose yet for Laps, real cloud auth for Upload, local persistence for Notes) rather than
// being faked here.
Item {
    id: root
    property var activity
    property string saveError: ""
    signal back

    // Real request 2026-08-07: "built the export to gpx and to fit... save to file, default
    // location downloads" - the real bytes already exist on `activity` (ActivityService now
    // keeps gpxText/fitBase64, not just the fields parsed out of them), this just needed a
    // save dialog wired to LocalFileService, the same helper Routes' export uses.
    FileDialog {
        id: gpxExportDialog
        title: qsTr("Export activity as GPX")
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("GPX files (*.gpx)")]
        currentFolder: LocalFileService.downloadsLocation
        onAccepted: root.saveError = LocalFileService.saveText(selectedFile, activity.gpxText)
    }
    FileDialog {
        id: fitExportDialog
        title: qsTr("Export activity as FIT")
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("FIT files (*.fit)")]
        currentFolder: LocalFileService.downloadsLocation
        onAccepted: root.saveError = LocalFileService.saveBase64(selectedFile, activity.fitBase64)
    }

    readonly property var _center: ActivityViewModel.trackCenter(activity ? activity.track : null)
    readonly property var _tabs: [qsTr("Overview"), qsTr("Charts"), qsTr("Laps"),
                                    qsTr("Export"), qsTr("Upload"), qsTr("Notes")]
    property int currentTab: 0

    Column {
        anchors.fill: parent
        spacing: Theme.spacingMedium

        Row {
            width: parent.width
            spacing: Theme.spacingSmall
            leftPadding: Theme.spacingLarge
            topPadding: Theme.spacingLarge

            Icon {
                glyph: Icons.arrowBack
                size: 20
                anchors.verticalCenter: parent.verticalCenter
                TapHandler { onTapped: root.back() }
            }
            Text {
                text: activity ? (activity.name || qsTr("Untitled activity")) : ""
                font.pixelSize: Theme.fontSizeTitle
                font.bold: true
                color: Theme.text
                anchors.verticalCenter: parent.verticalCenter
            }
        }

        Item {
            width: parent.width - Theme.spacingLarge * 2
            x: Theme.spacingLarge
            height: 280

            MapView {
                anchors.fill: parent
                visible: root._center !== null
                latitude: root._center ? root._center.lat : 0
                longitude: root._center ? root._center.lon : 0
                zoomLevel: 13
                showZoomControls: true
                trackPoints: (root.activity && root.activity.track) || []
            }
            Rectangle {
                visible: root._center === null
                anchors.fill: parent
                color: Theme.card
                radius: Theme.radiusCard
                Text {
                    anchors.centerIn: parent
                    text: qsTr("No GPS track for this activity")
                    color: Theme.mutedText
                }
            }
        }

        Row {
            x: Theme.spacingLarge
            spacing: Theme.spacingMedium

            Repeater {
                model: root._tabs
                delegate: Text {
                    text: modelData
                    font.bold: index === root.currentTab
                    color: index === root.currentTab ? Theme.primary : Theme.mutedText
                    TapHandler { onTapped: root.currentTab = index }
                }
            }
        }

        Card {
            x: Theme.spacingLarge
            width: parent.width - Theme.spacingLarge * 2

            // --- Overview: real data ---
            Column {
                width: parent.width
                visible: root.currentTab === 0
                spacing: Theme.spacingSmall

                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge
                    Column {
                        spacing: 2
                        Text { text: qsTr("Distance"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: activity ? ActivityViewModel.formatDistance(activity.distanceMeters) : ""
                            color: Theme.text; font.pixelSize: Theme.fontSizeSubtitle; font.bold: true
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Duration"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: activity ? ActivityViewModel.formatDuration(activity.durationSeconds) : ""
                            color: Theme.text; font.pixelSize: Theme.fontSizeSubtitle; font.bold: true
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Elevation gain"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: activity ? ActivityViewModel.formatElevation(activity.ascentMeters) : ""
                            color: Theme.text; font.pixelSize: Theme.fontSizeSubtitle; font.bold: true
                        }
                    }
                }
                Text {
                    text: activity ? qsTr("%1 GPS points recorded").arg(activity.track.length) : ""
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                }
            }

            // --- Export: real, 2026-08-07 ---
            Column {
                width: parent.width
                visible: root.currentTab === 3
                spacing: Theme.spacingSmall

                Row {
                    spacing: Theme.spacingSmall
                    RoundedButton {
                        text: qsTr("Export as GPX")
                        enabled: activity && activity.gpxText && activity.gpxText.length > 0
                        onClicked: {
                            const safeName = (activity.name || "activity").replace(/[\\/:*?"<>|]/g, "_")
                            gpxExportDialog.currentFile =
                                LocalFileService.downloadsLocation + "/" + safeName + ".gpx"
                            gpxExportDialog.open()
                        }
                    }
                    RoundedButton {
                        text: qsTr("Export as FIT")
                        enabled: activity && activity.fitBase64 && activity.fitBase64.length > 0
                        onClicked: {
                            const safeName = (activity.name || "activity").replace(/[\\/:*?"<>|]/g, "_")
                            fitExportDialog.currentFile =
                                LocalFileService.downloadsLocation + "/" + safeName + ".fit"
                            fitExportDialog.open()
                        }
                    }
                }
                Text {
                    visible: activity && (!activity.fitBase64 || activity.fitBase64.length === 0)
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("No FIT data for this activity (GPS-less entries can't be " +
                                "converted - see exercise_log.py).")
                }
                Text {
                    visible: root.saveError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Couldn't save: %1").arg(root.saveError)
                }
            }

            // --- Everything else: honest, not faked ---
            Text {
                width: parent.width
                visible: root.currentTab !== 0 && root.currentTab !== 3
                wrapMode: Text.WordWrap
                color: Theme.mutedText
                text: {
                    switch (root.currentTab) {
                    case 1: return qsTr("Charts - not built yet. Needs a charting library " +
                                          "decision (elevation/pace over time from the real " +
                                          "track data, which is already available).");
                    case 2: return qsTr("Laps - not built yet. exercise_log.py doesn't " +
                                          "expose lap boundaries in its parsed output yet.");
                    case 4: return qsTr("Upload - not built yet. Needs real auth against " +
                                          "Intervals.icu/Runalyze/Strava, none of which are " +
                                          "connected yet (see the Connections card on Home).");
                    case 5: return qsTr("Notes - not built yet. Needs local persistence " +
                                          "that doesn't exist anywhere in this app yet.");
                    default: return "";
                    }
                }
            }
        }
    }
}
