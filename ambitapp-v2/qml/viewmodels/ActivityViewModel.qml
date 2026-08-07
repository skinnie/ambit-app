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

    function formatDistance(meters) {
        return qsTr("%1 km").arg((meters / 1000).toFixed(1));
    }

    function formatElevation(meters) {
        return qsTr("%1 m").arg(Math.round(meters));
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
