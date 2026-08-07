pragma Singleton
import QtQuick

// AMBITAPP_SPEC.md, "Future Features": Sport Modes ships hidden until it's real. Any nav
// item/page gated on a flag here just needs `visible: FeatureFlags.sportModes` (or similar) -
// flipping the flag reveals it with no other change, "no redesign required later."
QtObject {
    property bool sportModes: false
}
