import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { RouteProp, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { useV3Theme } from '../theme/v3';
import { getMapProvider, setMapProvider, MapProvider } from '../services/MapProviderService';
import { mapTileLayersJs } from '../services/MapHtml';

type Route = RouteProp<RootStackParamList, 'TrackMap'>;

// Real, 2026-08-09 ("the visualization of routes don't have map... but inside it works, so
// maybe replicate what's inside") - Routes/POIs only ever got TrackPreview.tsx's own plain
// SVG polyline (deliberately, to avoid the many-simultaneous-live-maps crash risk
// TrackPreview.tsx's own header comment documents for a *list* of thumbnails). This screen
// is the other half: a single, real Leaflet+tile map (the same real implementation
// MapScreen.tsx already proved works well), opened one at a time from a route/POI's own
// "View on map" button - no crash risk since only one ever exists on screen. No replay bar
// or elevation chart here (unlike MapScreen.tsx) - routes/POIs carry no time-series data to
// replay against, only a shape and a bounding box.
function buildTrackHtml(provider: MapProvider, points: { lat: number; lon: number }[]): string {
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>* { margin:0; padding:0; } html,body,#map { width:100%; height:100%; }</style>
</head><body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false });

  ${mapTileLayersJs(provider)}

  var dot = function(color) {
    return L.divIcon({ className: '',
      html: '<div style="width:14px;height:14px;background:' + color +
            ';border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
      iconAnchor: [7, 7] });
  };

  var pts = ${JSON.stringify(points)};
  if (pts.length > 1) {
    var lls = pts.map(function(p){ return [p.lat, p.lon]; });
    var line = L.polyline(lls, { color: '#ff2200', weight: 4, opacity: 0.9 }).addTo(map);
    L.marker(lls[0], { icon: dot('#2ecc71') }).addTo(map);
    L.marker(lls[lls.length - 1], { icon: dot('#e74c3c') }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  } else if (pts.length === 1) {
    var ll = [pts[0].lat, pts[0].lon];
    L.marker(ll, { icon: dot('#3498db') }).addTo(map);
    map.setView(ll, 15);
  }
</script>
</body></html>`;
}

export default function TrackMapScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const route = useRoute<Route>();
  const { points } = route.params;

  const [mapProvider, setMapProviderState] = useState<MapProvider>('ign');
  useEffect(() => { getMapProvider().then(setMapProviderState); }, []);

  const html = useMemo(() => buildTrackHtml(mapProvider, points), [mapProvider, points]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_PROVIDER_CHANGE') {
        setMapProviderState(data.provider);
        setMapProvider(data.provider);
      }
    } catch (e) {}
  };

  return (
    <View style={styles.container}>
      <WebView
        style={styles.map}
        source={{ html }}
        originWhitelist={['about:', 'data:']}
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        userAgent="AmbitApp/2.0"
        onMessage={onMessage}
      />
    </View>
  );
}

function createStyles(t: ReturnType<typeof useV3Theme>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    map: { flex: 1 },
  });
}
