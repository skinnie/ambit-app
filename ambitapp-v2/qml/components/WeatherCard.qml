import QtQuick
import AmbitApp

// AMBITAPP_SPEC.md, "Weather" originally said "if weather retrieval fails: hide the card, no
// popup, no error." Superseded by a real request (2026-08-07): show a friendly offline
// message in the card instead of hiding it outright. Still hidden before the very first
// refresh() attempt has finished (hasFetchedOnce), so there's no flash of "offline" on launch.
Card {
    id: root
    width: parent ? parent.width : implicitWidth
    visible: WeatherService.hasFetchedOnce
    height: visible ? implicitHeight : 0

    // A Loader, not a plain visible:false Column, because Card sizes itself off
    // contentItem.childrenRect - which includes invisible children too, so a hidden Column
    // would still reserve its full height behind the offline message. A Loader only ever
    // instantiates one of these two Components, so childrenRect only ever sees the one
    // that's actually showing.
    Loader {
        width: parent.width
        sourceComponent: WeatherService.available ? weatherContent : offlineMessage
    }

    Component {
        id: offlineMessage
        Row {
            width: parent.width
            spacing: Theme.spacingMedium
            Icon { glyph: Icons.weatherCloudy; size: 28; color: Theme.mutedText }
            Text {
                width: parent.width - 28 - Theme.spacingMedium
                text: qsTr("You're offline, go outside to check the weather!")
                color: Theme.mutedText
                font.pixelSize: 13
                wrapMode: Text.WordWrap
                anchors.verticalCenter: parent.verticalCenter
            }
        }
    }

    Component {
        id: weatherContent
        Column {
            width: parent.width
            spacing: Theme.spacingMedium

            Row {
                width: parent.width
                spacing: Theme.spacingMedium

                Icon { glyph: WeatherViewModel.currentIcon; size: 40; color: Theme.primary }

                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Text {
                        visible: WeatherService.placeName.length > 0
                        text: WeatherService.placeName
                        color: Theme.mutedText
                        font.pixelSize: 12
                    }
                    Text {
                        text: qsTr("%1°").arg(Math.round(WeatherService.currentTemperature))
                        font.pixelSize: 24
                        font.bold: true
                        color: Theme.text
                    }
                    Text {
                        text: WeatherViewModel.currentLabel
                        color: Theme.mutedText
                        font.pixelSize: 13
                    }
                }

                Item { width: 1; height: 1 }  // spacer before the wind/high/low column

                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Text {
                        text: qsTr("Wind %1 km/h").arg(Math.round(WeatherService.windSpeed))
                        color: Theme.mutedText
                        font.pixelSize: 12
                    }
                    Text {
                        text: qsTr("H:%1°  L:%2°")
                            .arg(Math.round(WeatherService.todayHigh))
                            .arg(Math.round(WeatherService.todayLow))
                        color: Theme.mutedText
                        font.pixelSize: 12
                    }
                }
            }

            Row {
                width: parent.width
                spacing: Theme.spacingLarge

                Repeater {
                    model: WeatherService.forecast
                    delegate: Column {
                        spacing: 4
                        Text {
                            text: WeatherViewModel.dayLabel(modelData.date, index)
                            color: Theme.mutedText
                            font.pixelSize: 12
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                        Icon {
                            glyph: WeatherViewModel.iconFor(modelData.code)
                            size: 22
                            color: Theme.text
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                        Text {
                            text: qsTr("%1°/%2°")
                                .arg(Math.round(modelData.high))
                                .arg(Math.round(modelData.low))
                            color: Theme.text
                            font.pixelSize: 12
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                    }
                }
            }
        }
    }
}
