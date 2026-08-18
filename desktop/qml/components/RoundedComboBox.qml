import QtQuick
import QtQuick.Controls
import AmbitApp

// A ComboBox with the app's rounded-corner look (André: "no square boxes! square with rounded
// corners"). The default QQC2 ComboBox draws a square, platform-styled control; this restyles
// the closed box and the drop-down popup to match RoundedButton / the cards. Everything else
// (model, textRole, currentIndex, onActivated…) is the standard ComboBox API.
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

    delegate: ItemDelegate {
        width: ListView.view ? ListView.view.width : control.width
        highlighted: control.highlightedIndex === index
        contentItem: Text {
            text: control.textRole ? (Array.isArray(control.model) ? modelData[control.textRole]
                                                                   : model[control.textRole])
                                   : modelData
            color: Theme.text
            font.pixelSize: Theme.fontSizeBody
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        background: Rectangle {
            radius: Theme.radiusSmall
            color: highlighted ? Qt.rgba(Theme.primary.r, Theme.primary.g, Theme.primary.b, 0.15)
                               : "transparent"
        }
    }

    popup: Popup {
        y: control.height + 2
        width: control.width
        implicitHeight: Math.min(contentItem.implicitHeight + 8, 280)
        padding: 4
        background: Rectangle {
            radius: Theme.radiusSmall
            color: Theme.card
            border.width: 1
            border.color: Theme.mutedText
        }
        contentItem: ListView {
            clip: true
            implicitHeight: contentHeight
            model: control.popup.visible ? control.delegateModel : null
            currentIndex: control.highlightedIndex
            ScrollIndicator.vertical: ScrollIndicator {}
        }
    }
}
