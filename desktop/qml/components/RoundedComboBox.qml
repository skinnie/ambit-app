import QtQuick
import QtQuick.Controls
import AmbitApp

// A ComboBox with the app's rounded-corner look (André: "no square boxes! square with rounded
// corners"). The default QQC2 ComboBox draws a square, platform-styled control; this rounds the
// closed box and themes its text, and leaves the drop-down popup + item delegate as the working
// defaults (a custom delegate rendered blank items - the closed box was the square one anyway).
// Everything else (model, textRole, currentIndex, onActivated…) is the standard ComboBox API.
ComboBox {
    id: control
    implicitHeight: 34
    font.pixelSize: Theme.fontSizeBody

    background: Rectangle {
        radius: Theme.radiusSmall
        color: Theme.card
        border.width: 1
        border.color: control.activeFocus ? Theme.primary : Theme.mutedText
    }

    contentItem: Text {
        leftPadding: 10
        rightPadding: control.indicator ? control.indicator.width + 6 : 10
        text: control.displayText
        color: Theme.text
        font: control.font
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }
}
