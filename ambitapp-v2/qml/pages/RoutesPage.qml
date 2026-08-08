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

    Component.onCompleted: {
        RouteService.refresh()
        GarminService.refreshDeviceGpx()
    }

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
        // Garmin's own on-device routes already carry their real GPX text (no fetch step
        // needed, see the Export button's own onClicked below) - set right before open()
        // and cleared after use so a later Ambit export doesn't accidentally reuse it.
        property string pendingGpxOverride: ""
        onAccepted: {
            const gpx = pendingGpxOverride.length > 0 ? pendingGpxOverride : RouteService.exportedGpx
            root.saveError = LocalFileService.saveText(selectedFile, gpx)
            pendingGpxOverride = ""
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

                // Real, 2026-08-08 ("routes/POI we maintain the same feature... but on the
                // modes that send to the watch, they only should send for sdcard, check
                // android app"): GARMIN_USB_IMPORT_SPEC.md's own explicit, non-negotiable
                // rule - never write to a Garmin's internal memory, no exceptions - and its
                // own explicit instruction that the UI must show a visible warning, not just
                // enforce it silently. GarminService.writeGpxToDevice() also enforces this
                // itself (real, not UI-only), this is the "warn the user" half of the rule.
                Rectangle {
                    visible: HomeViewModel.isGarmin
                    width: parent.width
                    height: warningText.implicitHeight + Theme.spacingSmall * 2
                    radius: Theme.radiusSmall
                    color: Theme.warning
                    opacity: 0.15
                    border.color: Theme.warning
                    border.width: 1
                    Text {
                        id: warningText
                        anchors.fill: parent
                        anchors.margins: Theme.spacingSmall
                        wrapMode: Text.WordWrap
                        color: Theme.warning
                        font.pixelSize: 11
                        text: GarminService.hasSdCard
                            ? qsTr("This will be sent to the SD card only - Garmin devices " +
                                    "never accept writes to internal memory.")
                            : qsTr("No SD card detected in this Garmin device - sending a " +
                                    "route is disabled. Internal memory is never written to.")
                    }
                }

                Row {
                    visible: RouteService.pendingRoute.name !== undefined
                    spacing: Theme.spacingSmall

                    Button {
                        visible: !HomeViewModel.isGarmin
                        text: qsTr("Rehearse (no write)")
                        onClicked: RouteService.uploadPendingRoute(false)
                    }
                    Button {
                        text: HomeViewModel.isGarmin ? qsTr("Send to SD card") : qsTr("Upload to watch")
                        enabled: !HomeViewModel.isGarmin || GarminService.hasSdCard
                        onClicked: {
                            if (HomeViewModel.isGarmin) {
                                const safeName = (RouteService.pendingRoute.name || "route")
                                    .replace(/[\\/:*?"<>|]/g, "_")
                                GarminService.writeGpxToDevice(
                                    safeName + ".gpx", RouteService.pendingRouteGpxText)
                            } else {
                                RouteService.uploadPendingRoute(true)
                            }
                        }
                    }
                }

                Text {
                    visible: !HomeViewModel.isGarmin && RouteService.uploadResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 11
                    color: RouteService.uploadOk ? Theme.success : Theme.error
                    text: RouteService.uploadResultText
                }
                Text {
                    visible: HomeViewModel.isGarmin && GarminService.writeError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 11
                    color: Theme.error
                    text: GarminService.writeError
                }
                Text {
                    visible: HomeViewModel.isGarmin && GarminService.writeOk
                             && GarminService.writeError.length === 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 11
                    color: Theme.success
                    text: qsTr("Sent to the SD card.")
                }
            }
        }

        // --- On the watch/device - real, 2026-08-08: device-aware, same structure either
        // way (RouteService.onWatchRoutes for Ambit, GarminService.onDeviceRoutes for
        // Garmin - both share the same {name, pointCount, distanceMeters, ascentMeters,
        // descentMeters, track} shape on purpose). Garmin's own export needs no async fetch
        // step: its route objects already carry gpxText straight from the local file
        // that's already been read, unlike Ambit's own routes which need a real backend/USB
        // round trip per Export tap (see RouteService.exportRoute()). ---
        Card {
            id: onDeviceCard
            width: parent.width
            readonly property bool loading:
                HomeViewModel.isGarmin ? GarminService.deviceGpxLoading : RouteService.loading
            readonly property var onDeviceRoutes:
                HomeViewModel.isGarmin ? GarminService.onDeviceRoutes : RouteService.onWatchRoutes
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text {
                    text: HomeViewModel.isGarmin ? qsTr("On the device") : qsTr("On the watch")
                    font.bold: true
                    color: Theme.text
                }

                // Real request 2026-08-08 ("add a loading text while it is loading instead
                // of white") - this Card used to just sit empty until RouteService.refresh()
                // finished, which reads the whole navigation database over USB and can take
                // a real, noticeable moment.
                Text {
                    visible: onDeviceCard.loading
                    color: Theme.mutedText
                    text: qsTr("Reading routes off the %1...")
                        .arg(HomeViewModel.isGarmin ? qsTr("device") : qsTr("watch"))
                }

                Text {
                    visible: !HomeViewModel.isGarmin && RouteService.exportError.length > 0
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
                    model: onDeviceCard.loading ? [] : onDeviceCard.onDeviceRoutes
                    delegate: Column {
                        width: parent.width
                        spacing: Theme.spacingSmall

                        // Real request 2026-08-08 ("add a map for each gpx") - real points,
                        // not a placeholder: RouteService.onWatchRoutes' own track field now
                        // comes straight from write_nav.py's nav --json (see RouteService's
                        // own comment), the same already-read data the summary below uses,
                        // no extra USB round trip per route. Garmin's own track field comes
                        // straight from the local GPX file already read.
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
                                    if (HomeViewModel.isGarmin) {
                                        // Already have the real bytes - no fetch step needed.
                                        const safeName = (modelData.name || "route")
                                            .replace(/[\\/:*?"<>|]/g, "_")
                                        exportDialog.currentFile =
                                            LocalFileService.downloadsLocation + "/" + safeName + ".gpx"
                                        root.saveError = ""
                                        exportDialog.pendingGpxOverride = modelData.gpxText
                                        exportDialog.open()
                                    } else {
                                        root.pendingExportIndex = index
                                        root.pendingExportName = modelData.name
                                        RouteService.exportRoute(index)
                                    }
                                }
                            }
                        }
                    }
                }

                Text {
                    // Real bug, found 2026-08-07: this used to say "no routes, or couldn't
                    // read it" either way, so a genuinely empty watch (real, confirmed live -
                    // "routes 0 points 0 waypoints 0") read exactly like an error. Split by
                    // whether lastError actually has anything in it. Garmin has no separate
                    // error concept here - a local file read just finds nothing or it doesn't.
                    visible: !onDeviceCard.loading && onDeviceCard.onDeviceRoutes.length === 0
                             && (HomeViewModel.isGarmin || RouteService.lastError.length === 0)
                    text: HomeViewModel.isGarmin
                        ? qsTr("No routes on this Garmin device.")
                        : qsTr("No routes on the watch.")
                    color: Theme.mutedText
                    font.pixelSize: 12
                }
                Text {
                    visible: !HomeViewModel.isGarmin && !onDeviceCard.loading
                             && RouteService.onWatchRoutes.length === 0
                             && RouteService.lastError.length > 0
                    text: qsTr("Couldn't read routes: %1").arg(RouteService.lastError)
                    color: Theme.error
                    font.pixelSize: 12
                }
            }
        }
    }
}
