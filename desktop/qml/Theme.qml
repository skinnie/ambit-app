pragma Singleton
import QtQuick
import Qt.labs.settings

// Every color used anywhere in the app comes from here - AMBITAPP_SPEC.md's own rule
// ("Never hardcode colors... Future themes should require zero UI changes"). The "future
// Settings -> theme control" this file's own comment anticipated is real now
// (SettingsPage.qml's own Appearance card) - it just sets `Theme.override` to
// "light"/"dark"/"system"; nothing else in the UI needed to change.
//
// Palette notes: teal primary/accent carried over from this project's other recent work
// (the packaging download page, the app icon - tools/packaging/make_icon.py) so AmbitApp has
// one consistent visual identity end to end, not a new color chosen in isolation here.
QtObject {
    id: root

    // Real, 2026-08-10 ("on desktop mode, put the menu on settings for dark mode/system") -
    // Qt.labs.settings persists this the same real way ConnectionsService.h's own QSettings
    // already persists credentials (same underlying mechanism, just declared in QML instead
    // of C++ - no new service class needed for one string). `override` is a plain alias
    // onto the persisted value, so every existing reader of Theme.override (isDark below,
    // and everything derived from it) picks up a saved choice automatically on next launch,
    // with no other file needing to know persistence is involved at all.
    property alias override: settingsId.themeOverride
    // Real, 2026-08-10 (verifying the Appearance card actually compiles, per its own
    // adjacent comment above) - two real issues here, found live: (1) QtObject has no
    // default property, so a bare `Settings { ... }` child (implicitly assigned to a
    // default property the way it would be under Item) failed with "Cannot assign to
    // non-existent default property" - fixed by declaring it as an explicit named
    // property instead of an implicit child. (2) `property alias X: settings.field` needs
    // a real `id:`, not just a property name - fixed by giving the nested object its own
    // id (settingsId) instead of relying on the property name (settingsObj) alone.
    property Settings settingsObj: Settings {
        id: settingsId
        category: "appearance"
        property string themeOverride: "system"
        // André, 2026-08-11 (item 16): "for activities, in settings let's add the option:
        // see as a map, see as a list." Persisted the same way the theme choice is, so the
        // app opens on whichever view he last used.
        property string activitiesView: "map"
        // André, 2026-08-16: the same independent map/list choice for Routes and POIs.
        property string routesView: "map"
        property string poisView: "map"
        // Configurable Activities list-view columns (André, 2026-08-16): a comma-separated
        // ordered list of metric keys (see ActivityMetrics.qml). Default matches the original
        // four fixed columns; the user adds/changes columns via the header dropdowns + "+".
        property string activityColumns: "distance,duration,ascent,calories"
    }

    // "map" (cards with a track thumbnail, the original) or "list" (rows, no maps).
    property alias activitiesView: settingsId.activitiesView
    property alias routesView: settingsId.routesView
    property alias poisView: settingsId.poisView
    property alias activityColumns: settingsId.activityColumns

    // Convenience: the column keys as a real array, and a setter that writes them back as CSV.
    function activityColumnList() {
        return activityColumns.length > 0 ? activityColumns.split(",") : []
    }
    function setActivityColumns(keys) {
        activityColumns = keys.join(",")
    }

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
    // Real, 2026-08-10 ("desktop version in dark mode still has the cyan color like the
    // android version had, can you use the same scheme of colors we did for the android
    // (grey)") - primary/accent were still the original teal (#57C9B3/#7CD6C4) this whole
    // palette's own header comment credits as this project's shared identity; Android's own
    // v3.ts moved off that same teal onto a slate grey deliberately (its own 2026-08-09
    // header comment: "why we have this cyano blue? ... change to a nicer grey" - a real,
    // explicit choice, not a bug). These two values are that same grey, so both platforms'
    // dark mode match again - light mode wasn't part of this request, left as-is.
    readonly property color _darkPrimary: "#9CA3AF"
    readonly property color _darkSecondary: "#9AA3AF"
    readonly property color _darkAccent: "#CBD5E1"
    readonly property color _darkSuccess: "#4CAF6D"
    readonly property color _darkWarning: "#E0A73B"
    readonly property color _darkError: "#E0655A"
    readonly property color _darkText: "#E9EBEE"
    // Real, 2026-08-11 (André, S2: "on dark mode, POIs and Routes are grey, we already fight
    // that on android app, we need a more visible color, without hurting the eyes"). Was
    // #9AA3AF. That measures 6.5:1 against the dark card, which passes on paper - but this
    // colour carries the CAPTION text (a route's "128.7 km · 852 points · ascent 530 m"),
    // and at that size antialiasing drags the rendered pixels down to about L=151, well
    // under what the number promises. Measured off a real dark-mode screenshot rather than
    // computed. #B4BDC9 lifts it to 8.7:1 and stays a soft grey-blue rather than white, so
    // nothing glares. The Android theme carries the SAME value (android/src/theme/v3.ts) -
    // changed in both, per his "we need to mutualize on android and here".
    readonly property color _darkMutedText: "#B4BDC9"

    readonly property color background: isDark ? _darkBackground : _lightBackground
    readonly property color card: isDark ? _darkCard : _lightCard
    readonly property color primary: isDark ? _darkPrimary : _lightPrimary

    // Ink drawn ON TOP OF MAP TILES - the track line and the POI markers. Deliberately NOT
    // theme-dependent: OSM/CyclOSM tiles are light whatever the app is set to, so following
    // the app theme meant the dark palette's primary (#9CA3AF, a grey) was being drawn on a
    // light map. André, 2026-08-11: "for routes, in dark mode track still grey, not visible,
    // use same green as light mode." The green is the light primary, so the two agree.
    readonly property color mapAccent: _lightPrimary
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

    // Real, 2026-08-09 ("Introdup proper type scale and migrate pages onto it") - font
    // sizes were hardcoded ad hoc across every page (a real grep found 10 distinct raw
    // pixelSize values, 10-24, with no shared scale anywhere), the same mistake the color/
    // spacing tokens above already exist to avoid. Each token here matches an existing size
    // exactly (not a new visual hierarchy) - this pass is about giving every page a shared
    // name to bind to instead of a bare number, not re-designing type sizes blind without a
    // way to see the result rendered.
    readonly property int fontSizeTiny: 10        // MapView's zoom-control glyphs
    readonly property int fontSizeCaption: 11     // timestamps, secondary annotations
    readonly property int fontSizeLabel: 12       // the most common size - stat labels, body
    readonly property int fontSizeBody: 13        // primary readable body text
    readonly property int fontSizeBodyLarge: 14   // card titles, emphasized body text
    readonly property int fontSizeSubtitle: 15
    readonly property int fontSizeHeading: 16     // section headings
    readonly property int fontSizeTitle: 18
    readonly property int fontSizeLargeTitle: 20
    readonly property int fontSizeDisplay: 24     // hero numbers (e.g. Home's battery %)
}
