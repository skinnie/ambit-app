import QtQuick
import AmbitApp

// AMBITAPP_SPEC.md, "Navigation": Home / Activities / Routes / POIs / Backup / Settings,
// Sport Modes hidden by default. Order updated 2026-08-09 (Settings moved to the very
// bottom, below Sport Modes) - selection is by string id, not index, so this reordering
// (and Sport Modes appearing/disappearing as FeatureFlags.sportModes flips) never shifts
// any other item's own identity.
Rectangle {
    id: root

    property string currentPage: "home"
    signal pageSelected(string pageId)

    implicitWidth: 220
    color: Theme.card

    Column {
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.margins: Theme.spacingSmall
        spacing: 2

        NavItem {
            width: parent.width
            glyph: Icons.home
            label: qsTr("Home")
            selected: root.currentPage === "home"
            onClicked: root.pageSelected("home")
        }
        NavItem {
            width: parent.width
            glyph: Icons.activities
            label: qsTr("Activities")
            selected: root.currentPage === "activities"
            onClicked: root.pageSelected("activities")
        }
        NavItem {
            width: parent.width
            // Kailash excluded, real 2026-08-09 - it's a GPS travel/adventure watch with no
            // route-following feature at all (KAILASH-SCOPING-NOTE.md's own "What this
            // project is (and isn't)" section), not a gap in this page.
            visible: !HomeViewModel.isKailash
            glyph: Icons.routes
            label: qsTr("Routes")
            selected: root.currentPage === "routes"
            onClicked: root.pageSelected("routes")
        }
        NavItem {
            width: parent.width
            // Kailash excluded, real 2026-08-09, same reasoning as Routes above.
            visible: !HomeViewModel.isKailash
            glyph: Icons.pois
            label: qsTr("POIs")
            selected: root.currentPage === "pois"
            onClicked: root.pageSelected("pois")
        }
        // Totals - André, 2026-08-11 ("Create a new screen: Totals (For the year)"). Sits
        // next to Activities because it is the same data, summed: no device support to gate
        // on, so it shows for every device including none, where it explains itself.
        NavItem {
            width: parent.width
            glyph: Icons.sportModes
            label: qsTr("Totals")
            selected: root.currentPage === "totals"
            onClicked: root.pageSelected("totals")
        }
        // Calendar - real request, 2026-08-11 (André, with a reference screenshot). Same
        // reasoning as Totals just above: it's the same device-aware activity list, no
        // device support to gate on, so it shows for every device including none.
        NavItem {
            width: parent.width
            glyph: Icons.calendar
            label: qsTr("Calendar")
            selected: root.currentPage === "calendar"
            onClicked: root.pageSelected("calendar")
        }
        NavItem {
            width: parent.width
            // Nothing to back up, and nothing to restore to, without a device.
            visible: HomeViewModel.anyDevice
            glyph: Icons.backup
            label: qsTr("Backup")
            selected: root.currentPage === "backup"
            onClicked: root.pageSelected("backup")
        }
        // Real, 2026-08-08 ("a new menu, for suunto, called Intervals") - Suunto-only, same
        // as the App-Zone compiler it launches (tools/workout_gui.py) being an Ambit3
        // mechanism with no Garmin equivalent. Kailash excluded too, real 2026-08-09
        // ("intervals menu should only appear for ambit or nothing connect") - App-Zone
        // workouts are a CustomModes/Suunto-Apps mechanism, same one Kailash's own
        // Sport Modes page exclusion is based on (no CustomModes region on that watch).
        NavItem {
            width: parent.width
            visible: HomeViewModel.anyDevice
                     && !HomeViewModel.isGarmin && !HomeViewModel.isKailash
            useIntervalsIcon: true
            label: qsTr("Intervals")
            selected: root.currentPage === "intervals"
            onClicked: root.pageSelected("intervals")
        }
        NavItem {
            width: parent.width
            // Kailash excluded, real 2026-08-08: its own memory map reports no CustomModes
            // region at all (confirmed empty - see custom_modes_andre.md's Kailash
            // section), so this page has nothing to show for it. Garmin excluded, real
            // 2026-08-11 (André: "sports modes should not appear on etrex") - an eTrex is a
            // plain GPS logger with no on-watch sport-mode concept either (see
            // GarminService::parseActivityGpx()'s own "no sport-type concept in a real
            // Garmin GPX" comment), so same reasoning as Kailash applies.
            visible: FeatureFlags.sportModes && HomeViewModel.anyDevice
                     && !HomeViewModel.isKailash && !HomeViewModel.isGarmin
            glyph: Icons.sportModes
            label: qsTr("Sport Modes")
            selected: root.currentPage === "sportModes"
            onClicked: root.pageSelected("sportModes")
        }
        // Real, 2026-08-09 ("switch the place of settings and sport modes, being
        // settings at the bottom") - last item in the rail now, on purpose.
        NavItem {
            width: parent.width
            glyph: Icons.settings
            label: qsTr("Settings")
            selected: root.currentPage === "settings"
            onClicked: root.pageSelected("settings")
        }
    }
}
