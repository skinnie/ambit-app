import QtQuick
import AmbitApp

// Step 6, rebuilt 2026-08-07. Originally QtLocation's real MapView + a plugin (first
// maplibre-native-qt, then Qt's built-in "osm" plugin) - both abandoned after real hardware
// testing: maplibre-native-qt crashed outright (std::bad_alloc, reproducible even under
// forced software OpenGL, so not a driver quirk), and Qt's "osm" plugin kept showing a
// "missing API key" watermark that two separate parameter-based fixes (osm.mapping.host,
// then double-checked against Qt's own current docs) failed to clear - `strings` on the
// actual installed plugin binary (libqtgeoservices_osm.so) found zero occurrences of any
// "osm.mapping.*" parameter name at all, meaning this Qt 6.12 build's real configuration
// surface doesn't match what's documented, and guessing a third time wasn't worth it.
//
// This is a plain, direct XYZ slippy-tile renderer instead - no GeoServices plugin, no
// proxy, no undocumented configuration surface. Standard Web Mercator tile math, real and
// unremarkable (the same formula every slippy map uses). Every caller (route previews,
// activity maps, POI previews) keeps the exact same public API (latitude/longitude/
// zoomLevel/trackPoints/showMarker) - none of them needed to change for the tile renderer
// itself.
//
// Real request 2026-08-07 ("missing zoom +/-, improve track visibility, zoom in more by
// default so the trace is visible"): three real, related fixes, all here so every caller
// gets them at once rather than duplicating fit/zoom logic per page -
//   1. showZoomControls (opt-in - small thumbnails don't want +/- buttons cluttering them)
//   2. the track polyline is drawn with a white halo underneath a high-contrast color,
//      not Theme.primary - that teal blends into OSM/CyclOSM's own parks-and-water palette
//   3. currentZoom auto-fits to the track's real bounding box when one exists, instead of
//      the caller's own averaged trackCenter() + a fixed guessed zoomLevel
Item {
    id: root

    property real latitude: 46.8
    property real longitude: 8.2   // Alps-ish default - genuinely arbitrary, real center
                                    // comes from whatever real content (a route, an
                                    // activity) each caller actually has to show
    property real zoomLevel: 12    // only used when there's no track to fit to
    property var trackPoints: []   // [{lat, lon}, ...] - draws a line if 2+ points given
    property bool showMarker: false  // draws a single pin at (latitude, longitude)
    property bool showZoomControls: false

    clip: true

    readonly property int tileSize: 256

    // The track's own bounding box, in degrees - null with fewer than 2 points (nothing to
    // fit to; falls back to latitude/longitude/zoomLevel as before).
    readonly property var _trackBounds: {
        if (!trackPoints || trackPoints.length < 2) return null
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
        for (const p of trackPoints) {
            minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat)
            minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon)
        }
        return { minLat, maxLat, minLon, maxLon }
    }

    readonly property real _centerLat:
        _trackBounds ? (_trackBounds.minLat + _trackBounds.maxLat) / 2 : latitude
    readonly property real _centerLon:
        _trackBounds ? (_trackBounds.minLon + _trackBounds.maxLon) / 2 : longitude

    // World-pixel span of a degree box at a given zoom - the same projection tileZ/
    // tilesPerSide/lonToWorldX/latToWorldY use below, parameterized so it can be tried at
    // several candidate zooms before one is picked (those can't be reused directly: they're
    // derived *from* the already-chosen zoom, and this runs before that choice is made).
    function _spanPxAt(z, bounds) {
        const tilesPerSide = Math.pow(2, z)
        const lonSpan = Math.max(0.00001, bounds.maxLon - bounds.minLon)
        const pxPerLon = tilesPerSide * tileSize / 360
        const mercAt = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
        const spanLatPx = Math.abs(mercAt(bounds.maxLat) - mercAt(bounds.minLat))
                           / (2 * Math.PI) * tilesPerSide * tileSize
        return { w: lonSpan * pxPerLon, h: spanLatPx }
    }

    // Auto-fit zoom: the highest zoom where the track's bbox (with real padding around it)
    // still fits inside this view. Only takes over when there's a real track and real size
    // to fit into - a thumbnail card and the large detail view naturally end up at
    // different zooms for the same track, which is correct (more screen space fits a
    // tighter view). Real request 2026-08-08 ("make the default zoom level enough so we
    // can see the full trace") - margin loosened twice (0.8 -> 0.65 -> 0.5, i.e. 50%
    // padding) after real eTrex hardware testing kept showing a real track still slightly
    // cropped - erring toward showing clearly more than the bare minimum by default.
    // Component.onCompleted now defers its first fit via Qt.callLater(): a real, standard
    // QML technique for "wait until this item's own layout pass (anchors.fill against a
    // parent whose own size may still be settling through a Card/Column chain) has actually
    // finished" - calling _refitZoom() synchronously here could still see a stale width on
    // a items several layout levels deep, which onWidthChanged then only partially
    // recovers from since it re-fits from whatever *that* stale width was, not a fully
    // resolved one.
    property int currentZoom: zoomLevel
    function _refitZoom() {
        if (!_trackBounds || width <= 0 || height <= 0) {
            currentZoom = zoomLevel
            return
        }
        const margin = 0.5
        let z = 18
        for (; z > 1; z--) {
            const span = _spanPxAt(z, _trackBounds)
            if (span.w <= width * margin && span.h <= height * margin) break
        }
        currentZoom = z
    }
    Component.onCompleted: Qt.callLater(_refitZoom)
    onTrackPointsChanged: Qt.callLater(_refitZoom)
    onWidthChanged: _refitZoom()
    onHeightChanged: _refitZoom()

    // NOT named "z" - that's Item's own built-in stacking-order property (FINAL, can't be
    // overridden) - this exact collision was a real, severe bug: it made this whole
    // component fail to load at all ("Cannot override FINAL property"), which is why every
    // page embedding a MapView (Activities, Routes, POIs) went white - found via the real
    // app log, 2026-08-07.
    readonly property int tileZ: Math.max(0, Math.min(19, Math.round(currentZoom)))
    readonly property real tilesPerSide: Math.pow(2, tileZ)

    // Standard Web Mercator projection - lon/lat to "world pixel" coordinates at this zoom
    // (i.e. pixel position if every tile at this zoom were laid out in one giant image).
    function lonToWorldX(lon) {
        return (lon + 180) / 360 * tilesPerSide * tileSize
    }
    function latToWorldY(lat) {
        const rad = lat * Math.PI / 180
        const merc = Math.log(Math.tan(rad) + 1 / Math.cos(rad))
        return (1 - merc / Math.PI) / 2 * tilesPerSide * tileSize
    }

    readonly property real originX: lonToWorldX(_centerLon) - width / 2
    readonly property real originY: latToWorldY(_centerLat) - height / 2

    Repeater {
        model: {
            if (root.width <= 0 || root.height <= 0) return []
            const minTx = Math.floor(root.originX / root.tileSize)
            const maxTx = Math.floor((root.originX + root.width) / root.tileSize)
            const minTy = Math.floor(root.originY / root.tileSize)
            const maxTy = Math.floor((root.originY + root.height) / root.tileSize)
            const tiles = []
            for (let tx = minTx; tx <= maxTx; tx++) {
                for (let ty = minTy; ty <= maxTy; ty++) {
                    if (tx >= 0 && ty >= 0 && tx < root.tilesPerSide && ty < root.tilesPerSide) {
                        tiles.push({ x: tx, y: ty })
                    }
                }
            }
            return tiles
        }
        delegate: Image {
            x: modelData.x * root.tileSize - root.originX
            y: modelData.y * root.tileSize - root.originY
            width: root.tileSize
            height: root.tileSize
            source: MapService.tileHost + root.tileZ + "/" + modelData.x + "/" + modelData.y + ".png"
            asynchronous: true
            cache: true
        }
    }

    // Track polyline - plain Canvas, not QtQuick.Shapes: a long-stable QML API, no risk of
    // the same kind of version-specific surprise that just cost two build cycles above.
    // Drawn twice on the same path (a white halo, then the real color on top) - a real
    // cartography technique, not decoration: a flat Theme.primary teal was found to blend
    // into OSM/CyclOSM's own parks-and-water palette, real bug reported 2026-08-07.
    Canvas {
        id: trackCanvas
        anchors.fill: parent
        visible: root.trackPoints.length > 1
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            if (root.trackPoints.length < 2) return
            ctx.lineJoin = "round"
            ctx.lineCap = "round"
            ctx.beginPath()
            for (let i = 0; i < root.trackPoints.length; i++) {
                const p = root.trackPoints[i]
                const px = root.lonToWorldX(p.lon) - root.originX
                const py = root.latToWorldY(p.lat) - root.originY
                if (i === 0) ctx.moveTo(px, py)
                else ctx.lineTo(px, py)
            }
            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
            ctx.lineWidth = 6
            ctx.stroke()
            // Theme.primary - real request 2026-08-08: "same green as Left buttons when
            // selected" (NavItem.qml's own selected-row color), for brand consistency with
            // the rest of the app. The white halo above still does the actual contrast work
            // against whatever's under it, same technique, just recolored.
            ctx.strokeStyle = Theme.primary
            ctx.lineWidth = 3.5
            ctx.stroke()
        }
        Connections {
            target: root
            function onTrackPointsChanged() { trackCanvas.requestPaint() }
            function onOriginXChanged() { trackCanvas.requestPaint() }
            function onOriginYChanged() { trackCanvas.requestPaint() }
            function onWidthChanged() { trackCanvas.requestPaint() }
            function onHeightChanged() { trackCanvas.requestPaint() }
        }
    }

    // Marker - always exactly centered, since every caller that sets showMarker also
    // centers the map on that same coordinate (POIs' Add form). Real request 2026-08-08
    // ("change the color of POI point to be more visible", then "same green as Left
    // buttons when selected") - a plain Theme.error glyph (red) could sit right on top of
    // OSM's own red/orange road cartography with almost no contrast; a white halo behind
    // Theme.primary (NavItem.qml's own selected-row color, for brand consistency) stays
    // visible over any tile color, not just some of them.
    Item {
        visible: root.showMarker
        width: 36
        height: 44
        x: root.width / 2 - width / 2
        y: root.height / 2 - height

        Rectangle {
            width: 30
            height: 30
            radius: 15
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 6
            color: "white"
            border.color: Theme.primary
            border.width: 2
        }
        Icon {
            glyph: Icons.pois
            size: 20
            color: Theme.primary
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 12
        }
    }

    // Real request 2026-08-07: "missing the zoom + and zoom -" - opt-in (showZoomControls)
    // since a small card thumbnail doesn't want two more tap targets on it.
    Column {
        visible: root.showZoomControls
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 8
        spacing: 4

        Rectangle {
            width: 28; height: 28; radius: 4
            color: "#CCFFFFFF"
            Text {
                anchors.centerIn: parent
                text: "+"
                font.pixelSize: 16
                font.bold: true
                color: "#333333"
            }
            TapHandler {
                onTapped: root.currentZoom = Math.min(19, root.currentZoom + 1)
            }
        }
        Rectangle {
            width: 28; height: 28; radius: 4
            color: "#CCFFFFFF"
            Text {
                anchors.centerIn: parent
                text: "−"
                font.pixelSize: 16
                font.bold: true
                color: "#333333"
            }
            TapHandler {
                onTapped: root.currentZoom = Math.max(1, root.currentZoom - 1)
            }
        }
    }

    // Required, not decorative - OpenStreetMap's (and CyclOSM's) tile usage policy expects
    // visible attribution on anything showing its tiles.
    Rectangle {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 4
        color: "#CCFFFFFF"
        radius: 3
        width: attributionText.implicitWidth + 8
        height: attributionText.implicitHeight + 4

        Text {
            id: attributionText
            anchors.centerIn: parent
            text: MapService.attribution
            font.pixelSize: 10
            color: "#333333"
        }
    }
}
