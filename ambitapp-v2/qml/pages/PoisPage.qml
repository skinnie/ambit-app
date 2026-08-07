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

    Component.onCompleted: PoiService.refresh()

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

                TextField {
                    width: parent.width
                    placeholderText: qsTr("Name")
                    onTextChanged: root.poiName = text
                }
                Row {
                    width: parent.width
                    spacing: Theme.spacingSmall
                    TextField {
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Latitude")
                        text: root.poiLat.toString()
                        onTextChanged: { const v = parseFloat(text); if (!isNaN(v)) root.poiLat = v; }
                    }
                    TextField {
                        width: (parent.width - Theme.spacingSmall) / 2
                        placeholderText: qsTr("Longitude")
                        text: root.poiLon.toString()
                        onTextChanged: { const v = parseFloat(text); if (!isNaN(v)) root.poiLon = v; }
                    }
                }

                // Small preview map, per the spec - real, live, updates as you type.
                Item {
                    width: parent.width
                    height: 160
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

                Button {
                    text: qsTr("Add")
                    onClicked: PoiService.addPoi(root.poiName, root.poiLat, root.poiLon)
                }

                Text {
                    visible: PoiService.addResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: 11
                    color: Theme.error
                    text: PoiService.addResultText
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

                Button {
                    text: qsTr("Import GPX…")
                    onClicked: poiFileDialog.open()
                }

                Text {
                    visible: PoiService.importError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 11
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
                            font.pixelSize: 12
                            text: qsTr("%1  (%2, %3)")
                                .arg(modelData.name)
                                .arg(modelData.lat.toFixed(5))
                                .arg(modelData.lon.toFixed(5))
                        }
                        Button {
                            id: addImportedButton
                            text: qsTr("Add")
                            onClicked: PoiService.addPoi(modelData.name, modelData.lat, modelData.lon)
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
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall
                Text { text: qsTr("On the watch"); font.bold: true; color: Theme.text }

                Text {
                    visible: PoiService.loading
                    color: Theme.mutedText
                    text: qsTr("Reading POIs off the watch...")
                }
                Text {
                    visible: !PoiService.loading && !PoiService.ok
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: 12
                    text: qsTr("Couldn't read POIs: %1").arg(PoiService.lastError)
                }
                Text {
                    visible: !PoiService.loading && PoiService.ok && PoiService.onWatchPois.length === 0
                    color: Theme.mutedText
                    text: qsTr("No POIs on the watch.")
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
                    model: PoiService.loading ? [] : PoiService.onWatchPois
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
                                font.pixelSize: 13
                                font.bold: true
                            }

                            Button {
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
}
