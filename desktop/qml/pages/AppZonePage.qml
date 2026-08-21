import QtQuick
import QtQuick.Controls
import AmbitApp

// The App Zone (Suunto Apps) builder launcher, mirroring IntervalsPage. Like that page it
// doesn't build anything itself - tools/apps_gui.py is a real, self-contained tool (its own local
// server + browser UI) - this just launches it (AppZoneService), for the same reason (no in-app
// WebEngine to duplicate the user's own browser). Suunto-only; gated behind its own experimental
// toggle in Settings, revealed in the NavRail the same way Intervals is. Distinct from the Suunto
// Apps CATALOG (installing pre-made apps), which lives in the Sport Modes data-field picker.
PageFlickable {
    id: root
    contentWidth: width
    contentHeight: column.height + Theme.spacingLarge * 2
    clip: true

    property string lastResultText: ""
    property bool lastResultOk: true

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.top: parent.top
        anchors.topMargin: Theme.spacingLarge
        width: 480
        spacing: Theme.spacingMedium

        Card {
            width: parent.width
            Column {
                width: parent.width
                spacing: Theme.spacingSmall

                Row {
                    spacing: Theme.spacingSmall
                    Text {
                        text: Icons.appZone
                        font.family: Icons.fontFamily
                        font.pixelSize: 28
                        color: Theme.primary
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Text {
                        text: qsTr("App Zone Builder")
                        font.bold: true
                        font.pixelSize: Theme.fontSizeHeading
                        color: Theme.text
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }

                Text {
                    width: parent.width
                    wrapMode: Text.WordWrap
                    color: Theme.mutedText
                    font.pixelSize: Theme.fontSizeLabel
                    text: qsTr("Write a Suunto App in the App Zone scripting language, compile it " +
                                "on the community compiler, and install it onto a sport mode's " +
                                "display field - the same tool as tools/apps_gui.py. Opens in your " +
                                "default browser as its own local app, separate from this window. " +
                                "For a structured interval workout instead, use the Intervals menu.")
                }

                RoundedButton {
                    text: qsTr("Open App Builder")
                    onClicked: {
                        const error = AppZoneService.launch();
                        root.lastResultOk = error.length === 0;
                        root.lastResultText = error.length === 0
                            ? qsTr("Launched - check your browser.")
                            : error;
                    }
                }

                Text {
                    visible: root.lastResultText.length > 0
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Theme.fontSizeCaption
                    color: root.lastResultOk ? Theme.success : Theme.error
                    text: root.lastResultText
                }
            }
        }
    }
}
