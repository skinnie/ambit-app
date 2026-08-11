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
    height: 64
    radius: Theme.radiusCard
    color: "transparent"

    // Real bug, 2026-08-11 (André): "in activities there is the same flashing with grey when
    // i move on the activities. please solve it as you did before."
    //
    // Same cause as the sport-mode display rows: animating `color` between "transparent" and
    // Theme.card interpolates through rgba(0,0,0,0) -> opaque, so every frame in between is
    // a translucent BLACK, which on a light background reads as a grey flash. Nothing is
    // wrong with the endpoints; it is the path between them.
    //
    // The fix, same as before: the colour never animates. A sibling background sits at the
    // final colour the whole time and its OPACITY animates instead, which fades card-colour
    // over the page rather than through black.
    Rectangle {
        anchors.fill: parent
        radius: parent.radius
        color: Theme.card
        opacity: hover.hovered ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
    }

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

        // Each figure says what it is on hover - real request, 2026-08-11 (André): "when
        // you pass the mouse over a data, say what is that data field". A row of bare
        // numbers is only readable if you already know the column order; this makes it
        // readable without that. The number and the unit still come from the watch's own
        // unit setting (see WatchUnits.qml), so the hint matches what is shown.
        Repeater {
            model: [
                {
                    text: root.activity
                          ? ActivityViewModel.formatDistance(root.activity.distanceMeters) : "",
                    hint: qsTr("This was your distance"),
                    muted: false, w: 96
                },
                {
                    text: root.activity
                          ? ActivityViewModel.formatDuration(root.activity.durationSeconds) : "",
                    hint: qsTr("This was the duration"),
                    muted: false, w: 96
                },
                {
                    text: root.activity
                          ? ActivityViewModel.formatElevation(root.activity.ascentMeters) : "",
                    hint: qsTr("This is your ascent"),
                    muted: true, w: 88
                },
                {
                    // Blank for a move with no recorded energy rather than a false "0 kcal"
                    // - an activity cached before this field was carried through has none.
                    text: root.activity
                          ? ActivityViewModel.formatEnergy(root.activity.energyKcal) : "",
                    hint: qsTr("This is the energy you spent"),
                    muted: true, w: 96
                },
            ]
            delegate: Item {
                required property var modelData
                anchors.verticalCenter: parent.verticalCenter
                width: modelData.w
                height: figure.implicitHeight

                Text {
                    id: figure
                    anchors.right: parent.right
                    text: modelData.text
                    color: modelData.muted ? Theme.mutedText : Theme.text
                    font.pixelSize: Theme.fontSizeBody
                }
                HoverHandler { id: figureHover }
                ToolTip.visible: figureHover.hovered && modelData.text.length > 0
                ToolTip.text: modelData.hint
                ToolTip.delay: 300
            }
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
