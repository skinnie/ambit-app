import QtQuick
import QtQuick.Effects
import AmbitApp

// The base surface every content card in the app builds on (Home's device card, activity
// cards, route/POI cards, etc.) - AMBITAPP_SPEC.md's Design Language: "Rounded cards, Subtle
// shadows." One implementation, so a future design tweak (radius, shadow strength) changes
// every card in the app at once, the same reasoning as Theme.qml for colors.
Rectangle {
    id: root

    // Children declared inside `Card { ... }` land here automatically, so this reads and
    // behaves like a normal container (Column, Row, etc.), not a special content property
    // callers have to remember to use.
    default property alias content: contentItem.data
    property int padding: Theme.spacingMedium

    radius: Theme.radiusCard
    color: Theme.card

    // contentItem is a plain Item, and a plain Item's implicitWidth/implicitHeight are always
    // 0 regardless of its children - unlike Column/Row, it doesn't compute implicit size from
    // content. Every card was collapsing to just `padding * 2` because of this, causing every
    // page's stacked cards to overlap (found via real screenshots, 2026-08-07 - see
    // V3_CHANGELOG.md). childrenRect does track the actual bounding rect of contentItem's
    // children (the Column/Row callers put inside), which is what was needed here.
    implicitWidth: contentItem.childrenRect.width + padding * 2
    implicitHeight: contentItem.childrenRect.height + padding * 2

    layer.enabled: true
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: Theme.isDark ? "#80000000" : "#33000000"
        shadowBlur: 0.5
        shadowVerticalOffset: 2
        shadowHorizontalOffset: 0
    }

    Item {
        id: contentItem
        anchors.fill: parent
        anchors.margins: root.padding
    }
}
