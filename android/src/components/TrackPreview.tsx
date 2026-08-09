import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useV3Theme } from '../theme/v3';

// v3.0 UI port (2026-08-09, "re do activities, routes, pois, backup to match entirely
// desktop") - desktop's RoutesPage.qml/PoisPage.qml show a real live MapView thumbnail per
// on-watch route/POI. Deliberately NOT ported as a live map here: ActivitiesPage.qml's own
// header comment documents a real, hardware-confirmed crash - "enough simultaneous map
// instances to crash the app outright" - from embedding one live map per card in a list,
// even with desktop's own lighter native GeoServices tile renderer. A phone embedding N
// WebView+Leaflet instances (MapScreen.tsx's own real map, CDN-loaded JS per instance) is
// the same risk on a more resource-constrained device. This is a plain SVG polyline instead
// - real track shape, normalized to its own bounding box, no tile background, no live
// WebView - reuses the same lightweight-vector approach WatchFacePreview.tsx/
// ElevationChart.tsx already use elsewhere in this app.
export function TrackPreview({
  points, height = 100, markerOnly = false,
}: { points: { lat: number; lon: number }[]; height?: number; markerOnly?: boolean }) {
  const t = useV3Theme();

  if (markerOnly || points.length < 2) {
    return (
      <View style={{ height, borderRadius: 12, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={28} height={28} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={7} fill={t.primary} opacity={0.25} />
          <Circle cx={12} cy={12} r={4} fill={t.primary} />
        </Svg>
      </View>
    );
  }

  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLon = Math.max(maxLon - minLon, 1e-6);
  const pad = 8;
  const w = 300;
  const h = height;
  const scale = Math.min((w - pad * 2) / spanLon, (h - pad * 2) / spanLat);
  const offX = (w - spanLon * scale) / 2;
  const offY = (h - spanLat * scale) / 2;
  const toXY = (p: { lat: number; lon: number }) => {
    const x = offX + (p.lon - minLon) * scale;
    // Screen Y grows downward, latitude grows upward - flip.
    const y = offY + (maxLat - p.lat) * scale;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const pointsStr = points.map(toXY).join(' ');

  return (
    <View style={{ height, borderRadius: 12, backgroundColor: t.background, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <Polyline points={pointsStr} fill="none" stroke={t.primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
