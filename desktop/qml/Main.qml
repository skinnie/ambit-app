import QtQuick
import QtQuick.Controls
import AmbitApp

// Step 3: the real navigation shell. Home/Activities/Routes/POIs/Backup/Settings pages are
// still placeholders (their own steps fill them in) - this is about the shell itself:
// selection, layout, and Sport Modes staying hidden until FeatureFlags.sportModes flips.
ApplicationWindow {
    id: window
    visible: true
    width: 1200
    height: 800
    title: qsTr("AmbitApp")
    color: Theme.background
    // Real, 2026-08-09 ("general desktop polish pass") - without this, toggling
    // Settings' light/dark override snapped every color in the app instantly; this is the
    // one place that's genuinely app-wide (every page sits on this window's background).
    Behavior on color { ColorAnimation { duration: 150; easing.type: Easing.OutCubic } }

    readonly property var pageSources: ({
        home: "pages/HomePage.qml",
        activities: "pages/ActivitiesPage.qml",
        routes: "pages/RoutesPage.qml",
        pois: "pages/PoisPage.qml",
        backup: "pages/BackupPage.qml",
        settings: "pages/SettingsPage.qml",
        sportModes: "pages/SportModesPage.qml",
        intervals: "pages/IntervalsPage.qml",
    })

    Row {
        anchors.fill: parent

        NavRail {
            id: navRail
            height: parent.height
            currentPage: "home"
            onPageSelected: (pageId) => currentPage = pageId
        }

        Loader {
            width: parent.width - navRail.width
            height: parent.height
            source: window.pageSources[navRail.currentPage]
        }
    }
}
