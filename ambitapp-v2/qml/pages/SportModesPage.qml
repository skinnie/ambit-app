import QtQuick
import AmbitApp

// Hidden behind FeatureFlags.sportModes (false by default) - AMBITAPP_SPEC.md lists this
// under "Future Features," not yet implemented. Real backend status - what's proven vs. not
// - is tracked in ../../unresolved_questions_for_devs.md #1, not duplicated here.
PagePlaceholder {
    title: qsTr("Sport Modes")
    stepNote: qsTr("Not built yet - a future feature, kept behind FeatureFlags.sportModes " +
                    "so enabling it later needs no redesign.")
}
