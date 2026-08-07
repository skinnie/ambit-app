import QtQuick
import AmbitApp

// AMBITAPP_SPEC.md, "Activities": "Think Apple Photos. Large cards. Small map preview.
// Sport icon. Distance. Duration. Elevation." One card per recorded move.
Card {
    id: root
    width: 360
    padding: 0

    property var activity  // one entry from ActivityService.activities
    signal opened

    readonly property var _center: ActivityViewModel.trackCenter(activity.track)

    TapHandler { onTapped: root.opened() }

    Column {
        width: parent.width

        Item {
            width: parent.width
            height: 160

            MapView {
                anchors.fill: parent
                visible: root._center !== null
                latitude: root._center ? root._center.lat : 0
                longitude: root._center ? root._center.lon : 0
                zoomLevel: 12
                trackPoints: activity.track || []
            }
            // Previews are for identification, not interaction - the card itself opens the
            // real, large, interactive map (the spec's own "Selecting an activity opens:
            // Large MapLibre map"), so panning/zooming a thumbnail would just fight the
            // TapHandler above for no benefit.
            MouseArea { anchors.fill: parent; onClicked: root.opened() }

            Rectangle {
                visible: root._center === null
                anchors.fill: parent
                color: Theme.background
                Text {
                    anchors.centerIn: parent
                    text: qsTr("No GPS track")
                    color: Theme.mutedText
                    font.pixelSize: 12
                }
            }
        }

        Row {
            width: parent.width
            padding: Theme.spacingMedium
            spacing: Theme.spacingSmall

            Icon { glyph: Icons.activities; size: 20; color: Theme.primary }

            Column {
                spacing: 2
                Text {
                    text: activity.name || qsTr("Untitled activity")
                    font.bold: true
                    color: Theme.text
                    font.pixelSize: 14
                }
                Text {
                    text: ActivityViewModel.formatDate(activity.startTime)
                    color: Theme.mutedText
                    font.pixelSize: 11
                }
            }
        }

        Row {
            width: parent.width
            leftPadding: Theme.spacingMedium
            rightPadding: Theme.spacingMedium
            bottomPadding: Theme.spacingMedium
            spacing: Theme.spacingLarge

            Text {
                text: ActivityViewModel.formatDistance(activity.distanceMeters)
                color: Theme.text
                font.pixelSize: 12
            }
            Text {
                text: ActivityViewModel.formatDuration(activity.durationSeconds)
                color: Theme.text
                font.pixelSize: 12
            }
            Text {
                text: ActivityViewModel.formatElevation(activity.ascentMeters)
                color: Theme.text
                font.pixelSize: 12
            }
        }
    }
}
