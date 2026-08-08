import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 7: real Apple-Photos-style activity cards, backed by ActivityService (parses the
// backend's raw GPX into distance/duration/elevation/track). Selecting a card opens
// ActivityDetail in place - a simple internal state swap, no separate nav entry needed.
Item {
    id: root
    property var selectedActivity: null

    // Real, 2026-08-08 ("activities, just import the ones on the garmin device") - this
    // page is device-aware rather than duplicated: same grid/detail UI either way, sourced
    // from ActivityService (Ambit3, real watch log) or GarminService (Garmin, real GPX
    // files already sitting on the device) depending on which one HomeViewModel says is
    // actually connected. Matches the real Android app's own "no sub menu needed, just read
    // and log" simplicity for Garmin.
    readonly property bool loading:
        HomeViewModel.isGarmin ? GarminService.activitiesLoading : ActivityService.loading
    readonly property var activeActivities:
        HomeViewModel.isGarmin ? GarminService.activities : ActivityService.activities

    Component.onCompleted: {
        ActivityService.refresh()
        GarminService.refreshActivities()
    }

    // Real, not a guess: the watch's ExerciseLog region is ~5.3MB, read 1024 bytes at a
    // time over USB - genuinely takes a couple of minutes. Without this, the page was a
    // blank white screen the whole time (found 2026-08-07 via real testing) - looked broken,
    // wasn't. Garmin's own read is a plain local file read - fast - so this message only
    // applies to the Ambit3 path.
    Text {
        visible: root.selectedActivity === null && root.loading && !HomeViewModel.isGarmin
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        color: Theme.mutedText
        text: qsTr("Reading activities off the watch - this can take a couple of minutes " +
                    "(the log is read in full over USB, there's no faster path yet)...")
    }

    // Real request 2026-08-07: "activities... saved in the computer... loads when watch is
    // not plugged" - ActivityService now caches every successful read locally and falls
    // back to that cache when a live read fails, flagged here rather than silently shown as
    // if it were current. Garmin has no separate cache concept - its own files already live
    // on the device's own storage, read fresh every time.
    Text {
        visible: root.selectedActivity === null && !root.loading && !HomeViewModel.isGarmin
                 && ActivityService.showingCachedData
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        color: Theme.mutedText
        font.italic: true
        text: qsTr("Showing cached activities from the last time the watch was connected.")
    }

    Column {
        visible: root.selectedActivity === null
                 && !root.loading && root.activeActivities.length === 0
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        spacing: Theme.spacingSmall
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            color: Theme.mutedText
            text: HomeViewModel.isGarmin
                ? qsTr("No recorded activities on this Garmin device.")
                : (ActivityService.ok
                    ? qsTr("No recorded activities on the watch.")
                    : qsTr("Couldn't load activities: %1").arg(ActivityService.lastError))
        }
        // Real fix, not cosmetic: the only way to retry used to be navigating away and
        // back (which happens to re-run Component.onCompleted since Main.qml's Loader
        // recreates the page) - not discoverable, and a real problem if this page's very
        // first load raced the watch still connecting (found 2026-08-07 via real testing).
        Button {
            visible: HomeViewModel.isGarmin ? false : !ActivityService.ok
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
        model: root.activeActivities
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
