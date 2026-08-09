import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useV3Theme } from '../theme/v3';
import { getMapProvider, MapProvider } from '../services/MapProviderService';
import { bestSingleTile, tileUrl, TILE_SIZE } from '../services/MapTile';

// v3.0 UI port, revised 2026-08-09 ("I would prefer an immediate map view on this side") -
// was a plain SVG polyline on a flat background, deliberately with no real map, to avoid
// this component instantiating N live WebView+Leaflet instances in a list (the real,
// hardware-confirmed crash risk desktop's own ActivitiesPage.qml documents for N
// simultaneous live map widgets - a WebView is a full browser-engine instance, N of them in
// a list is the same risk on a more resource-constrained phone).
//
// This version gets a real map background WITHOUT that risk: a single static XYZ tile
// <Image> per thumbnail (MapTile.ts's own header comment) - a normal cached image request,
// same real cost as any photo-grid thumbnail, not a browser engine instance. Desktop's own
// RoutesPage.qml/PoisPage.qml embed a live MapView per on-watch item with no virtualization
// at all - cheap there because MapView.qml is a plain in-process tile renderer with no
// browser engine; this is the closest RN equivalent of "cheap enough not to need
// virtualization."
//
// The polyline/marker is projected into the exact same tile's own pixel space
// (bestSingleTile's project()), and both the Image (resizeMode="cover") and the Svg
// (preserveAspectRatio="xMidYMid slice") use the same "cover" semantics, so they crop
// identically and the line lines up with the real map underneath regardless of the box's
// aspect ratio.
export function TrackPreview({
  points, height = 100, markerOnly = false,
}: { points: { lat: number; lon: number }[]; height?: number; markerOnly?: boolean }) {
  const t = useV3Theme();
  const [provider, setProvider] = useState<MapProvider>('ign');
  useEffect(() => { getMapProvider().then(setProvider); }, []);

  const hasTrack = !markerOnly && points.length >= 2;
  const hasPoint = markerOnly && points.length >= 1;

  if (!hasTrack && !hasPoint) {
    return <View style={[styles.box, { height, backgroundColor: t.background }]} />;
  }

  const tile = bestSingleTile(points, markerOnly ? 15 : 16);
  const uri = tileUrl(provider, tile.z, tile.x, tile.y);
  const projected = points.map(p => tile.project(p.lat, p.lon));

  return (
    <View style={[styles.box, { height, backgroundColor: t.background }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Svg
        width="100%" height="100%"
        viewBox={`0 0 ${TILE_SIZE} ${TILE_SIZE}`}
        preserveAspectRatio="xMidYMid slice"
        style={StyleSheet.absoluteFill}
      >
        {hasPoint ? (
          <>
            <Circle cx={projected[0].px} cy={projected[0].py} r={16} fill={t.primary} opacity={0.3} />
            <Circle cx={projected[0].px} cy={projected[0].py} r={9} fill={t.primary} stroke="#ffffff" strokeWidth={2} />
          </>
        ) : (
          <>
            {/* White halo underneath for contrast - same real technique MapView.qml's own
                header comment documents ("that teal blends into OSM/CyclOSM's own
                parks-and-water palette"), needed even more here at thumbnail scale. */}
            <Polyline
              points={projected.map(p => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')}
              fill="none" stroke="#ffffff" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round"
            />
            <Polyline
              points={projected.map(p => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')}
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
});
