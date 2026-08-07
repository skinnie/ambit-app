import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import AmbitApp

// Step 8. Real on-watch route list (parsed from write_nav.py's own summary output) + real
// Import/Upload flow. "Drag & Drop GPX" stays future per the spec itself; a file picker
// covers Import GPX for real today. Export (real, 2026-08-07 - see RouteService's own header
// comment) opens a real save dialog per route, defaulting to the Downloads folder.
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    Component.onCompleted: RouteService.refresh()

    // Which on-watch route the last "Export" tap was for - the backend response
    // (exportedGpx) doesn't carry the route's name back, so it's kept here to suggest a
    // real filename in the save dialog below rather than a generic one.
    property int pendingExportIndex: -1
    property string pendingExportName: ""
    property string saveError: ""

    FileDialog {
        id: fileDialog
        title: qsTr("Import GPX")
        nameFilters: [qsTr("GPX files (*.gpx)")]
        onAccepted: RouteService.loadGpxFile(selectedFile)
    }

    // Real request 2026-08-07: "export as gpx and open window to select where to save,
    // where default location is downloads folder" - matches the real Android app's own
    // save-to-Downloads behavior as closely as a real desktop save dialog can (Android
    // saves there directly with no picker at all; a picker defaulting there is the honest
    // desktop equivalent, not a lesser version of it).
    FileDialog {
        id: exportDialog
        title: qsTr("Export route as GPX")
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("GPX files (*.gpx)")]
        currentFolder: LocalFileService.downloadsLocation
        onAccepted: {
            root.saveError = LocalFileService.saveText(selectedFile, RouteService.exportedGpx)
        }
    }

    Connections {
        target: RouteService
        function onExportedGpxChanged() {
            if (RouteService.exportedGpx.length === 0) return
            const safeName = root.pendingExportName.replace(/[\\/:*?"<>|]/g, "_")
            exportDialog.currentFile = LocalFileService.downloadsLocation + "/" + safeName + ".gpx"
            exportDialog.open()
        }
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 520
        spacing: Theme.spacingMedium

        // --- Import / Upload ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Import a route"); font.bold: true; color: Theme.text }

                Button {
                    text: qsTr("Import GPX…")
                    onClicked: fileDialog.open()
                }

                // Thumbnail map preview - real request 2026-08-07 ("the bug of no map
                // while not importing gpx persists... use pc location"): always visible now,
                // not just once a file's loaded - centers on WeatherService's own IP-detected
                // location (same default HomePage/PoisPage already use) until a real track
                // exists, instead of hiding the map entirely or showing (0, 0), the Gulf of
                // Guinea, empty ocean either way.
                Item {
                    width: parent.width
                    height: 160

                    MapView {
                        anchors.fill: parent
                        readonly property var center:
                            RouteViewModel.trackCenter(RouteService.pendingRoute.track)
                        latitude: center ? center.lat : WeatherService.latitude
                        longitude: center ? center.lon : WeatherService.longitude
                        zoomLevel: center ? 12 : 10
                        trackPoints: RouteService.pendingRoute.track || []
                    }
                }

                Text {
                    visible: RouteService.pendingRoute.name !== undefined
                    text: RouteService.pendingRoute.name || ""
                    color: Theme.text
                    font.pixelSize: 13
                }

                Row {
                    visible: RouteService.pendingRoute.name !== undefined
                    spacing: Theme.spacingSmall
                    Button {
                        text: qsTr("Rehearse (no write)")
                        onClicked: RouteService.uploadPendingRoute(false)
                    }
                    Button {
                        text: qsTr("Upload to watch")
                        onClicked: RouteService.uploadPendingRoute(true)
                    }
                }

                Text {
                    visible: RouteService.uploadResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 11
                    color: RouteService.uploadOk ? Theme.success : Theme.error
                    text: RouteService.uploadResultText
                }
            }
        }

        // --- On-watch routes ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text {
                    text: qsTr("On the watch")
                    font.bold: true
                    color: Theme.text
                }

                // Real request 2026-08-08 ("add a loading text while it is loading instead
                // of white") - this Card used to just sit empty until RouteService.refresh()
                // finished, which reads the whole navigation database over USB and can take
                // a real, noticeable moment.
                Text {
                    visible: RouteService.loading
                    color: Theme.mutedText
                    text: qsTr("Reading routes off the watch...")
                }

                Text {
                    visible: RouteService.exportError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 11
                    text: qsTr("Export failed: %1").arg(RouteService.exportError)
                }
                Text {
                    visible: root.saveError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 11
                    text: qsTr("Couldn't save: %1").arg(root.saveError)
                }

                Repeater {
                    model: RouteService.loading ? [] : RouteService.onWatchRoutes
                    delegate: Column {
                        width: parent.width
                        spacing: Theme.spacingSmall

                        // Real request 2026-08-08 ("add a map for each gpx") - real points,
                        // not a placeholder: RouteService.onWatchRoutes' own track field now
                        // comes straight from write_nav.py's nav --json (see RouteService's
                        // own comment), the same already-read data the summary below uses,
                        // no extra USB round trip per route.
                        Item {
                            visible: modelData.track && modelData.track.length > 1
                            width: parent.width
                            height: 140
                            MapView {
                                anchors.fill: parent
                                readonly property var center: RouteViewModel.trackCenter(modelData.track)
                                latitude: center ? center.lat : 0
                                longitude: center ? center.lon : 0
                                trackPoints: modelData.track || []
                            }
                        }

                        Row {
                            width: parent.width
                            spacing: Theme.spacingSmall

                            Column {
                                width: parent.width - exportButton.width - Theme.spacingSmall
                                spacing: 2
                                Text {
                                    text: modelData.name
                                    color: Theme.text
                                    font.pixelSize: 13
                                    font.bold: true
                                }
                                Text {
                                    text: qsTr("%1 · %2 points · ascent %3 m · descent %4 m")
                                        .arg(RouteViewModel.formatDistance(modelData.distanceMeters))
                                        .arg(modelData.pointCount)
                                        .arg(modelData.ascentMeters)
                                        .arg(modelData.descentMeters)
                                    color: Theme.mutedText
                                    font.pixelSize: 11
                                }
                            }

                            Button {
                                id: exportButton
                                text: (RouteService.exporting && root.pendingExportIndex === index)
                                    ? qsTr("Exporting...") : qsTr("Export")
                                enabled: !RouteService.exporting
                                onClicked: {
                                    root.pendingExportIndex = index
                                    root.pendingExportName = modelData.name
                                    RouteService.exportRoute(index)
                                }
                            }
                        }
                    }
                }

                Text {
                    // Real bug, found 2026-08-07: this used to say "no routes, or couldn't
                    // read it" either way, so a genuinely empty watch (real, confirmed live -
                    // "routes 0 points 0 waypoints 0") read exactly like an error. Split by
                    // whether lastError actually has anything in it.
                    visible: !RouteService.loading && RouteService.onWatchRoutes.length === 0
                             && RouteService.lastError.length === 0
                    text: qsTr("No routes on the watch.")
                    color: Theme.mutedText
                    font.pixelSize: 12
                }
                Text {
                    visible: !RouteService.loading && RouteService.onWatchRoutes.length === 0
                             && RouteService.lastError.length > 0
                    text: qsTr("Couldn't read routes: %1").arg(RouteService.lastError)
                    color: Theme.error
                    font.pixelSize: 12
                }
            }
        }
    }
}
