pragma Singleton
import QtQuick

// Sunrise/sunset for the weather card - 2026-08-11 designer pass (André: "we don't need
// another map. feel free to include fun feature / outdoorish be creative"). Sun times are
// the most watch-native fact there is: the Ambit itself ships sunrise/sunset app screens
// (the aap capture set literally has appstopscreensunrisunset), and "how much daylight is
// left" is the one number an outdoor person actually plans an outing around.
//
// Computed locally with NOAA's own solar equations (General Solar Position Calculations,
// NOAA Global Monitoring Division) - the same source everyone's sunrise tables trace back
// to. No network involved: the weather card already knows lat/lon, and the maths is exact
// enough (about a minute) that fetching it would be a round trip for nothing. Uses the
// official -0.833° zenith offset (refraction + solar radius), so these match published
// almanac times, not naive geometric ones.
QtObject {
    id: root

    // {sunrise: Date, sunset: Date} in local time for the given date at lat/lon, or null
    // in polar day/night where the sun never crosses the horizon.
    function timesFor(lat, lon, date) {
        const rad = Math.PI / 180
        const start = new Date(date.getFullYear(), 0, 0)
        const dayOfYear = Math.floor((date - start) / 86400000)

        // Fractional year, radians (NOAA eq. 1, at solar noon for a whole-day answer).
        const g = 2 * Math.PI / 365 * (dayOfYear - 1 + 0.5)

        // Equation of time, minutes (NOAA eq. 2), and solar declination, radians (eq. 3).
        const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
                                 - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
        const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
                   - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
                   - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)

        // Hour angle at the -0.833° zenith (eq. 4's 90.833°).
        const cosHa = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)))
                    - Math.tan(lat * rad) * Math.tan(decl)
        if (cosHa < -1 || cosHa > 1)
            return null  // midnight sun / polar night
        const haDeg = Math.acos(cosHa) / rad

        // Sunrise/sunset as minutes UTC (eq. 5/6), then into local Dates via the Date
        // constructor's own UTC handling - no hand-rolled timezone arithmetic.
        const sunriseUtcMin = 720 - 4 * (lon + haDeg) - eqtime
        const sunsetUtcMin = 720 - 4 * (lon - haDeg) - eqtime
        const dayUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
        return {
            sunrise: new Date(dayUtc + sunriseUtcMin * 60000),
            sunset: new Date(dayUtc + sunsetUtcMin * 60000),
        }
    }

    function _hm(ms) {
        const totalMin = Math.round(ms / 60000)
        const h = Math.floor(totalMin / 60)
        const m = totalMin % 60
        return h > 0 ? qsTr("%1h%2").arg(h).arg(m < 10 ? "0" + m : m) : qsTr("%1 min").arg(m)
    }

    // The whole strip as one sentence, phase-aware. Empty string when unavailable.
    function summary(lat, lon) {
        const now = new Date()
        const t = timesFor(lat, lon, now)
        if (t === null)
            return ""
        const fmt = d => Qt.formatTime(d, "HH:mm")
        if (now < t.sunrise)
            return qsTr("Sunrise %1 · Sunset %2 · daylight in %3")
                .arg(fmt(t.sunrise)).arg(fmt(t.sunset)).arg(_hm(t.sunrise - now))
        if (now < t.sunset)
            return qsTr("Sunrise %1 · Sunset %2 · %3 of daylight left")
                .arg(fmt(t.sunrise)).arg(fmt(t.sunset)).arg(_hm(t.sunset - now))
        // After sunset: tomorrow's sunrise (a day shifts it by under two minutes).
        const tomorrow = timesFor(lat, lon, new Date(now.getTime() + 86400000))
        return tomorrow
            ? qsTr("Sun is down · back at %1").arg(fmt(tomorrow.sunrise))
            : ""
    }
}
