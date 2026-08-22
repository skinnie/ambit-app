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
        // Coach (v2 concept, 2026-08-21): readiness beacon + chat, one screen. Same
        // reasoning as Totals/Calendar - it reads local activity history, not the connected
        // watch, so it shows for every device including none.
        NavItem {
            width: parent.width
            visible: DeviceService.coachEnabled
            glyph: Icons.coach
            label: qsTr("Coach")
            selected: root.currentPage === "coach"
            onClicked: root.pageSelected("coach")
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
        // Gear tracker (v3, 2026-08-18): bikes/shoes + components + service reminders, imported
        // from intervals.icu and owned locally. No device support to gate on (same as Totals/
        // Calendar) — it's about your gear, not the connected watch.
        NavItem {
            width: parent.width
            glyph: Icons.gear
            label: qsTr("Gear")
            selected: root.currentPage === "gear"
            onClicked: root.pageSelected("gear")
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
            // Experimental menu feature (2026-08-17): gated on its own toggle in Settings, the
            // same per-feature model the Android app uses. Still Ambit-only (rides App-Zone).
            visible: DeviceService.intervalsEnabled && HomeViewModel.anyDevice
                     && !HomeViewModel.isGarmin && !HomeViewModel.isKailash
                     // Traverse/Traverse Alpha have no TrainingProgram region - no planned moves.
                     && !HomeViewModel.isTraverse
            useIntervalsIcon: true
            label: qsTr("Intervals")
            selected: root.currentPage === "intervals"
            onClicked: root.pageSelected("intervals")
        }
        // App Zone builder (write + compile + install a generic Suunto App) - its own
        // experimental toggle, same model as Intervals. Ambit3 AND Traverse (both have a
        // CustomModes + Apps region); Kailash excluded (no CustomModes), Garmin excluded (no
        // Suunto-Apps concept) - unlike Intervals it does NOT need a TrainingProgram region, so
        // Traverse is not excluded here.
        NavItem {
            width: parent.width
            visible: DeviceService.appZoneEnabled && HomeViewModel.anyDevice
                     && !HomeViewModel.isGarmin && !HomeViewModel.isKailash
            glyph: Icons.appZone
            label: qsTr("App Zone")
            selected: root.currentPage === "appZone"
            onClicked: root.pageSelected("appZone")
        }
        // Training Program (2026-08-12, "movescount era called them training program.
        // 2 on a screen on our app") - scheduled, date-gated workouts. Same Suunto-only
        // gating as Intervals: it rides the identical App-Zone/CustomModes install
        // mechanism, which neither a Garmin nor a Kailash has.
        NavItem {
            width: parent.width
            // ON HOLD 2026-08-13 - hidden behind FeatureFlags.trainingProgram (default false).
            // See FeatureFlags.qml and docs/training_program_andre.md Findings 58-61.
            visible: FeatureFlags.trainingProgram && HomeViewModel.anyDevice
                     && !HomeViewModel.isGarmin && !HomeViewModel.isKailash
            glyph: Icons.trainingProgram
            label: qsTr("Training Program")
            selected: root.currentPage === "trainingProgram"
            onClicked: root.pageSelected("trainingProgram")
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
        // Watch settings (2026-08-14, André: "create a new menu/window for it, after sports
        // modes") - the cable-written on-watch settings, moved out of the Settings page to
        // their own item. Suunto-only and needs a connected watch to read/write, so gated the
        // same way the Settings card that held it was (visible: !isGarmin) plus anyDevice.
        NavItem {
            width: parent.width
            visible: HomeViewModel.anyDevice && !HomeViewModel.isGarmin
            glyph: Icons.watch
            label: qsTr("Watch settings")
            selected: root.currentPage === "watchSettings"
            onClicked: root.pageSelected("watchSettings")
        }
        // Firmware update / recovery (2026-08-12) - Suunto-only, like the rest of the
        // firmware pipeline. Shown when a Suunto watch is connected OR sitting in its
        // bootloader (recovery), which is exactly when there's something to do; a bricked
        // watch still enumerates, so anyDevice covers it. Garmin has no such mechanism.
        // Real, 2026-08-13 (André, live BLE testing against the Traverse): hidden over
        // Bluetooth - see ambit_app_never_touch_firmware memory/this project's own standing
        // rule, a real flash write is the one mistake here that can brick the watch, and
        // firmware flashing has never been ported to (or hardware-tested over) BLE at all,
        // unlike every other feature in this nav rail. Cable stays the only way in.
        NavItem {
            width: parent.width
            visible: HomeViewModel.anyDevice && !HomeViewModel.isGarmin
                     && !DeviceService.bleHandshakeDone
            glyph: Icons.sync
            label: qsTr("Firmware")
            selected: root.currentPage === "firmware"
            onClicked: root.pageSelected("firmware")
        }
        // Suunto Smart Sensor (2026-08-14, André: "Create a card/menu for it, after firmware")
        // - the HR belt, a standalone BLE peripheral independent of any watch, so it is not
        // gated on a connected watch (same as it was always shown in Settings). Reuses the
        // activities glyph (worn during exercise); the label tells it apart.
        NavItem {
            width: parent.width
            // Experimental menu feature (2026-08-17): standalone BLE HR belt, shown whenever its
            // own toggle is on (no watch needed), matching the Android app's gating.
            visible: DeviceService.smartSensorEnabled
            glyph: Icons.activities
            label: qsTr("Smart Sensor")
            selected: root.currentPage === "smartSensor"
            onClicked: root.pageSelected("smartSensor")
        }
        // GPS Track Pod (2026-08-12, "just blind, as experimental") - a separate, standalone
        // Suunto GPS logger, not a watch, so its own visibility is NOT gated on
        // HomeViewModel.anyDevice/family the way every other item above is - it neither
        // needs nor cares whether a watch is connected. Gated purely on the Settings
        // toggle, off by default, since none of it has ever been hardware-confirmed - see
        // GpsTrackPodPage.qml's own banner.
        NavItem {
            width: parent.width
            visible: DeviceService.gpsTrackPodExperimentEnabled
            // Reuses Icons.sync rather than adding an unverified new glyph codepoint - the
            // label text tells the two apart, and this whole feature is already
            // "don't guess where a real answer isn't available" territory.
            glyph: Icons.sync
            label: qsTr("GPS Track Pod")
            selected: root.currentPage === "gpsTrackPod"
            onClicked: root.pageSelected("gpsTrackPod")
        }
        // Suunto T6 (2026-08-14, "implement Suunto t6 ... only as experimental") - a
        // separate, older Suunto heart-rate training computer (no GPS), not one of the
        // watches. Same built-blind, Settings-gated, off-by-default treatment as the GPS
        // Track Pod above - see SuuntoT6Page.qml's own banner. Reuses Icons.activities (worn
        // during exercise); the label tells it apart.
        NavItem {
            width: parent.width
            visible: DeviceService.suuntoT6ExperimentEnabled
            glyph: Icons.activities
            label: qsTr("Legacy Suunto")
            selected: root.currentPage === "suuntoT6"
            onClicked: root.pageSelected("suuntoT6")
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
