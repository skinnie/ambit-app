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
    // Real, 2026-08-10 ("To recall: implement logo on desktop mode") - verified live:
    // ApplicationWindow has no `icon` property in this Qt build (6.12 - confirmed against
    // QtQuick.Templates' own plugins.qmltypes, not just a typo here), so this QML-side
    // attempt failed to even load ("Cannot assign to non-existent property icon"). Not
    // needed anyway - main.cpp's own QGuiApplication::setWindowIcon() (see its header
    // comment) already sets the same packaging/icon.png application-wide, which covers the
    // taskbar/dock entry AND every window's own icon, this one included.
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
        totals: "pages/TotalsPage.qml",
        calendar: "pages/CalendarPage.qml",
    })

    // Testing mode's simulated eTrex, wired here rather than in Settings: the device stays
    // simulated while you walk around Activities, Routes and POIs, so the binding has to
    // outlive whichever page is loaded. GarminService then discovers the fixture folder with
    // its own real scan - Settings only decides which device is selected, it does not reach
    // into the Garmin path itself.
    Binding {
        target: GarminService
        property: "demoRoot"
        value: DeviceService.demoGarminRoot
    }

    Row {
        anchors.fill: parent

        NavRail {
            id: navRail
            height: parent.height
            currentPage: "home"
            onPageSelected: (pageId) => currentPage = pageId

            // Pages navigating on their own (Home's Last Activity -> Activities, This
            // year -> Totals) - see NavBus.qml's own header for why a bus and not a
            // threaded callback.
            Connections {
                target: NavBus
                function onNavigate(pageId) {
                    if (pageId in window.pageSources)
                        navRail.currentPage = pageId
                }
            }
        }

        Loader {
            width: parent.width - navRail.width
            height: parent.height
            source: window.pageSources[navRail.currentPage]
        }
    }
}
