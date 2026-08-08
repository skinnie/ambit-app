pragma Singleton
import QtQuick

// AMBITAPP_SPEC.md, "Maps": "Create a MapService abstraction... The UI must never care
// where tiles come from." MapView.qml (components/) is the only thing that reads this - a
// plain, direct XYZ slippy-tile renderer, no QtLocation/GeoServices plugin involved at all
// (see MapView.qml's own header comment for why that plugin was abandoned).
//
// Provider choice, real not fabricated: only two offered, both because they share the
// same standard {z}/{x}/{y}.png XYZ addressing this override mechanism needs. Esri World
// Topo uses a different scheme (z/y/x order, no file extension) that doesn't fit this
// mechanism - not offered rather than shipped broken. IGN was asked about too: same scheme
// mismatch (WMTS, not XYZ), on top of being France-only coverage - see HANDOFF.md's "Two
// real apps" note on why it isn't a fit for a worldwide default either way.
//
// Default is "cyclosm", not "osm" - real bug, 2026-08-07: tile.openstreetmap.org itself
// enforces a strict usage policy (operations.osmfoundation.org/policies/tiles/) and started
// returning its own "Access blocked" 418 image instead of tiles after this session's own
// heavy automated testing tripped it (compounded by main.cpp previously sending no
// User-Agent at all - now fixed, see main.cpp's TileNetworkAccessManager, but OSMF's block
// is typically IP-based and time-limited, so it may not clear immediately even with that
// fixed). CyclOSM's tile server (OSM France) was the one actually working throughout this
// same testing, so it's the safer default until OSM's own block lapses - "OpenStreetMap
// (standard)" is still one click away in Settings.
//
// Offline: not built yet - AMBITAPP_SPEC.md lists MBTiles as "future" explicitly.
QtObject {
    readonly property bool offlineAvailable: false  // MBTiles - future, per the spec

    // In-memory only for now - resets on restart. Real persistence (matching
    // ConnectionsService's QSettings pattern) is a small, real follow-up, not done here
    // since this is pure QML by design (see Theme.qml's own header comment on why - no
    // native state in these singletons).
    property string provider: "cyclosm"  // "osm" or "cyclosm"

    readonly property var _providers: ({
        osm: {
            host: "https://tile.openstreetmap.org/",
            attribution: "© OpenStreetMap contributors",
        },
        cyclosm: {
            host: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/",
            attribution: "© OpenStreetMap contributors, CyclOSM",
        },
    })

    readonly property string tileHost: _providers[provider].host
    readonly property string attribution: _providers[provider].attribution
}
