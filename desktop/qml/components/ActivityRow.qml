import QtQuick
import QtQuick.Controls
import AmbitApp

// One activity as a LIST row - real request, 2026-08-11 (André, item 16): "For activities, in
// settings let's add the option: see as a map, see as a list. the first is the one we already
// have."
//
// Deliberately draws no map. That is the point of the list view beyond looking different:
// ActivityCard embeds a live MapView per card, and this project already learned on real
// hardware that too many simultaneous map instances crashed the app (see ActivitiesPage's own
// comment on why the grid virtualises). A list of rows costs nothing per entry, so a watch
// with a long history scrolls smoothly - which is the case where the card grid is heaviest.
Rectangle {
    id: root

    property var activity

    signal opened()

    width: parent ? parent.width : 0
    height: 56
    radius: Theme.radiusCard
    color: hover.hovered ? Theme.card : "transparent"
    Behavior on color { ColorAnimation { duration: 120; easing.type: Easing.OutCubic } }

    HoverHandler { id: hover }
    TapHandler { onTapped: root.opened() }

    Row {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.leftMargin: Theme.spacingMedium
        anchors.rightMargin: Theme.spacingMedium
        spacing: Theme.spacingMedium

        // Keyed on the activity's NAME: an activity read off the watch comes from its GPX,
        // which carries the sport mode's name but no numeric id. Anything unrecognised falls
        // back to the generic badge rather than guessing a sport.
        ActivityBadge {
            anchors.verticalCenter: parent.verticalCenter
            activityId: root.activity
                        ? ActivityTypes.forName(root.activity.name).id : 1
            size: 32
        }

        Column {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width * 0.42
            spacing: 1
            Text {
                width: parent.width
                elide: Text.ElideRight
                text: root.activity ? (root.activity.name || qsTr("Untitled activity")) : ""
                color: Theme.text
                font.pixelSize: Theme.fontSizeBody
                font.bold: true
            }
            Text {
                text: root.activity
                      ? ActivityViewModel.formatDate(root.activity.startTime) : ""
                color: Theme.mutedText
                font.pixelSize: Theme.fontSizeCaption
            }
        }

        Text {
            anchors.verticalCenter: parent.verticalCenter
            width: 90
            horizontalAlignment: Text.AlignRight
            text: root.activity
                  ? ActivityViewModel.formatDistance(root.activity.distanceMeters) : ""
            color: Theme.text
            font.pixelSize: Theme.fontSizeBody
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            width: 90
            horizontalAlignment: Text.AlignRight
            text: root.activity
                  ? ActivityViewModel.formatDuration(root.activity.durationSeconds) : ""
            color: Theme.text
            font.pixelSize: Theme.fontSizeBody
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            width: 80
            horizontalAlignment: Text.AlignRight
            text: root.activity
                  ? ActivityViewModel.formatElevation(root.activity.ascentMeters) : ""
            color: Theme.mutedText
            font.pixelSize: Theme.fontSizeBody
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 1
        color: Theme.mutedText
        opacity: 0.15
    }
}
