pragma Singleton
import QtQuick
import AmbitApp

// Presentation logic for ActivityService's raw parsed fields - formatting, and picking a
// map preview center from a track. No sport-specific icon function here: ActivityService's
// own header comment explains why (sportTypeRaw is a real but never-decoded byte in this
// project's own tooling) - AmbitApp.Icons.activities is used for every entry instead of
// guessing a mapping that was never verified.
QtObject {
    function formatDuration(totalSeconds) {
        const s = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h > 0) return qsTr("%1h %2m").arg(h).arg(m);
        return qsTr("%1 min").arg(m);
    }

    // Distance and elevation follow the WATCH's unit setting, not a hardcoded metric
    // (André, 2026-08-11: "read the units system from the watch and make the app match
    // it"). The stored values stay SI - see WatchUnits.qml's own header for why the
    // conversion belongs at display time and nowhere else.
    function formatDistance(meters) {
        return WatchUnits.distance(meters);
    }

    function formatElevation(meters) {
        return WatchUnits.altitude(meters);
    }

    // kcal, straight off the watch. No unit choice exists for energy on this hardware -
    // see WatchUnits.qml. Returns "" for an activity that never recorded it (an older
    // cached GPX predates the field), so the UI can hide the figure rather than claim the
    // move cost nothing.
    function formatEnergy(kcal) {
        if (!kcal || kcal <= 0) return "";
        return WatchUnits.energy(kcal);
    }

    function formatDate(isoString) {
        if (!isoString) return qsTr("Unknown date");
        const d = new Date(isoString);
        return d.toLocaleDateString(Qt.locale(), Locale.ShortFormat);
    }

    // Track center for a map preview - a plain average, not a real bounding-box fit (good
    // enough for a small preview thumbnail; the detail view's large map may want a real
    // fit-to-bounds later, not needed yet).
    function trackCenter(track) {
        if (!track || track.length === 0) return null;
        let sumLat = 0, sumLon = 0;
        for (const p of track) { sumLat += p.lat; sumLon += p.lon; }
        return {lat: sumLat / track.length, lon: sumLon / track.length};
    }

    // HomePage's "Last Activity" card, real 2026-08-07 (was a placeholder before
    // ActivityService actually worked). Picks by max startTime rather than assuming
    // ActivityService.activities is already sorted - it isn't guaranteed to be, it's just
    // whatever order the watch's own exercise log walk returned. Returns null for an empty
    // list or one where every entry has an unparseable/missing startTime.
    function mostRecent(activities) {
        if (!activities || activities.length === 0) return null;
        let best = null, bestTime = -Infinity;
        for (const a of activities) {
            const t = a.startTime ? new Date(a.startTime).getTime() : NaN;
            if (!isNaN(t) && t > bestTime) { bestTime = t; best = a; }
        }
        return best;
    }
}
