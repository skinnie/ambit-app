pragma Singleton
import QtQuick
import AmbitApp

QtObject {
    function formatDistance(meters) {
        return qsTr("%1 km").arg((meters / 1000).toFixed(1));
    }

    function trackCenter(track) {
        if (!track || track.length === 0) return null;
        let sumLat = 0, sumLon = 0;
        for (const p of track) { sumLat += p.lat; sumLon += p.lon; }
        return {lat: sumLat / track.length, lon: sumLon / track.length};
    }

    // Real, light version of "Search" (AMBITAPP_SPEC.md lists it under Routes' "Future") -
    // a plain client-side name filter over on-watch routes, the one field this project's
    // tooling actually gives back. Not a stand-in for real full-text search across more
    // fields - there are no more fields to search yet (see RouteService's own comment on
    // what write_nav.py's summary output does and doesn't include).
    function filterByName(routes, query) {
        if (!query) return routes;
        const q = query.toLowerCase();
        return routes.filter(r => (r.name || "").toLowerCase().includes(q));
    }
}
