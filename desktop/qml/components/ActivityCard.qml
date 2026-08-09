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

    // Real, 2026-08-09 ("general desktop polish pass") - a real, unmet AMBITAPP_SPEC.md
    // requirement ("Subtle animations"): this card had zero feedback that it was even
    // clickable beyond the cursor shape. A small press-scale is a common, well-understood
    // tactile cue, low-risk to add since it's a pure transform, not a layout change.
    scale: cardTap.pressed ? 0.98 : 1.0
    Behavior on scale { NumberAnimation { duration: 100; easing.type: Easing.OutCubic } }

    TapHandler { id: cardTap; onTapped: root.opened() }

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
                    font.pixelSize: Theme.fontSizeLabel
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
                    font.pixelSize: Theme.fontSizeBodyLarge
                }
                Text {
                    text: ActivityViewModel.formatDate(activity.startTime)
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeCaption
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
                font.pixelSize: Theme.fontSizeLabel
            }
            Text {
                text: ActivityViewModel.formatDuration(activity.durationSeconds)
                color: Theme.text
                font.pixelSize: Theme.fontSizeLabel
            }
            Text {
                text: ActivityViewModel.formatElevation(activity.ascentMeters)
                color: Theme.text
                font.pixelSize: Theme.fontSizeLabel
            }
        }
    }
}
