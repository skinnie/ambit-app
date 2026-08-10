import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import AmbitApp

// Step 4: real device-hero layout. Step 5 adds real weather. Last Activity made real
// 2026-08-07 once ActivityService actually worked - see its own card comment below.
Flickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    Component.onCompleted: {
        DeviceService.refresh();
        // Real, 2026-08-08: Garmin detection is a cheap filesystem check (QStorageInfo +
        // one small XML file), not a USB/subprocess round trip like DeviceService's own -
        // safe to run on every Home load alongside it, not gated behind Ambit failing first.
        GarminService.detect();
        // IP-based location by default, real request 2026-08-07 (was a hardcoded central-
        // Europe default before) - detectLocationFromIp() calls refresh() itself once it has
        // real coordinates, or falls back to refresh()-with-whatever-it-had if the IP lookup
        // itself fails, so this always ends in a real fetch attempt either way.
        WeatherService.detectLocationFromIp();
        ActivityService.refresh();
        DeviceService.checkGpsOrbitStatus();
    }

    // Real, 2026-08-08 ("Yes I want to implement it both to desktop and android version").
    // isKailash only becomes true once DeviceService.refresh() (fired above) has actually
    // identified the connected watch, so this can't just be another Component.onCompleted
    // call the way ActivityService.refresh() is - it has to react to isKailash itself
    // becoming true, including on a later reconnect after the page was already loaded.
    // Real, 2026-08-09 ("Implement home city name" not showing up promptly) - the backend
    // serializes every real watch request through one lock (server.py's own WATCH_LOCK),
    // and refreshTrackLog() is a real ~1.3MB flash read (its own doc comment already calls
    // out as slow) - firing it alongside the fast history/settings requests risked queuing
    // the city-name lookup's own settings fetch behind it for a long time, not broken, just
    // stuck waiting. Fast requests (history, settings) now go first; the slow TrackLog read
    // goes last so it can't block anything else from completing promptly.
    Connections {
        target: HomeViewModel
        function onIsKailashChanged() {
            if (HomeViewModel.isKailash) {
                KailashService.refreshHistory();
                // The watch's real HomeLocation setting lives in the generic Settings
                // mechanism (same one SettingsPage.qml's own coord editor uses), not a
                // Kailash-specific endpoint - fetched here too so Home's own Home-location
                // card (below) has real coordinates without the user having to visit
                // Settings first. onSettingsChanged below picks the two fields out once
                // this reply lands.
                SettingsWriteService.device = "kailash";
                SettingsWriteService.refresh();
                KailashService.refreshTrackLog();
            }
        }
    }

    // Real, 2026-08-09 ("I believe you put a POI icon for home, name home and identify the
    // city by coordinates"). SettingsWriteService.settings is a flat list of every curated
    // setting for whichever device is connected - picks out home_latitude/home_longitude
    // specifically (see AmbitSettingsReader.ts's own field comment / the
    // ambit_app_kailash_home_location_field memory for why those two exist at all) and
    // hands them to KailashService.refreshHomeLocation() for the actual reverse-geocode.
    Connections {
        target: SettingsWriteService
        function onSettingsChanged() {
            if (!HomeViewModel.isKailash) return;
            let lat = null, lon = null;
            for (const row of SettingsWriteService.settings) {
                if (row.key === "home_latitude") lat = row.value;
                else if (row.key === "home_longitude") lon = row.value;
            }
            if (lat !== null && lon !== null
                && (lat !== KailashService.homeLatitude || lon !== KailashService.homeLongitude)) {
                KailashService.refreshHomeLocation(lat, lon);
            }
        }
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        spacing: Theme.spacingMedium

        // --- Device hero card: the watch is the hero, only one, per the spec. Real,
        // 2026-08-08 ("home page: instead of ambit it detects an etrex... firmware version,
        // hwid etc like on the android version") - device-aware: Ambit and Garmin are
        // genuinely different device mechanisms (see GarminService's own header comment),
        // so this shows whichever one HomeViewModel.isGarmin/isAmbit says is actually
        // connected, not a merged view. Battery has no Garmin equivalent here (a mounted
        // mass-storage filesystem doesn't expose it), so it's simply not shown for Garmin,
        // not shown as "Not available yet" - that phrasing is for a real Ambit3 field this
        // project hasn't wired up yet, not a field that doesn't exist for this device type. ---
        Card {
            width: parent.width

            Column {
                width: parent.width
                spacing: Theme.spacingMedium

                Row {
                    width: parent.width
                    spacing: Theme.spacingMedium

                    // Standing in for the real Ambit3 Peak Sapphire product photo the spec
                    // asks for (from Suunto's own Android app resources) - not pulled in
                    // yet on purpose: those images are proprietary Suunto assets
                    // (assets/ is gitignored for exactly this reason project-wide), so
                    // using one here needs a real licensing check first, the same care
                    // already applied to not reusing SuuntoLink's own icon for this app's
                    // icon. A real product photo replaces this once that's settled.
                    Rectangle {
                        width: 64
                        height: 64
                        radius: Theme.radiusSmall
                        color: Theme.background
                        Icon {
                            visible: !HomeViewModel.isGarmin
                            anchors.centerIn: parent
                            glyph: Icons.watch
                            size: 32
                        }
                        EtrexIcon {
                            visible: HomeViewModel.isGarmin
                            anchors.centerIn: parent
                            size: 32
                        }
                    }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2

                        Text {
                            text: HomeViewModel.isGarmin
                                ? (GarminService.model || qsTr("Garmin eTrex"))
                                : HomeViewModel.deviceDisplayName
                            font.pixelSize: Theme.fontSizeTitle
                            font.bold: true
                            color: Theme.text
                        }
                        Row {
                            spacing: 6
                            Rectangle {
                                width: 8; height: 8; radius: 4
                                anchors.verticalCenter: parent.verticalCenter
                                color: HomeViewModel.isGarmin
                                    ? Theme.success
                                    : HomeViewModel.connectionStatusColor
                            }
                            Text {
                                text: HomeViewModel.isGarmin
                                    ? qsTr("Connected")
                                    : HomeViewModel.connectionStatusText
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeBody
                            }
                        }
                    }
                }

                // --- Ambit3 info rows ---
                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge
                    visible: !HomeViewModel.isGarmin

                    Column {
                        spacing: 2
                        Text { text: qsTr("Battery"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text { text: HomeViewModel.batteryText; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Firmware"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text { text: HomeViewModel.firmwareText; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    }
                    Column {
                        width: 140
                        spacing: 2
                        Text { text: qsTr("GPS orbit"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        // Real, 2026-08-07 (was "Not available yet" - the backend side,
                        // sgee_andre.md, was already built and hardware-verified, only this
                        // UI was missing). Passively shows the watch's own currently-stored
                        // orbit date on every Home load (checkGpsOrbitStatus(), read-only,
                        // works even offline); tapping runs the real update flow
                        // (updateGpsOrbit()) - download-if-online-and-stale, else honestly
                        // report why not, matching this app's own "explicit tap for any
                        // write" rule elsewhere (Routes/Backup) rather than writing to the
                        // watch just from loading this page.
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            text: DeviceService.gpsOrbitBusy
                                ? qsTr("Checking...")
                                : (DeviceService.gpsOrbitStatusText || qsTr("Tap to check"))
                            color: Theme.primary
                            font.pixelSize: Theme.fontSizeBody
                            font.underline: !DeviceService.gpsOrbitBusy
                            TapHandler {
                                enabled: !DeviceService.gpsOrbitBusy
                                onTapped: DeviceService.updateGpsOrbit()
                            }
                        }
                    }
                }

                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge
                    visible: !HomeViewModel.isGarmin

                    Column {
                        spacing: 2
                        Text { text: qsTr("Serial number"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text { text: HomeViewModel.serialText; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Hardware"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text { text: HomeViewModel.hardwareText; color: Theme.text; font.pixelSize: Theme.fontSizeBody }
                    }
                    // Real, 2026-08-10 ("I connected the kailash via usb... it didn't sync
                    // time... is this function implemented in our app? if not implement it") -
                    // same "explicit tap, no rehearsal shown" pattern as GPS orbit above,
                    // tools/set_time.py's own docstring covers why this one has no rehearsal
                    // step at all (always-safe clock set, unlike flash/PMEM writes).
                    Column {
                        width: 200
                        spacing: 2
                        Text { text: qsTr("Clock"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            text: DeviceService.timeSyncBusy
                                ? qsTr("Syncing...")
                                : (DeviceService.timeSyncStatusText || qsTr("Tap to sync"))
                            color: Theme.primary
                            font.pixelSize: Theme.fontSizeBody
                            font.underline: !DeviceService.timeSyncBusy
                            TapHandler {
                                enabled: !DeviceService.timeSyncBusy
                                onTapped: {
                                    timezonePicker.visible = false
                                    timeSyncMenu.visible = !timeSyncMenu.visible
                                }
                            }
                        }

                        // Real, 2026-08-10 ("a button to sync time... opens a menu 'from
                        // device' 'from different timezone'", then "pop up is not working" /
                        // "menu is broken again" / "menu doesn't open" through three rounds
                        // of Popup+Overlay.overlay attempts - confirmed live tonight that
                        // Overlay.overlay is genuinely null at click time in this app, not
                        // just a timing quirk to work around). A plain inline expanding
                        // Column instead - no Popup, no Overlay, no clipped-Flickable
                        // reparenting trick needed at all; it pushes the cards below it down
                        // slightly when open instead of floating over them, which sidesteps
                        // every failure mode hit tonight in one stroke.
                        Column {
                            id: timeSyncMenu
                            visible: false
                            width: parent.width
                            spacing: Theme.spacingSmall
                            topPadding: Theme.spacingSmall

                            // Real, 2026-08-10 ("the buttons seems big compared to the clock
                            // letters") - RoundedButton's own default 36px pill
                            // (implicitHeight, from its background Rectangle - see
                            // RoundedButton.qml) is right for the app's real primary actions
                            // elsewhere, but heavy for this lightweight menu. Shrunk locally
                            // here rather than adding a whole new "small button" variant
                            // component for one menu.
                            RoundedButton {
                                width: parent.width
                                implicitHeight: 30
                                text: qsTr("From device")
                                onClicked: {
                                    timeSyncMenu.visible = false
                                    DeviceService.syncTime()
                                }
                            }

                            RoundedButton {
                                width: parent.width
                                implicitHeight: 30
                                visible: !timezonePicker.visible
                                text: qsTr("From a different timezone")
                                onClicked: {
                                    DeviceService.fetchTimezones()
                                    timezonePicker.visible = true
                                }
                            }

                            Column {
                                id: timezonePicker
                                visible: false
                                width: parent.width
                                spacing: Theme.spacingSmall

                                // Real, 2026-08-10 ("when you show the timezone can you show
                                // what time is there now" - clarified after a first attempt
                                // put it in the wrong place: "next to the country-region" IN
                                // the dropdown list itself, not a separate label under the
                                // closed box). Overrides RoundedComboBox's own default
                                // delegate (RoundedComboBox.qml) for this one instance only -
                                // every other real usage of that shared component elsewhere
                                // in the app keeps its plain name-only delegate unchanged.
                                RoundedComboBox {
                                    id: tzCombo
                                    width: parent.width
                                    model: DeviceService.timezones
                                    delegate: ItemDelegate {
                                        width: tzCombo.popup.width
                                        highlighted: tzCombo.highlightedIndex === index
                                        contentItem: Text {
                                            text: modelData + "  —  " + DeviceService.currentTimeInZone(modelData)
                                            color: Theme.text
                                            font.pixelSize: Theme.fontSizeBody
                                            elide: Text.ElideRight
                                            verticalAlignment: Text.AlignVCenter
                                        }
                                        background: Rectangle {
                                            color: highlighted ? Theme.primary + "26" : "transparent"
                                        }
                                    }
                                }

                                RoundedButton {
                                    width: parent.width
                                    implicitHeight: 30
                                    text: qsTr("Sync")
                                    enabled: DeviceService.timezones.length > 0
                                    onClicked: {
                                        timeSyncMenu.visible = false
                                        DeviceService.syncTime(tzCombo.currentText)
                                    }
                                }
                            }
                        }
                    }
                }

                // --- Garmin info rows - firmware/part number, matching
                // GARMIN_USB_IMPORT_SPEC.md's own "Implementation-ready: device
                // identification" section exactly (Description + firmware as the primary
                // line, part number secondary - both real fields off GarminDevice.xml, not
                // guessed). No battery row: a mounted mass-storage filesystem has no way to
                // report it, unlike the Ambit3's own 0x0000 reply. ---
                Row {
                    width: parent.width
                    spacing: Theme.spacingLarge
                    visible: HomeViewModel.isGarmin

                    Column {
                        spacing: 2
                        Text { text: qsTr("Firmware"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: GarminService.firmwareVersion || qsTr("Not available")
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("Part number"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: GarminService.partNumber || qsTr("Not available")
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                    Column {
                        spacing: 2
                        Text { text: qsTr("SD card"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: GarminService.hasSdCard ? qsTr("Present") : qsTr("Not detected")
                            color: GarminService.hasSdCard ? Theme.text : Theme.mutedText
                            font.pixelSize: Theme.fontSizeBody
                        }
                    }
                }

                // Real request 2026-08-08: "you can remove the refresh button" - connection
                // status now keeps itself current on its own (DeviceService's own polling:
                // stops once connected, retries every 1s until it isn't), so a manual
                // "Refresh" button has nothing left to do that isn't already happening.
                Text {
                    visible: !HomeViewModel.isGarmin && DeviceService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: DeviceService.lastError
                }
            }
        }

        // --- Weather (Step 5) - collapses to nothing on its own if unavailable ---
        WeatherCard {}

        // --- Kailash travel history & activity-mode logbook - real, 2026-08-08 ("resumind:
        // 7r button, last city visit... if we could import this data which is on the watch
        // and read it to our app would be awesome"). Kailash has no routes/POIs/sport-mode
        // UI (it doesn't have sport modes at all - real, same day), so this is its one
        // Kailash-specific card: visited cities/countries and travel stats matching the
        // watch's own "7R" screen exactly, plus the real activity-mode logbook that turned
        // out to be bundled in the same query (see KailashService's own header comment for
        // where that was found - this project had separately been unable to locate it as
        // its own flash region). No place names shown - the watch itself only ever reports
        // coordinates + country code, not a city name; inventing a reverse-geocode lookup
        // here wasn't asked for. ---
        Card {
            width: parent.width
            visible: HomeViewModel.isKailash
                     && (KailashService.loading || KailashService.historyOk
                         || KailashService.lastError.length > 0)

            Column {
                width: parent.width
                spacing: Theme.spacingMedium

                Text { text: qsTr("Travel History"); font.bold: true; color: Theme.text }

                Text {
                    visible: KailashService.loading && !KailashService.historyOk
                    color: Theme.mutedText
                    text: qsTr("Reading travel history off the watch...")
                }

                Text {
                    visible: !KailashService.loading && !KailashService.historyOk
                             && KailashService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: KailashService.lastError
                }

                // Real request 2026-08-09 ("Try to aligne the text on home by 'collumns'").
                // GridLayout (not used anywhere else in this codebase before now) gives each
                // column a consistent width across rows automatically - the plain Row-of-
                // Columns this replaced only aligned within its own single row, so this stat
                // block and the distance/furthest-from-home block below it didn't line up
                // with each other. One shared GridLayout fixes that for both.
                GridLayout {
                    visible: KailashService.historyOk
                    width: parent.width
                    columns: 3
                    columnSpacing: Theme.spacingLarge
                    rowSpacing: Theme.spacingSmall

                    Column {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: qsTr("Cities visited"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: KailashService.citiesVisited
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                    Column {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: qsTr("Countries visited"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: KailashService.countriesVisited
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                    Column {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: qsTr("Travel days"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: KailashService.travellingDays
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }

                    Column {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: qsTr("Travelled distance"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: ActivityViewModel.formatDistance(KailashService.travelledDistanceMeters)
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                    Column {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: qsTr("Furthest from home"); color: Theme.mutedText; font.pixelSize: Theme.fontSizeLabel }
                        Text {
                            text: ActivityViewModel.formatDistance(KailashService.furthestFromHomeMeters)
                            color: Theme.text; font.pixelSize: Theme.fontSizeBody
                        }
                    }
                }

                Row {
                    visible: KailashService.historyOk
                    width: parent.width
                    spacing: Theme.spacingMedium

                    Icon { glyph: Icons.pois; size: 24; color: Theme.primary }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            text: KailashService.hasLastKnownLocation
                                ? qsTr("%1, %2").arg(KailashService.lastKnownLatitude.toFixed(4))
                                                .arg(KailashService.lastKnownLongitude.toFixed(4))
                                : qsTr("No known location yet")
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                        }
                        Text {
                            visible: KailashService.lastKnownCountry.length > 0
                                     || KailashService.lastKnownTime.length > 0
                            text: [KailashService.lastKnownCountry,
                                   KailashService.lastKnownTime
                                       ? qsTr("last seen %1").arg(
                                             ActivityViewModel.formatDate(KailashService.lastKnownTime))
                                       : ""].filter(s => s.length > 0).join(" · ")
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeLabel
                        }
                    }
                }

                // Home location - real, 2026-08-09 ("I believe you put a POI icon for home,
                // name home and identify the city by coordinates"). Same real HomeLocation
                // setting SettingsPage.qml's own coord editor reads/writes (entry 0x36,
                // ambit_app_kailash_home_location_field memory) - genuinely different data
                // from "last known location" above (that's the watch's own last GPS fix,
                // this is the fixed reference point used for furthestFromHome).
                Row {
                    visible: KailashService.hasHomeLocation
                    width: parent.width
                    spacing: Theme.spacingMedium

                    Icon { glyph: Icons.pois; size: 24; color: Theme.primary }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            text: qsTr("Home")
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBody
                            font.bold: true
                        }
                        Text {
                            text: KailashService.homeCity.length > 0
                                ? qsTr("%1 (%2, %3)").arg(KailashService.homeCity)
                                                      .arg(KailashService.homeLatitude.toFixed(4))
                                                      .arg(KailashService.homeLongitude.toFixed(4))
                                : qsTr("%1, %2").arg(KailashService.homeLatitude.toFixed(4))
                                                 .arg(KailashService.homeLongitude.toFixed(4))
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeLabel
                        }
                    }
                }

                // World map of visited places - real, 2026-08-09 ("Add a world map with the
                // points were kailash has been"). MapView's own real projection math
                // auto-fits to whatever pins are given (see MapView.qml's own `markers`
                // property comment) - a single real visited place so far on this reference
                // watch (Lille) shows as a single centered pin, exactly as accurate as this
                // watch's own real travel history; more pins appear here automatically as
                // more real travel gets recorded, no further wiring needed.
                Column {
                    visible: KailashService.historyOk && KailashService.visitedPlaces.length > 0
                    width: parent.width
                    spacing: Theme.spacingSmall

                    Text {
                        text: qsTr("Places visited (%1)").arg(KailashService.visitedPlaces.length)
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeLabel
                    }
                    // Real, 2026-08-09 ("On the map if possible put round corners"), reverted
                    // the same day: a QtQuick.Effects MultiEffect maskSource/maskEnabled
                    // attempt here left this map rendering as a real blank area (confirmed
                    // live - "Home page Places visited world map... blank/empty space"), not
                    // just square-cornered as intended. Not worth re-attempting blind (no way
                    // to visually verify a shader-based fix from here) - square corners here
                    // match every other map in the app already (ActivityCard's own map
                    // preview has no rounding either), so this is a real regression fix, not
                    // a downgrade from some established look.
                    Item {
                        width: parent.width
                        height: 200
                        clip: true
                        MapView {
                            anchors.fill: parent
                            markers: KailashService.visitedPlaces
                            zoomLevel: 4  // only used for a single pin - see MapView.qml's
                                          // own _singlePoint comment; 2+ pins auto-fit
                        }
                    }
                }

                // Activity-mode logbook - a real, separate system from the passive TrackLog
                // shown in "Last Activity" below (see kailash_history.py's own docstring):
                // explicit recorded sessions, summary stats only, no GPS track.
                Column {
                    visible: KailashService.historyOk && KailashService.sessions.length > 0
                    width: parent.width
                    spacing: Theme.spacingSmall

                    Text {
                        text: qsTr("Activity mode logbook (%1)").arg(KailashService.sessions.length)
                        color: Theme.mutedText
                        font.pixelSize: Theme.fontSizeLabel
                    }

                    // Real, 2026-08-09 ("make the 3rd collumn of numbers of activity mode
                    // logbook aligned") - duration/distance had no fixed width, so each row's
                    // 2nd/3rd column landed wherever that row's own text happened to end,
                    // same class of bug the Travel History GridLayout above already fixed.
                    // A plain Row still works fine here (only 3 always-present columns, no
                    // GridLayout needed) as long as every column gets a real fixed width.
                    Repeater {
                        model: KailashService.sessions
                        delegate: Row {
                            width: parent.width
                            spacing: Theme.spacingMedium
                            Text {
                                width: 140
                                text: ActivityViewModel.formatDate(modelData.when)
                                color: Theme.text
                                font.pixelSize: Theme.fontSizeLabel
                            }
                            Text {
                                width: 70
                                horizontalAlignment: Text.AlignRight
                                text: ActivityViewModel.formatDuration(modelData.durationSeconds)
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeLabel
                            }
                            Text {
                                width: 70
                                horizontalAlignment: Text.AlignRight
                                text: ActivityViewModel.formatDistance(modelData.distanceMeters)
                                color: Theme.mutedText
                                font.pixelSize: Theme.fontSizeLabel
                            }
                        }
                    }
                }
            }
        }

        // --- Last Activity - real, 2026-08-07 (was a Step 7 placeholder before
        // ActivityService actually worked; "New Activities" and the Home "Connections" card
        // were both dropped the same day - New Activities duplicated this card with nothing
        // else to say, and Connections already has a real home on Settings). ---
        Card {
            id: lastActivityCard
            width: parent.width
            readonly property bool activityLoading:
                HomeViewModel.isGarmin ? GarminService.activitiesLoading
                : HomeViewModel.isKailash ? (KailashService.loading && !KailashService.trackLogOk)
                : ActivityService.loading
            visible: activityLoading || lastActivityColumn.activity !== null
                     || (!HomeViewModel.isGarmin && !HomeViewModel.isKailash
                         && ActivityService.lastError.length > 0)
            Column {
                id: lastActivityColumn
                width: parent.width
                spacing: Theme.spacingSmall

                // Real, 2026-08-09: KailashService.trackLogActivities is now one real entry
                // per DeviceHistory session (correlated against TrackLog's own GPS points,
                // see kailash_tracklog.py's split_into_activities() docstring) rather than
                // one bundled everything-activity - same list shape GarminService/
                // ActivityService already use, so mostRecent() applies here too now.
                readonly property var activity: HomeViewModel.isKailash
                    ? (KailashService.trackLogOk
                       ? ActivityViewModel.mostRecent(KailashService.trackLogActivities) : null)
                    : ActivityViewModel.mostRecent(
                          HomeViewModel.isGarmin ? GarminService.activities : ActivityService.activities)

                Row {
                    spacing: Theme.spacingSmall
                    Text {
                        text: HomeViewModel.isKailash ? qsTr("Recent Track") : qsTr("Last Activity")
                        font.bold: true
                        color: Theme.text
                    }
                    Text {
                        visible: !HomeViewModel.isGarmin && !HomeViewModel.isKailash
                                 && ActivityService.showingCachedData
                        anchors.verticalCenter: parent.verticalCenter
                        text: qsTr("(cached)")
                        font.italic: true
                        font.pixelSize: Theme.fontSizeCaption
                        color: Theme.mutedText
                    }
                }

                Text {
                    visible: HomeViewModel.isGarmin ? GarminService.activitiesLoading
                        : HomeViewModel.isKailash ? (KailashService.loading && !KailashService.trackLogOk)
                        : ActivityService.loading
                    color: Theme.mutedText
                    text: HomeViewModel.isKailash
                        ? qsTr("Reading the passive GPS track off the watch...")
                        : qsTr("Reading activities off the watch...")
                }

                Text {
                    visible: !HomeViewModel.isGarmin && !HomeViewModel.isKailash && !ActivityService.loading
                             && ActivityService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: ActivityService.lastError
                }

                Text {
                    visible: HomeViewModel.isKailash && !KailashService.loading
                             && !KailashService.trackLogOk && KailashService.lastError.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.error
                    font.pixelSize: Theme.fontSizeLabel
                    text: KailashService.lastError
                }

                Row {
                    visible: !lastActivityCard.activityLoading && lastActivityColumn.activity !== null
                    width: parent.width
                    spacing: Theme.spacingMedium

                    Icon { glyph: Icons.activities; size: 28; color: Theme.primary }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            text: lastActivityColumn.activity
                                  ? (lastActivityColumn.activity.name || qsTr("Untitled activity"))
                                  : ""
                            font.bold: true
                            color: Theme.text
                            font.pixelSize: Theme.fontSizeBodyLarge
                        }
                        Text {
                            text: lastActivityColumn.activity
                                  ? ActivityViewModel.formatDate(lastActivityColumn.activity.startTime)
                                  : ""
                            color: Theme.mutedText
                            font.pixelSize: Theme.fontSizeLabel
                        }
                    }
                }

                Row {
                    visible: !lastActivityCard.activityLoading && lastActivityColumn.activity !== null
                    width: parent.width
                    spacing: Theme.spacingLarge
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatDistance(lastActivityColumn.activity.distanceMeters)
                              : ""
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeLabel
                    }
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatDuration(lastActivityColumn.activity.durationSeconds)
                              : ""
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeLabel
                    }
                    Text {
                        text: lastActivityColumn.activity
                              ? ActivityViewModel.formatElevation(lastActivityColumn.activity.ascentMeters)
                              : ""
                        color: Theme.text
                        font.pixelSize: Theme.fontSizeLabel
                    }
                }
            }
        }
    }
}
