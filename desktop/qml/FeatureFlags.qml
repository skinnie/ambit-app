pragma Singleton
import QtQuick

// AMBITAPP_SPEC.md, "Future Features": Sport Modes ships hidden until it's real. Any nav
// item/page gated on a flag here just needs `visible: FeatureFlags.sportModes` (or similar) -
// flipping the flag reveals it with no other change, "no redesign required later."
//
// Flipped to true 2026-08-08: CustomModes read/write is now real and hardware-confirmed
// (renaming a mode, Autolap/HR limits/pod search, display field content - see
// custom_modes_andre.md), same day the real SportModesPage.qml replaced the placeholder.
// Still Ambit3-only - not tested against Kailash's own CustomModes region at all (its
// memory map reports no CustomModes region, confirmed empty, per custom_modes_andre.md's
// own Kailash section), so this page assumes the Ambit3/Traverse family throughout.
QtObject {
    property bool sportModes: true
}
