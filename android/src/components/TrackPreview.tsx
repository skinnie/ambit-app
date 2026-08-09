import React, { useCallback, useState } from 'react';
import { View, Image, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { useV3Theme } from '../theme/v3';
import { getMapProvider, MapProvider } from '../services/MapProviderService';
import { fitBoundsMosaic, centeredPointMosaic, tileUrl, TileMosaic } from '../services/MapTile';
import { t } from '../i18n';

// v3.0 UI port, revised 2026-08-10 ("apply the same fix as we did on the desktop, centering
// the gpx for POIs and Routes on the maps. for routes allow the cards to have different
// height to allow gpx to completely fit and show") - desktop's real fix (MapView.qml's own
// header comment) was fitting AND centering on the track's real bounding box, at whatever
// aspect ratio it actually has, instead of a fixed guessed zoom around an averaged center.
// The previous version here (bestSingleTile) picked whichever single fixed-size grid tile
// happened to contain every point - not centered, and cropped to a square regardless of the
// route's real shape. This uses MapTile.ts's own fitBoundsMosaic/centeredPointMosaic
// instead, stitching however many tiles the real bounding box needs.
//
// Two-phase render: the real display width isn't known until after the first layout pass
// (this box is always width:'100%' of whatever row/card it's in), so the first render is
// just a plain placeholder that measures itself; the real mosaic (which needs that width to
// pick a zoom/scale) renders on the next pass.
export function TrackPreview({
  points, height = 100, markerOnly = false, variableHeight = false,
}: {
  points: { lat: number; lon: number }[];
  height?: number;
  markerOnly?: boolean;
  // Real, 2026-08-10 ("for routes allow the cards to have different height to allow gpx to
  // completely fit and show") - default false: every other caller (POIs, activities) is a
  // uniform grid/list where a consistent cell size matters more than showing the shape at
  // 100% - RouteScreen's own on-watch list is the one real opt-in.
  variableHeight?: boolean;
}) {
  const theme = useV3Theme();
  const [provider, setProvider] = useState<MapProvider>('ign');
  // Real bug, found live (2026-08-10) - a plain useEffect([]) only fetches the persisted
  // provider once, on mount. React Navigation's native-stack keeps RouteScreen/PoiScreen
  // mounted in the background for back-navigation, so a TrackPreview that mounted before a
  // Settings change kept showing the OLD provider forever after - it never re-rendered to
  // notice. useFocusEffect re-checks every time the screen holding this component becomes
  // visible again, same pattern RouteScreen.tsx's own loadOnWatch() already uses.
  useFocusEffect(useCallback(() => { getMapProvider().then(setProvider); }, []));
  const [boxWidth, setBoxWidth] = useState<number | null>(null);

  // Real bug, found live (2026-08-10) - some real synced activities carry a garbage GPS fix
  // (an out-of-range or non-finite lat/lon - the watch's own GPS chip emitting a value
  // before it has a real lock). Math.tan()/Math.log() on an out-of-range latitude produces
  // Infinity/NaN, which silently poisons every tile position downstream with no crash and
  // no visible error - RN just renders nothing. Same "skip the bad one, don't throw" spirit
  // PoiService.ts's own SBEM entry parsing already uses for malformed watch data.
  const validPoints = points.filter(p =>
    Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
    Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180
  );

  const hasMultiPoint = !markerOnly && validPoints.length >= 2;
  const hasSinglePoint = (markerOnly || validPoints.length === 1) && validPoints.length >= 1;

  // Real, 2026-08-10 ("for data without gps data, please do a nice mappyish image saying no
  // data, soft color to not hurt the rest") - was a flat, empty box; a real placeholder now,
  // the same map-shaped visual language (rounded card, a faint terrain-line glyph) instead
  // of just nothing.
  if (!hasMultiPoint && !hasSinglePoint) {
    return (
      <View style={[styles.box, styles.noDataBox, { height, backgroundColor: theme.background }]}>
        <Svg width={30} height={30} viewBox="0 0 24 24">
          <Circle cx={17} cy={7} r={2.6} stroke={theme.mutedText} strokeWidth={1.3} fill="none" opacity={0.45} />
          <Polyline
            points="3,19 8,11 12,14 20,4" fill="none" stroke={theme.mutedText} strokeWidth={1.3}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.3}
          />
        </Svg>
        <Text style={[styles.noDataText, { color: theme.mutedText }]}>{t.trackPreviewNoData}</Text>
      </View>
    );
  }

  const onLayout = (e: LayoutChangeEvent) => {
    if (boxWidth === null) setBoxWidth(Math.round(e.nativeEvent.layout.width));
  };

  if (boxWidth === null) {
    return <View style={[styles.box, { height, backgroundColor: theme.background }]} onLayout={onLayout} />;
  }

  const mosaic: TileMosaic = hasSinglePoint
    ? centeredPointMosaic(validPoints[0].lat, validPoints[0].lon, boxWidth, height, 15)
    : fitBoundsMosaic(validPoints, boxWidth, variableHeight ? {} : { targetHeight: height });

  const projected = validPoints.map(p => mosaic.project(p.lat, p.lon));

  return (
    <View style={[styles.box, { height: mosaic.contentHeight, backgroundColor: theme.background }]}>
      {mosaic.tiles.map(tile => (
        <Image
          key={`${mosaic.z}-${tile.x}-${tile.y}`}
          source={{ uri: tileUrl(provider, mosaic.z, tile.x, tile.y) }}
          style={{ position: 'absolute', left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
        />
      ))}
      <Svg width={mosaic.contentWidth} height={mosaic.contentHeight} style={StyleSheet.absoluteFill}>
        {hasSinglePoint ? (
          <>
            <Circle cx={projected[0].x} cy={projected[0].y} r={16} fill={theme.primary} opacity={0.3} />
            <Circle cx={projected[0].x} cy={projected[0].y} r={9} fill={theme.primary} stroke="#ffffff" strokeWidth={2} />
          </>
        ) : (
          <>
            {/* White halo underneath for contrast - same real technique MapView.qml's own
                header comment documents ("that teal blends into OSM/CyclOSM's own
                parks-and-water palette"), needed even more here at thumbnail scale. */}
            <Polyline
              points={projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill="none" stroke="#ffffff" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round"
            />
            <Polyline
              points={projected.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill="none" stroke="#ff2200" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
            />
          </>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: 12, overflow: 'hidden' },
  noDataBox: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  noDataText: { fontSize: 11, fontWeight: '600' },
});
