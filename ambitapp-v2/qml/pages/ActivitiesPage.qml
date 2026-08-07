import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 7: real Apple-Photos-style activity cards, backed by ActivityService (parses the
// backend's raw GPX into distance/duration/elevation/track). Selecting a card opens
// ActivityDetail in place - a simple internal state swap, no separate nav entry needed.
Item {
    id: root
    property var selectedActivity: null

    Component.onCompleted: ActivityService.refresh()

    // Real, not a guess: the watch's ExerciseLog region is ~5.3MB, read 1024 bytes at a
    // time over USB - genuinely takes a couple of minutes. Without this, the page was a
    // blank white screen the whole time (found 2026-08-07 via real testing) - looked broken,
    // wasn't.
    Text {
        visible: root.selectedActivity === null && ActivityService.loading
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        color: Theme.mutedText
        text: qsTr("Reading activities off the watch - this can take a couple of minutes " +
                    "(the log is read in full over USB, there's no faster path yet)...")
    }

    // Real request 2026-08-07: "activities... saved in the computer... loads when watch is
    // not plugged" - ActivityService now caches every successful read locally and falls
    // back to that cache when a live read fails, flagged here rather than silently shown as
    // if it were current.
    Text {
        visible: root.selectedActivity === null && !ActivityService.loading
                 && ActivityService.showingCachedData
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        color: Theme.mutedText
        font.italic: true
        text: qsTr("Showing cached activities from the last time the watch was connected.")
    }

    Column {
        visible: root.selectedActivity === null
                 && !ActivityService.loading && ActivityService.activities.length === 0
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        spacing: Theme.spacingSmall
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            color: Theme.mutedText
            text: ActivityService.ok
                ? qsTr("No recorded activities on the watch.")
                : qsTr("Couldn't load activities: %1").arg(ActivityService.lastError)
        }
        // Real fix, not cosmetic: the only way to retry used to be navigating away and
        // back (which happens to re-run Component.onCompleted since Main.qml's Loader
        // recreates the page) - not discoverable, and a real problem if this page's very
        // first load raced the watch still connecting (found 2026-08-07 via real testing).
        Button {
            visible: !ActivityService.ok
            anchors.horizontalCenter: parent.horizontalCenter
            text: qsTr("Retry")
            onClicked: ActivityService.refresh()
        }
    }

    // GridView, not a plain Repeater-in-Flow: each ActivityCard embeds a live MapView (its
    // own GeoServices plugin instance, own tile cache/GL context), and a Repeater
    // instantiates every delegate at once regardless of what's actually visible. On real
    // hardware (confirmed 2026-08-07, see V3_CHANGELOG.md) that was enough simultaneous map
    // instances to crash the app outright with the original MapLibre backend, and it would
    // only get worse as more activities accumulate on the watch over time, not stay a fixed
    // cost - kept even after switching to Qt's own lighter "osm" plugin, since the
    // scaling problem is real regardless of which plugin renders each map. GridView
    // with reuseItems does real delegate virtualization: only what's near the viewport is
    // instantiated, recycled as it scrolls, bounding the live-map count to a small constant
    // regardless of list length.
    GridView {
        anchors.fill: parent
        anchors.margins: Theme.spacingLarge
        visible: root.selectedActivity === null
        clip: true
        cellWidth: 360 + Theme.spacingMedium
        cellHeight: 280 + Theme.spacingMedium
        reuseItems: true
        model: ActivityService.activities
        delegate: Item {
            width: GridView.view.cellWidth
            height: GridView.view.cellHeight
            ActivityCard {
                anchors.left: parent.left
                anchors.top: parent.top
                activity: modelData
                onOpened: root.selectedActivity = modelData
            }
        }
    }

    ActivityDetail {
        anchors.fill: parent
        visible: root.selectedActivity !== null
        activity: root.selectedActivity
        onBack: root.selectedActivity = null
    }
}
