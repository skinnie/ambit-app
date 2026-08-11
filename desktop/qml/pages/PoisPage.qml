import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import AmbitApp

// Step 9. On-watch POIs shown as a real per-POI list with a thumbnail map and Export, since
// 2026-08-08 (see the "On the watch" Card below for the fuller story). "Add" has a real,
// live coordinate preview map even though actually submitting is honestly blocked right now
// (POI write isn't in this repo's tools/write_nav.py yet, confirmed separately as working
// elsewhere - see HANDOFF.md's POI section) - the form itself, and the map preview, are
// still real.
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true
    property string saveError: ""

    Component.onCompleted: {
        PoiService.refresh()
        GarminService.refreshDeviceGpx()
    }

    FileDialog {
        id: poiFileDialog
        title: qsTr("Import POIs from GPX")
        nameFilters: [qsTr("GPX files (*.gpx)")]
        onAccepted: PoiService.importGpxFile(selectedFile)
    }

    // Real request 2026-08-08: "1 POI => name => export (choose location, default
    // downloads folder)" - same save-dialog pattern as Routes/Activities export, via
    // LocalFileService. pendingGpx is set right before open() since PoiService.
    // buildWaypointGpx() is synchronous (no backend round trip needed for a single point).
    FileDialog {
        id: poiExportDialog
        title: qsTr("Export POI as GPX")
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("GPX files (*.gpx)")]
        currentFolder: LocalFileService.downloadsLocation
        property string pendingGpx: ""
        onAccepted: root.saveError = LocalFileService.saveText(selectedFile, pendingGpx)
    }

    property string poiName: ""
    // Real request 2026-08-07: this used to default to an arbitrary Alps coordinate (46.8,
    // 8.2), so the preview map below showed some unrelated place until the user typed real
    // numbers. WeatherService.latitude/longitude are IP-detected by default now (see
    // HomePage.qml's own startup call), so binding to them directly gives a real, locally
    // relevant starting point instead - and it's a genuine binding, not just an initial
    // value, so it keeps tracking if the IP lookup resolves after this page has already
    // loaded. Typing into either field below assigns to these directly, which breaks the
    // binding for that one exactly as expected - the usual QML behavior, not special-cased.
    property real poiLat: WeatherService.latitude
    property real poiLon: WeatherService.longitude

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        spacing: Theme.spacingMedium

        // --- Add ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Add a POI"); font.bold: true; color: Theme.text }

                RoundedTextField {
                    width: parent.width
                    placeholderText: qsTr("Name")
                    onTextChanged: root.poiName = text
                }
                Row {
                    width: parent.width
                    spacing: Theme.spacingSmall
                    RoundedTextField {
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Latitude")
                        text: root.poiLat.toString()
                        onTextChanged: { const v = parseFloat(text); if (!isNaN(v)) root.poiLat = v; }
                    }
                    RoundedTextField {
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Longitude")
                        text: root.poiLon.toString()
                        onTextChanged: { const v = parseFloat(text); if (!isNaN(v)) root.poiLon = v; }
                    }
                }

                // The preview opens the real picker - André, 2026-08-11 (item 18): "for the
                // box under add a POI, can we make it clickable, open a new window". Placing
                // a point by pointing at it is the natural gesture; typing two decimal
                // numbers is the fallback, not the main path.
                Text {
                    text: qsTr("Click the map to place a POI")
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                }
                Item {
                    width: parent.width
                    height: 160
                    TapHandler {
                        onTapped: {
                            poiPicker.latitude = root.poiLat
                            poiPicker.longitude = root.poiLon
                            poiPicker.poiName = root.poiName
                            poiPicker.open()
                        }
                    }
                    MapView {
                        anchors.fill: parent
                        latitude: root.poiLat
                        longitude: root.poiLon
                        // Real request 2026-08-08: "zoom in a bit to be more visible" -
                        // was 10 (city level, fine for orientation but too wide to actually
                        // place a POI precisely); 15 is street level.
                        zoomLevel: 15
                        showMarker: true
                    }
                }

                // Real, 2026-08-08 ("routes/POI we maintain the same feature... but on the
                // modes that send to the watch, they only should send for sdcard, check
                // android app") - same rule and same warning as Routes' own Send button,
                // see RoutesPage.qml's own comment on this for the full reasoning.
                // Real request 2026-08-08 (real hardware confirmed working): no frame at
                // all - plain text matching this page's own muted description text, not a
                // boxed warning.
                Text {
                    visible: HomeViewModel.isGarmin
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
                    text: GarminService.hasSdCard
                        ? qsTr("This will be sent to the SD card only - writing to " +
                                "internal memory can break your device.")
                        : qsTr("No SD card detected in this Garmin device - sending a " +
                                "POI is disabled. Writing to internal memory can " +
                                "break your device.")
                }

                RoundedButton {
                    text: HomeViewModel.isGarmin ? qsTr("Send to SD card") : qsTr("Add")
                    enabled: !HomeViewModel.isGarmin || GarminService.hasSdCard
                    onClicked: {
                        if (HomeViewModel.isGarmin) {
                            const safeName = (root.poiName || "poi").replace(/[\\/:*?"<>|]/g, "_")
                            GarminService.writeGpxToDevice(
                                "Waypoints_" + safeName + ".gpx",
                                PoiService.buildWaypointGpx(root.poiName, root.poiLat, root.poiLon))
                        } else {
                            PoiService.addPoi(root.poiName, root.poiLat, root.poiLon)
                        }
                    }
                }

                Text {
                    visible: !HomeViewModel.isGarmin && PoiService.addResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: Theme.error
                    text: PoiService.addResultText
                }
                Text {
                    visible: HomeViewModel.isGarmin && GarminService.writeError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: Theme.error
                    text: GarminService.writeError
                }
                Text {
                    visible: HomeViewModel.isGarmin && GarminService.writeOk
                             && GarminService.writeError.length === 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: Theme.success
                    text: qsTr("Sent to the SD card.")
                }
            }
        }

        // --- Import from GPX - real, confirmed-working on the Android app
        // (opensportsync-main's "POI import (GPX file and manual coordinates)"), missing
        // here until 2026-08-07. Parses real <wpt> waypoints; submitting each one still
        // goes through the same honest addPoi() 501 as manual entry above, since the actual
        // watch-write isn't in this repo's tools yet either way. ---
        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Text { text: qsTr("Import from GPX"); font.bold: true; color: Theme.text }

                RoundedButton {
                    text: qsTr("Import GPX…")
                    onClicked: poiFileDialog.open()
                }

                Text {
                    visible: PoiService.importError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeCaption
                    text: PoiService.importError
                }

                Repeater {
                    model: PoiService.importedPois
                    delegate: Row {
                        width: parent.width
                        spacing: Theme.spacingSmall
                        Text {
                            width: parent.width - addImportedButton.width - Theme.spacingSmall
                            anchors.verticalCenter: parent.verticalCenter
                            elide: Text.ElideRight
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeLabel
                            text: qsTr("%1  (%2, %3)")
                                .arg(modelData.name)
                                .arg(modelData.lat.toFixed(5))
                                .arg(modelData.lon.toFixed(5))
                        }
                        RoundedButton {
                            id: addImportedButton
                            text: HomeViewModel.isGarmin ? qsTr("Send to SD card") : qsTr("Add")
                            enabled: !HomeViewModel.isGarmin || GarminService.hasSdCard
                            onClicked: {
                                if (HomeViewModel.isGarmin) {
                                    const safeName = (modelData.name || "poi").replace(/[\\/:*?"<>|]/g, "_")
                                    GarminService.writeGpxToDevice(
                                        "Waypoints_" + safeName + ".gpx",
                                        PoiService.buildWaypointGpx(modelData.name, modelData.lat, modelData.lon))
                                } else {
                                    PoiService.addPoi(modelData.name, modelData.lat, modelData.lon)
                                }
                            }
                        }
                    }
                }
            }
        }

        // --- On-watch POIs - real, 2026-08-08 ("do like for the routes: name => export,
        // thumbnail on map for each"). Real field names (Name=/Location.Latitude=/
        // Location.Longitude=) confirmed directly against live hardware output - the
        // schema-uncertainty caveat this section used to carry no longer applies (see
        // PoiService::parseOnWatchPois's own comment). A thumbnail per POI costs nothing
        // extra over what refresh() already fetched - lat/lon come straight from the same
        // parsed record, no per-POI network/USB round trip. ---
        Card {
            id: onDevicePoiCard
            width: parent.width
            readonly property bool loading:
                HomeViewModel.isGarmin ? GarminService.deviceGpxLoading : PoiService.loading
            readonly property var onDevicePois:
                HomeViewModel.isGarmin ? GarminService.onDevicePois : PoiService.onWatchPois
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Text {
                    text: HomeViewModel.isGarmin ? qsTr("On the device") : qsTr("On the watch")
                    font.bold: true
                    color: Theme.text
                }

                Text {
                    visible: onDevicePoiCard.loading
                    color: Theme.mutedText
                    text: qsTr("Reading POIs off the %1...")
                        .arg(HomeViewModel.isGarmin ? qsTr("device") : qsTr("watch"))
                }
                ErrorBanner {
                    width: parent.width
                    detail: (!HomeViewModel.isGarmin && !PoiService.loading && !PoiService.ok)
                            ? PoiService.lastError : ""
                    context: qsTr("reading POIs from the watch")
                }
                Text {
                    visible: !onDevicePoiCard.loading && onDevicePoiCard.onDevicePois.length === 0
                             && (HomeViewModel.isGarmin || PoiService.ok)
                    color: Theme.mutedText
                    text: HomeViewModel.isGarmin
                        ? qsTr("No POIs on this Garmin device.")
                        : qsTr("No POIs on the watch.")
                }
                Text {
                    visible: root.saveError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeCaption
                    text: qsTr("Couldn't save: %1").arg(root.saveError)
                }

                Repeater {
                    model: onDevicePoiCard.loading ? [] : onDevicePoiCard.onDevicePois
                    delegate: Column {
                        width: parent.width
                        spacing: Theme.spacingSmall

                        Item {
                            width: parent.width
                            height: 120
                            MapView {
                                anchors.fill: parent
                                latitude: modelData.lat
                                longitude: modelData.lon
                                zoomLevel: 14
                                showMarker: true
                            }
                        }

                        Row {
                            width: parent.width
                            spacing: Theme.spacingSmall

                            Text {
                                width: parent.width - poiExportButton.width - Theme.spacingSmall
                                anchors.verticalCenter: parent.verticalCenter
                                elide: Text.ElideRight
                                text: modelData.name
                                color: Theme.text
                                font.pixelSize: Theme.fontSizeBody
                                font.bold: true
                            }

                            RoundedButton {
                                id: poiExportButton
                                text: qsTr("Export")
                                onClicked: {
                                    const safeName = (modelData.name || "poi")
                                        .replace(/[\\/:*?"<>|]/g, "_")
                                    poiExportDialog.pendingGpx = PoiService.buildWaypointGpx(
                                        modelData.name, modelData.lat, modelData.lon)
                                    poiExportDialog.currentFile =
                                        LocalFileService.downloadsLocation + "/" + safeName + ".gpx"
                                    poiExportDialog.open()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    PoiPickerDialog {
        id: poiPicker
        anchors.centerIn: Overlay.overlay
        onAccepted_: (name, lat, lon) => {
            root.poiName = name
            root.poiLat = lat
            root.poiLon = lon
        }
    }
}
