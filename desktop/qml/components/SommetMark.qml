import QtQuick

// Sommet "Peak" mark (direction 01, chosen 2026-08-14). A round device disc - echoing the
// Suunto Smart Sensor pod - carrying a teal summit peak with a light waypoint dot at its
// apex (the POI the app plants on a route). Sommet is French for "summit". Drawn on a plain
// Canvas (same approach as MapView's track polyline) so it needs no Qt SVG module and stays
// crisp at any size. Geometry is identical to the raster app icon
// (tools/packaging/make_desktop_app_icon.py) - both in a 120-unit reference box. Set `size`.
Item {
    id: root
    property int size: 48
    width: size
    height: size
    onSizeChanged: canvas.requestPaint()

    Canvas {
        id: canvas
        anchors.fill: parent
        antialiasing: true
        onPaint: {
            var ctx = getContext("2d");
            ctx.reset();
            var s = width / 120;
            ctx.scale(s, s);
            // pod disc
            ctx.fillStyle = "#0E1116";
            ctx.beginPath(); ctx.arc(60, 60, 57, 0, 2 * Math.PI); ctx.fill();
            // front peak
            ctx.fillStyle = "#2FA98C";
            ctx.beginPath();
            ctx.moveTo(40, 84); ctx.lineTo(72, 40); ctx.lineTo(94, 84); ctx.closePath();
            ctx.fill();
            // summit waypoint: dark ring cut into the peak, light centre
            ctx.fillStyle = "#0E1116";
            ctx.beginPath(); ctx.arc(72, 40, 6.6, 0, 2 * Math.PI); ctx.fill();
            ctx.fillStyle = "#E9EBEE";
            ctx.beginPath(); ctx.arc(72, 40, 3.1, 0, 2 * Math.PI); ctx.fill();
        }
    }
}
