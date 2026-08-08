import QtQuick
import AmbitApp

// AMBITAPP_SPEC.md, "Navigation": Home / Activities / Routes / POIs / Backup / Settings,
// Sport Modes hidden. Selection is by string id, not index - so Sport Modes appearing later
// (FeatureFlags.sportModes flips to true) never shifts anything else's identity.
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
            glyph: Icons.routes
            label: qsTr("Routes")
            selected: root.currentPage === "routes"
            onClicked: root.pageSelected("routes")
        }
        NavItem {
            width: parent.width
            glyph: Icons.pois
            label: qsTr("POIs")
            selected: root.currentPage === "pois"
            onClicked: root.pageSelected("pois")
        }
        NavItem {
            width: parent.width
            glyph: Icons.backup
            label: qsTr("Backup")
            selected: root.currentPage === "backup"
            onClicked: root.pageSelected("backup")
        }
        // Real, 2026-08-08 ("a new menu, for suunto, called Intervals") - Suunto-only, same
        // as the App-Zone compiler it launches (tools/workout_gui.py) being an Ambit3
        // mechanism with no Garmin equivalent.
        NavItem {
            width: parent.width
            visible: !HomeViewModel.isGarmin
            useIntervalsIcon: true
            label: qsTr("Intervals")
            selected: root.currentPage === "intervals"
            onClicked: root.pageSelected("intervals")
        }
        NavItem {
            width: parent.width
            glyph: Icons.settings
            label: qsTr("Settings")
            selected: root.currentPage === "settings"
            onClicked: root.pageSelected("settings")
        }
        NavItem {
            width: parent.width
            visible: FeatureFlags.sportModes
            glyph: Icons.sportModes
            label: qsTr("Sport Modes")
            selected: root.currentPage === "sportModes"
            onClicked: root.pageSelected("sportModes")
        }
    }
}
