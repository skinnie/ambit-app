import QtQuick
import QtQuick.Controls
import AmbitApp

// Real, 2026-08-08 ("Create a new menu, for suunto, called Intervals, that would link to our
// interval workout builder"). This page doesn't build workouts itself - tools/workout_gui.py
// already is a real, working, self-contained tool (its own local server + browser UI, see
// tools/packaging/README.md) - this is just the launcher, matching IntervalsService's own
// "launch the other real app" scope. Suunto-only (App-Zone compiling is an Ambit3 mechanism,
// no Garmin equivalent), same as NavRail's own visibility rule for this entry.
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
                    IntervalsIcon { size: 28; color: Theme.primary; anchors.verticalCenter: parent.verticalCenter }
                    Text {
                        text: qsTr("Interval Workout Builder")
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
                    text: qsTr("Build a structured interval workout and compile it into a " +
                                "real Suunto App, the same tool as tools/workout_gui.py - " +
                                "opens in your default browser as its own local app, " +
                                "separate from this window. Works offline except for the " +
                                "final compile step.")
                }

                RoundedButton {
                    text: qsTr("Open Workout Builder")
                    onClicked: {
                        const error = IntervalsService.launch();
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
