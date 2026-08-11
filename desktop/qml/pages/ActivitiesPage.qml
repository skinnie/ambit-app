import QtQuick
import QtQuick.Controls
import QtQuick.Effects
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
    //
    // Real, 2026-08-09 ("Activity logs from kailash => treat them as walks => import to
    // the activities") - Kailash has no ExerciseLog PMEM region at all (KailashService's
    // own header comment), so ActivityService has nothing to read for it. Its real
    // per-session data lives in KailashService.sessions instead (the DeviceHistory
    // "activity mode" logbook - when/durationSeconds/distanceMeters/maxSpeed, already
    // fetched on Home) - reshaped here into the exact {name, startTime, distanceMeters,
    // durationSeconds, ascentMeters, track} shape ActivityCard.qml already expects, so no
    // new QML component is needed. Every session becomes a real "Walk" card - Kailash's own
    // DeviceHistory doesn't record which activity type each session was (unlike Ambit3's
    // real ExerciseLog), and "Walk" is the closest honest default for a GPS-adventure watch
    // with no sport-mode concept at all, per this request.
    //
    // Real, 2026-08-09 ("Something is bizarre on the activities, they say no gps, but they
    // have gps") - ascentMeters/track used to be unconditionally empty here, described above
    // as "this logbook has summary stats only, no per-session GPS track" - true of
    // DeviceHistory sessions on their own, but wrong to leave it there: the watch's separate,
    // continuous TrackLog DOES cover these same real time windows. KailashService.
    // trackLogActivities now does that correlation server-side (see kailash_tracklog.py's
    // split_into_activities() docstring) and comes back index-aligned 1:1 with
    // KailashService.sessions - zipped together here so distance/duration keep coming from
    // the watch's own real reported stats (more accurate than a GPS-derived approximation)
    // while track comes from the real correlated GPS points. A session genuinely outside
    // TrackLog's coverage (predates capture start, etc.) still gets a real empty track, not a
    // wrong one - ActivityCard.qml already renders that as "No GPS track", which is correct
    // for that specific case.
    readonly property var kailashActivities: KailashService.sessions.map(function(s, i) {
        var t = KailashService.trackLogActivities[i];
        return {
            name: qsTr("Walk"),
            startTime: s.when,
            distanceMeters: s.distanceMeters,
            durationSeconds: s.durationSeconds,
            ascentMeters: 0,
            track: (t && t.track) ? t.track : [],
        };
    })

    readonly property bool loading:
        HomeViewModel.isGarmin ? GarminService.activitiesLoading
        : HomeViewModel.isKailash ? KailashService.loading
        : ActivityService.loading
    readonly property var activeActivities:
        HomeViewModel.isGarmin ? GarminService.activities
        : HomeViewModel.isKailash ? root.kailashActivities
        : ActivityService.activities

    Component.onCompleted: {
        ActivityService.refresh()
        GarminService.refreshActivities()
        KailashService.refreshHistory()
        // Real, 2026-08-09: needed for the real per-session track correlation above - this
        // page didn't fetch TrackLog at all before (track was always the empty placeholder).
        // A real ~1.3MB flash read (slow, see KailashService::refreshTrackLog()'s own
        // comment) but this page is only opened on demand, not part of the Home hot path.
        //
        // Real, 2026-08-09 ("activities, they take a while to load...any chance of fixing?")
        // - Component.onCompleted re-fires every time this page is (re)loaded (Main.qml's
        // Loader recreates it on navigation), so leaving this unconditional meant paying the
        // real ~39s flash read again on every single visit, even though the watch's own
        // TrackLog data can't have changed since the last read within the same connected
        // session. Skipped once a real read has already succeeded - HomePage.qml's own
        // Kailash-connect handler still does the first one.
        if (!KailashService.trackLogOk)
            KailashService.refreshTrackLog()
    }

    // Real, not a guess: the watch's ExerciseLog region is ~5.3MB, read 1024 bytes at a
    // time over USB - genuinely takes a couple of minutes. Without this, the page was a
    // blank white screen the whole time (found 2026-08-07 via real testing) - looked broken,
    // wasn't. Garmin's own read is a plain local file read - fast, and Kailash's own
    // DeviceHistory read (2026-08-09) is a single 0x1200 query, also fast - so this message
    // only applies to the Ambit3 ExerciseLog path.
    Text {
        visible: root.selectedActivity === null && root.loading
                 && !HomeViewModel.isGarmin && !HomeViewModel.isKailash
        anchors.horizontalCenter: parent.horizontalCenter
        y: Theme.spacingLarge
        color: Theme.mutedText
        text: qsTr("Reading activities off the watch - this can take a couple of minutes " +
                    "(the log is read in full over USB, there's no faster path yet)...")
    }

    // Real, 2026-08-09 ("activities, they take a while to load...any chance of fixing?") -
    // sessions themselves (name/distance/duration) already show up fast once
    // KailashService.historyOk arrives (a single quick SBEM query), well before this. Without
    // this text, cards would just silently gain a GPS track/map some ~30-40s later with zero
    // explanation - looked like nothing was happening, not "still working." trackLogLoading
    // is tracked separately from KailashService.loading specifically because that shared flag
    // already clears as soon as the fast history request finishes (see its own header
    // comment) - this needed its own signal that stays true for this request's real duration.
    Rectangle {
        // Real bug, found live 2026-08-09 ("the loading text is on the back of the
        // activities cards") - unlike the other loading texts on this page, this one can be
        // visible at the same time the GridView below already has real cards to draw (the
        // fast session list arrives before this slow TrackLog read finishes), and QML stacks
        // siblings by declaration order when z isn't set - the GridView, declared later in
        // this file, was painting over this text instead of the reverse. Explicit z instead
        // of just reordering the declarations, so this stays correct regardless of future
        // edits moving things around. Also given a real opaque background (a plain Text
        // wasn't enough on its own - readable over the page's own background, but not over a
        // busy map/photo card sitting right under it) and made click-through-blocking so it
        // doesn't sit invisibly on top of a card's own TapHandler.
        id: trackLogLoadingBanner
        z: 1
        visible: root.selectedActivity === null && HomeViewModel.isKailash
                 && KailashService.trackLogLoading
        // Real, 2026-08-09 ("align the box... to be centered compared to the cards"),
        // corrected the same day after a real screenshot showed it still off - GridView
        // packs cards flush against its own left edge, it doesn't center an incomplete last
        // column, so all of (width - contentWidthUsed) is unused space on the *right*, not
        // split evenly on both sides as the first version of this assumed.
        // Real, 2026-08-09 ("replicate the design of the cards... to avoid unnecessary
        // colors") - dropped the green accent border, plain Theme.card background plus the
        // exact same shadow Card.qml itself uses everywhere else in the app (layer.enabled +
        // MultiEffect.shadowEnabled - unlike the maskEnabled/maskSource attempt reverted
        // earlier, this specific shadow usage is the same one already proven stable on
        // every card in the app, not a new risk).
        x: activitiesGrid.x + (activitiesGrid.contentWidthUsed - width) / 2
        y: Theme.spacingLarge
        width: Math.min(parent.width - Theme.spacingLarge * 2, bannerText.implicitWidth + Theme.spacingMedium * 2)
        height: bannerText.implicitHeight + Theme.spacingSmall * 2
        radius: Theme.radiusCard
        color: Theme.card
        layer.enabled: true
        layer.effect: MultiEffect {
            shadowEnabled: true
            shadowColor: Theme.isDark ? "#80000000" : "#33000000"
            shadowBlur: 0.5
            shadowVerticalOffset: 2
            shadowHorizontalOffset: 0
        }

        MouseArea { anchors.fill: parent }  // absorbs clicks meant for the banner, not a card underneath

        Text {
            id: bannerText
            anchors.centerIn: parent
            width: parent.width - Theme.spacingMedium * 2
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignHCenter
            color: Theme.mutedText
            text: qsTr("Loading GPS tracks for these activities off the watch " +
                        "(a real ~1.3MB flash read, can take up to a minute)...")
        }
    }

    // Real request 2026-08-07: "activities... saved in the computer... loads when watch is
    // not plugged" - ActivityService now caches every successful read locally and falls
    // back to that cache when a live read fails, flagged here rather than silently shown as
    // if it were current. Garmin has no separate cache concept - its own files already live
    // on the device's own storage, read fresh every time.
    Text {
        // Real bug, found live 2026-08-09 ("after loaded there is still text under the
        // cards") - this is genuinely an ActivityService/Ambit3 concept (its own on-disk
        // exercise-log cache), but was never gated against Kailash, so a stale
        // ActivityService.showingCachedData left over from an earlier Ambit3 connection this
        // same app session could show it while a Kailash was the one actually connected -
        // same declaration-order-vs-GridView issue as the trackLog banner above, peeking out
        // near/under the card grid instead of being hidden outright.
        visible: root.selectedActivity === null && !root.loading && !HomeViewModel.isGarmin
                 && !HomeViewModel.isKailash && ActivityService.showingCachedData
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
        RoundedButton {
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
        id: activitiesGrid
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.leftMargin: Theme.spacingLarge
        anchors.rightMargin: Theme.spacingLarge
        anchors.bottomMargin: Theme.spacingLarge
        // Real, 2026-08-09 ("put the cards down, give space between the text and the
        // cards") - the loading banner above used to sit at the same y as this grid's own
        // top margin, with the grid painting right up against/behind it (z: 1 on the banner
        // only fixed which one is on top, not the fact they occupied the same space). Drops
        // below the banner's own bottom edge, with real spacing, only while it's visible.
        anchors.top: trackLogLoadingBanner.visible ? trackLogLoadingBanner.bottom : parent.top
        anchors.topMargin: trackLogLoadingBanner.visible ? Theme.spacingMedium : Theme.spacingLarge
        visible: root.selectedActivity === null && Theme.activitiesView !== "list"
        clip: true
        cellWidth: 360 + Theme.spacingMedium
        cellHeight: 280 + Theme.spacingMedium
        reuseItems: true
        // Real, 2026-08-09 ("align the box with the loading gps track to be centered
        // compared to the cards") - GridView packs cards from the left and doesn't stretch
        // to fill its own width, so centering the loading banner on the *page* only lines up
        // with the cards when they happen to fill every column exactly. This is how many
        // columns are actually occupied right now, so the banner below can center on that
        // real span instead.
        readonly property int columnsShown:
            Math.max(1, Math.min(Math.floor(width / cellWidth), Math.max(1, model ? model.length : 1)))
        readonly property real contentWidthUsed: columnsShown * cellWidth
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

    // List view - André, item 16. A ListView rather than a Repeater for the same reason the
    // grid is a GridView: it virtualises, so a long history costs the same as a short one.
    ListView {
        id: activitiesList
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.leftMargin: Theme.spacingLarge
        anchors.rightMargin: Theme.spacingLarge
        anchors.bottomMargin: Theme.spacingLarge
        anchors.top: trackLogLoadingBanner.visible ? trackLogLoadingBanner.bottom : parent.top
        anchors.topMargin: trackLogLoadingBanner.visible ? Theme.spacingMedium : Theme.spacingLarge
        visible: root.selectedActivity === null && Theme.activitiesView === "list"
        clip: true
        reuseItems: true
        spacing: 0
        model: root.activeActivities
        delegate: ActivityRow {
            required property var modelData
            width: activitiesList.width
            activity: modelData
            onOpened: root.selectedActivity = modelData
        }
    }

    ActivityDetail {
        anchors.fill: parent
        visible: root.selectedActivity !== null
        activity: root.selectedActivity
        onBack: root.selectedActivity = null
    }
}
