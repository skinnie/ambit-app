pragma Singleton
import QtQuick

// Every color used anywhere in the app comes from here - AMBITAPP_SPEC.md's own rule
// ("Never hardcode colors... Future themes should require zero UI changes"). A future
// "Settings -> theme" control just needs to set `Theme.override` to "light"/"dark"/"system";
// nothing else in the UI should ever change.
//
// Palette notes: teal primary/accent carried over from this project's other recent work
// (the packaging download page, the app icon - tools/packaging/make_icon.py) so AmbitApp has
// one consistent visual identity end to end, not a new color chosen in isolation here.
QtObject {
    id: root

    // "system" follows Qt.styleHints.colorScheme; a Settings toggle can set "light"/"dark"
    // directly to override it, without any other file needing to know that happened.
    property string override: "system"

    readonly property bool isDark: {
        if (override === "light") return false;
        if (override === "dark") return true;
        return Qt.styleHints.colorScheme === Qt.Dark;
    }

    // --- Light palette ---
    readonly property color _lightBackground: "#F6F8F9"
    readonly property color _lightCard: "#FFFFFF"
    readonly property color _lightPrimary: "#167E6A"
    readonly property color _lightSecondary: "#5B6270"
    readonly property color _lightAccent: "#2FA98C"
    readonly property color _lightSuccess: "#1A7F37"
    readonly property color _lightWarning: "#946200"
    readonly property color _lightError: "#C0392B"
    readonly property color _lightText: "#1A1D22"
    readonly property color _lightMutedText: "#5B6270"

    // --- Dark palette --- (not a naive invert - contrast and the accent's own legibility
    // are each checked on this ground independently, per this project's own design practice)
    readonly property color _darkBackground: "#14171C"
    readonly property color _darkCard: "#1B1F27"
    readonly property color _darkPrimary: "#57C9B3"
    readonly property color _darkSecondary: "#9AA3AF"
    readonly property color _darkAccent: "#7CD6C4"
    readonly property color _darkSuccess: "#4CAF6D"
    readonly property color _darkWarning: "#E0A73B"
    readonly property color _darkError: "#E0655A"
    readonly property color _darkText: "#E9EBEE"
    readonly property color _darkMutedText: "#9AA3AF"

    readonly property color background: isDark ? _darkBackground : _lightBackground
    readonly property color card: isDark ? _darkCard : _lightCard
    readonly property color primary: isDark ? _darkPrimary : _lightPrimary
    readonly property color secondary: isDark ? _darkSecondary : _lightSecondary
    readonly property color accent: isDark ? _darkAccent : _lightAccent
    readonly property color success: isDark ? _darkSuccess : _lightSuccess
    readonly property color warning: isDark ? _darkWarning : _lightWarning
    readonly property color error: isDark ? _darkError : _lightError
    readonly property color text: isDark ? _darkText : _lightText
    readonly property color mutedText: isDark ? _darkMutedText : _lightMutedText

    // Shared spacing/radius scale - not in the spec's explicit token list, but "rounded
    // cards / subtle shadows / large whitespace" (Design Language) needs consistent numbers
    // somewhere, and hardcoding 8/12/16 separately in every component is the same mistake
    // as hardcoding colors.
    readonly property int radiusSmall: 8
    readonly property int radiusCard: 16
    readonly property int spacingSmall: 8
    readonly property int spacingMedium: 16
    readonly property int spacingLarge: 24
}
