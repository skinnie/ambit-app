import QtQuick
import QtQuick.Controls
import AmbitApp

// Place a POI by pointing at it - real request, 2026-08-11 (André, item 18): "can we make it
// clickable, open a new window: 1st box 'search on a map', like we do for google maps, and
// once we select it inputs coordinates (like we did for kailash home), 2nd option write
// name."
//
// The map is the same MapView the rest of the app uses, so it pans and zooms exactly like the
// big route map, and clicking it converts the point back to lon/lat through MapView's own
// inverse projection - the same maths the tiles are drawn with, rather than a second
// approximation that would drift from what is on screen.
//
// The typed coordinates and the map are two views of one value: click the map and the numbers
// update, type a number and the marker moves. That is deliberate - it is how a user checks
// that a coordinate they were given is where they think it is.
ThemedDialog {
    id: root

    property real latitude: 0
    property real longitude: 0
    property string poiName: ""

    signal accepted_(string name, real lat, real lon)

    title: qsTr("Add a POI")
    standardButtons: Dialog.Cancel | Dialog.Ok
    width: Math.min(720, parent ? parent.width - Theme.spacingLarge * 2 : 720)
    height: Math.min(620, parent ? parent.height - Theme.spacingLarge * 2 : 620)

    onOpened: {
        nameField.text = poiName
        map.resetView()
    }
    onAccepted: accepted_(nameField.text, latitude, longitude)

    contentItem: Column {
        spacing: Theme.spacingSmall

        // Same wording and position as HomeLocationDialog - André, 2026-08-11: "just
        // replicate what we did for home in kailash".
        Text {
            width: parent.width
            wrapMode: Text.WordWrap
            text: qsTr("Drag the map to put the POI under the crosshair, or click a point. " +
                        "Scroll to zoom.")
            color: Theme.mutedText
            font.pixelSize: Theme.fontSizeBody
        }

        RoundedTextField {
            id: nameField
            width: parent.width
            // A placeholder clears itself as soon as there is text - that is what
            // placeholderText does, as opposed to pre-filling the field with a word the user
            // then has to delete. André asked for the latter behaviour; this is it.
            placeholderText: qsTr("Name this POI")
        }

        // Search by name, then fine-tune by hand on the map - André, 2026-08-11.
        PlaceSearchBar {
            width: parent.width
            onPlaceChosen: (lat, lon) => {
                root.latitude = lat
                root.longitude = lon
                map.resetView()
            }
        }

        Row {
            width: parent.width
            spacing: Theme.spacingSmall
            RoundedTextField {
                id: latField
                width: (parent.width - Theme.spacingSmall) / 2
                placeholderText: qsTr("Latitude")
                text: root.latitude.toFixed(6)
                onEditingFinished: {
                    const v = parseFloat(text)
                    if (!isNaN(v) && v >= -90 && v <= 90)
                        root.latitude = v
                    else
                        text = root.latitude.toFixed(6)
                }
            }
            RoundedTextField {
                id: lonField
                width: (parent.width - Theme.spacingSmall) / 2
                placeholderText: qsTr("Longitude")
                text: root.longitude.toFixed(6)
                onEditingFinished: {
                    const v = parseFloat(text)
                    if (!isNaN(v) && v >= -180 && v <= 180)
                        root.longitude = v
                    else
                        text = root.longitude.toFixed(6)
                }
            }
        }

        Item {
            width: parent.width
            height: root.height - 310

            MapView {
                id: map
                scrollZoom: true
                anchors.fill: parent
                clip: true
                latitude: root.latitude
                longitude: root.longitude
                zoomLevel: 15
                showMarker: true

                TapHandler {
                    onTapped: (event) => {
                        // The click point, through the same projection the tiles use.
                        root.latitude = map.latAtY(event.position.y)
                        root.longitude = map.lonAtX(event.position.x)
                        // Clicking re-centres on the new point, so panning does not have to
                        // be undone before the marker is visible.
                        map.resetView()
                    }
                }
                DragHandler {
                    id: panner
                    target: null
                    property real lastX: 0
                    property real lastY: 0
                    onActiveChanged: {
                        if (active) {
                            lastX = centroid.position.x
                            lastY = centroid.position.y
                        } else {
                            // Drag-to-pick, same as HomeLocationDialog: on release, the
                            // point under the centre crosshair IS the choice.
                            root.latitude = map.latAtY(map.height / 2)
                            root.longitude = map.lonAtX(map.width / 2)
                            map.resetView()
                        }
                        map.userControlled = true
                    }
                    onCentroidChanged: {
                        if (!active)
                            return
                        map.panX -= centroid.position.x - lastX
                        map.panY -= centroid.position.y - lastY
                        lastX = centroid.position.x
                        lastY = centroid.position.y
                    }
                }
                HoverHandler {
                    cursorShape: panner.active ? Qt.ClosedHandCursor : Qt.CrossCursor
                }

                // The crosshair the drag aims at, same as HomeLocationDialog's. Drawn over
                // the map, ignoring input so it never eats a click meant for the map.
                Item {
                    anchors.centerIn: parent
                    width: 26
                    height: 26
                    Rectangle {
                        anchors.centerIn: parent
                        width: 2; height: parent.height
                        color: Theme.mapAccent
                    }
                    Rectangle {
                        anchors.centerIn: parent
                        width: parent.width; height: 2
                        color: Theme.mapAccent
                    }
                    Rectangle {
                        anchors.centerIn: parent
                        width: 12; height: 12; radius: 6
                        color: "transparent"
                        border.width: 2
                        border.color: Theme.mapAccent
                    }
                }
            }
        }
    }
}
