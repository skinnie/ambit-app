import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Linking } from 'react-native';
import { shareFile, saveToDownloads } from '../native/AmbitUsbModule';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { uploadGpxToLivelox, isAuthenticated, getAuthorizationUrl } from '../services/ApiLivelox';
import { uploadGpxToStrava, isAuthenticated as stravaIsAuthenticated } from '../services/ApiStrava';
import { getRunalyzeApiKey, uploadFitToRunalyze } from '../services/ApiRunalyze';
import { getIntervalsIcuCredentials, uploadFitToIntervalsIcu } from '../services/ApiIntervalsIcu';
import { generateFitFile } from '../services/FitExport';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { readGpxFile } from '../services/GpxService';
import { parseTrackPoints, computeElevationStats, TrackPoint } from '../services/GpxParser';
import ElevationChart from '../components/ElevationChart';
import { t } from '../i18n';
import { useV3Theme } from '../theme/v3';

type Route = RouteProp<RootStackParamList, 'Map'>;
type Nav   = NativeStackNavigationProp<RootStackParamList, 'Map'>;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDurationMinSec(s: number) {
  if (isNaN(s) || s < 0) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mStr = m.toString().padStart(2, '0');
  const sStr = sec.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mStr}:${sStr}` : `${mStr}:${sStr}`;
}

function formatSpeed(duration_s: number, distance_m: number) {
  if (!duration_s || !distance_m) return '-- km/h';
  return `${((distance_m / 1000) / (duration_s / 3600)).toFixed(1)} km/h`;
}

function formatPace(duration_s: number, distance_m: number) {
  if (!duration_s || distance_m < 10) return '--\'--"/km';
  const paceDecimal = (duration_s / 60) / (distance_m / 1000);
  let paceMin = Math.floor(paceDecimal);
  let paceSec = Math.round((paceDecimal - paceMin) * 60);
  if (paceSec === 60) {
    paceMin += 1;
    paceSec = 0;
  }
  return `${paceMin}'${paceSec.toString().padStart(2, '0')}"/km`;
}

function formatDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// ─── Carte Leaflet ────────────────────────────────────────────────────────────

function buildLeafletHtml(): string {
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

  // Real, 2026-08-09 ("can we have the same map providers as desktop") - IGN stays the
  // default (accurate, France-only, already proven here) and OSM/CyclOSM are added as real
  // switchable alternatives, same tile hosts and same attribution text as desktop's own
  // qml/MapService.qml. Desktop couldn't offer IGN itself (its own MapService.qml explains
  // why: a plain native XYZ tile renderer, and IGN's WMTS addressing doesn't fit that
  // mechanism) - Leaflet has no such limit, so Android can offer all three.
  var ign = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png' +
    '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { maxZoom: 18, attribution: '© IGN Géoplateforme' }
  ).addTo(map);
  var osm = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
  );
  var cyclosm = L.tileLayer(
    'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    { maxZoom: 20, attribution: '© OpenStreetMap contributors, CyclOSM' }
  );
  L.control.layers({
    'IGN (France)': ign,
    'OpenStreetMap': osm,
    'CyclOSM': cyclosm,
  }, null, { position: 'topright', collapsed: true }).addTo(map);

  var line = null;
  var startMarker = null;
  var endMarker = null;

  var dot = function(color) {
    return L.divIcon({ className: '',
      html: '<div style="width:14px;height:14px;background:' + color +
            ';border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
      iconAnchor: [7, 7] });
  };
  
  var playerIcon = L.divIcon({ className: '',
      html: '<div style="width:18px;height:18px;background:#3498db;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,.6);"></div>',
      iconAnchor: [9, 9] });

  window.Replay = {
    state: {
      playing: false,
      speed: 1,
      currentVal: 0,
      maxVal: 0,
      mode: 'time',
      lastTime: 0,
      lastTick: 0,
    },
    points: [],
    marker: null,

    init: function(payload) {
      window.Replay.points = payload.points;
      window.Replay.state.mode = payload.mode;
      window.Replay.state.maxVal = payload.maxVal;
      window.Replay.state.currentVal = 0;
      window.Replay.state.playing = false;

      var lls = window.Replay.points.map(function(p){ return [p.lat, p.lon]; });
      
      if (line) map.removeLayer(line);
      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);
      if (window.Replay.marker) map.removeLayer(window.Replay.marker);

      if (lls.length > 0) {
        line = L.polyline(lls, { color: '#ff2200', weight: 4, opacity: 0.9 }).addTo(map);
        startMarker = L.marker(lls[0], { icon: dot('#2ecc71') }).addTo(map);
        endMarker = L.marker(lls[lls.length - 1], { icon: dot('#e74c3c') }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [30, 30] });

        window.Replay.marker = L.marker(lls[0], { icon: playerIcon, zIndexOffset: 1000 }).addTo(map);
      }
    },

    play: function(speed) {
      if (window.Replay.state.currentVal >= window.Replay.state.maxVal) {
        window.Replay.state.currentVal = 0;
      }
      window.Replay.state.speed = speed;
      window.Replay.state.playing = true;
      window.Replay.state.lastTime = Date.now();
      requestAnimationFrame(window.Replay.loop);
    },

    pause: function() {
      window.Replay.state.playing = false;
    },

    setSpeed: function(speed) {
      window.Replay.state.speed = speed;
    },

    seek: function(val) {
      window.Replay.state.currentVal = Math.max(0, Math.min(val, window.Replay.state.maxVal));
      window.Replay.renderCurrent();
    },

    loop: function() {
      if (!window.Replay.state.playing) return;
      
      var now = Date.now();
      var dt = (now - window.Replay.state.lastTime) / 1000;
      window.Replay.state.lastTime = now;
      
      window.Replay.state.currentVal += (dt * window.Replay.state.speed);
      
      if (window.Replay.state.currentVal >= window.Replay.state.maxVal) {
         window.Replay.state.currentVal = window.Replay.state.maxVal;
         window.Replay.renderCurrent();
         window.Replay.pause();
         window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'REPLAY_END' }));
         return;
      }
      
      window.Replay.renderCurrent();
      
      // Tick to RN (~10 FPS max)
      if (now - window.Replay.state.lastTick > 100) {
         window.Replay.state.lastTick = now;
         window.ReactNativeWebView.postMessage(JSON.stringify({ 
           type: 'REPLAY_TICK', 
           payload: { val: window.Replay.state.currentVal, dist: window.Replay.state.currentDist } 
         }));
      }
      
      requestAnimationFrame(window.Replay.loop);
    },

    renderCurrent: function() {
      var pts = window.Replay.points;
      if (pts.length < 2) return;
      
      var val = window.Replay.state.currentVal;
      var mode = window.Replay.state.mode;
      
      // Binary search
      var low = 0, high = pts.length - 1;
      while (low <= high) {
        var mid = (low + high) >> 1;
        var mVal = mode === 'time' ? pts[mid].t : pts[mid].d;
        if (mVal < val) low = mid + 1;
        else if (mVal > val) high = mid - 1;
        else { low = mid; break; }
      }
      
      var idx = Math.max(0, Math.min(low, pts.length - 1));
      
      var p1 = pts[idx > 0 ? idx - 1 : 0];
      var p2 = pts[idx];
      var v1 = mode === 'time' ? p1.t : p1.d;
      var v2 = mode === 'time' ? p2.t : p2.d;
      
      var ratio = (v2 > v1) ? (val - v1) / (v2 - v1) : 0;
      var lat = p1.lat + (p2.lat - p1.lat) * ratio;
      var lon = p1.lon + (p2.lon - p1.lon) * ratio;
      
      // Store currentDistance for RN
      window.Replay.state.currentDist = p1.d + (p2.d - p1.d) * ratio;
      
      var newPos = [lat, lon];
      window.Replay.marker.setLatLng(newPos);
      
      if (!map.getBounds().pad(-0.1).contains(newPos)) {
        map.panTo(newPos, { animate: true, duration: 0.5 });
      }
    }
  };
</script>
</body></html>`;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const route      = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { activity } = route.params;

  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── Replay State
  const webViewRef = useRef<WebView>(null);
  const isScrubbingRef = useRef(false);
  const lastSeekTimeRef = useRef(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [currentReplayVal, setCurrentReplayVal] = useState(0);
  const [currentReplayDist, setCurrentReplayDist] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const leafletHtml = useMemo(() => buildLeafletHtml(), []);

  useEffect(() => {
    readGpxFile(activity.gpx_path)
      .then(xml => setPoints(parseTrackPoints(xml)))
      .catch(e => Alert.alert(t.error, t.readError + e?.message))
      .finally(() => setLoading(false));
  }, [activity.gpx_path]);

  const stats = useMemo(() => computeElevationStats(points), [points]);

  // Determine mode (time vs distance) based on whether timestamps exist
  const replayMode = useMemo(() => {
    if (points.length < 2) return 'time';
    return points[points.length - 1].cumTime > 0 ? 'time' : 'distance';
  }, [points]);

  const maxReplayVal = replayMode === 'time' ? activity.duration_s : stats.totalDistance;

  // Initialize Replay when WebView is ready
  useEffect(() => {
    if (isReady && points.length > 0) {
      const lightweightPoints = points.map(p => ({
        lat: p.latitude,
        lon: p.longitude,
        t: p.cumTime,
        d: p.cumDist,
      }));
      const payload = {
        points: lightweightPoints,
        mode: replayMode,
        maxVal: maxReplayVal,
      };
      webViewRef.current?.injectJavaScript(`window.Replay.init(${JSON.stringify(payload)}); true;`);
    }
  }, [isReady, points, replayMode, maxReplayVal]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      webViewRef.current?.injectJavaScript(`window.Replay.pause(); true;`);
    } else {
      setIsPlaying(true);
      webViewRef.current?.injectJavaScript(`window.Replay.play(${replaySpeed}); true;`);
    }
  };

  const cycleSpeed = () => {
    const nextSpeed = replaySpeed === 1 ? 10 : replaySpeed === 10 ? 60 : replaySpeed === 60 ? 120 : 1;
    setReplaySpeed(nextSpeed);
    if (isPlaying) {
      webViewRef.current?.injectJavaScript(`window.Replay.setSpeed(${nextSpeed}); true;`);
    }
  };

  const seekRelative = (delta: number) => {
    let d = delta;
    if (replayMode === 'distance') {
      if (activity.duration_s > 0) {
        const avgSpeedMps = stats.totalDistance / activity.duration_s;
        d = delta * avgSpeedMps;
      } else {
        d = (stats.totalDistance * 0.02) * Math.sign(delta);
      }
    }
    const newVal = Math.max(0, Math.min(currentReplayVal + d, maxReplayVal));
    setCurrentReplayVal(newVal);
    webViewRef.current?.injectJavaScript(`window.Replay.seek(${newVal}); true;`);
  };

  const onWebViewLoad = () => {
    setIsReady(true);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'REPLAY_TICK') {
        if (!isScrubbingRef.current) {
          setCurrentReplayVal(data.payload.val);
          setCurrentReplayDist(data.payload.dist ?? data.payload.val);
        }
      } else if (data.type === 'REPLAY_END') {
        setIsPlaying(false);
        setCurrentReplayVal(maxReplayVal);
        setCurrentReplayDist(stats.totalDistance);
      }
    } catch (e) {}
  };

  const onChartScrub = (progress: number) => {
    isScrubbingRef.current = true;
    if (isPlaying) {
      setIsPlaying(false);
      webViewRef.current?.injectJavaScript(`window.Replay.pause(); true;`);
    }
    
    // progress is distance-based because the chart is distance-based
    const targetDist = progress * stats.totalDistance;
    setCurrentReplayDist(targetDist);
    
    // convert targetDist back to targetTime if in time mode
    let targetVal = targetDist;
    if (replayMode === 'time') {
      // Find point matching targetDist to extract time
      const ptIdx = points.findIndex(p => p.cumDist >= targetDist);
      if (ptIdx >= 0) {
        targetVal = points[ptIdx].cumTime;
      } else {
        targetVal = activity.duration_s;
      }
    }
    setCurrentReplayVal(targetVal);

    const now = Date.now();
    if (now - lastSeekTimeRef.current > 50) {
      lastSeekTimeRef.current = now;
      webViewRef.current?.injectJavaScript(`window.Replay.seek(${targetVal}); true;`);
    }
  };

  const onChartScrubEnd = () => {
    isScrubbingRef.current = false;
    webViewRef.current?.injectJavaScript(`window.Replay.seek(${currentReplayVal}); true;`);
  };

  // ─── Exports ───

  async function handleExportLivelox() {
    setShowExportMenu(false);
    try {
      const auth = await isAuthenticated();
      if (!auth) {
        const url = await getAuthorizationUrl();
        Alert.alert(
          t.liveloxTitle,
          t.liveloxMsg,
          [
            { text: t.cancel, style: 'cancel' },
            { text: t.connect, onPress: () => Linking.openURL(url) },
          ]
        );
        return;
      }
      setExporting(true);
      try {
        const result = await uploadGpxToLivelox(activity.gpx_path);
        Alert.alert(
          'Livelox',
          `${t.liveloxSuccess}\n\n${result.viewerUrl}`,
          [
            { text: t.close, style: 'cancel' },
            { text: t.viewOnLivelox, onPress: () => Linking.openURL(result.viewerUrl) },
          ]
        );
      } catch (e: any) {
        Alert.alert(t.liveloxError, e?.message ?? String(e));
      } finally {
        setExporting(false);
      }
    } catch (e: any) {
      Alert.alert(t.liveloxError, e?.message ?? String(e));
    }
  }

  async function handleUploadRunalyze() {
    setShowExportMenu(false);
    const apiKey = await getRunalyzeApiKey();
    if (!apiKey) {
      Alert.alert(
        t.noApiKey,
        t.noApiKeyMsg,
        [
          { text: t.cancel, style: 'cancel' },
          { text: t.settings, onPress: () => navigation.navigate('Settings') },
        ]
      );
      return;
    }
    setExporting(true);
    try {
      const fitPath = await generateFitFile(activity.gpx_path, activity);
      const result  = await uploadFitToRunalyze(fitPath, apiKey);
      Alert.alert('Runalyze ✓', t.runalyzeOk(result.activityId));
    } catch (e: any) {
      Alert.alert(t.runalyzeError, e?.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleUploadIntervals() {
    setShowExportMenu(false);
    const creds = await getIntervalsIcuCredentials();
    if (!creds) {
      Alert.alert(
        t.noCreds,
        t.noCredsMsg,
        [
          { text: t.cancel, style: 'cancel' },
          { text: t.settings, onPress: () => navigation.navigate('Settings') },
        ]
      );
      return;
    }
    setExporting(true);
    try {
      const fitPath = await generateFitFile(activity.gpx_path, activity);
      const result  = await uploadFitToIntervalsIcu(fitPath, creds.athleteId, creds.apiKey);
      Alert.alert(
        'Intervals.icu ✓',
        t.intervalsSuccess,
        [
          { text: t.close, style: 'cancel' },
          { text: t.viewOnIntervals, onPress: () => Linking.openURL(result.viewerUrl) },
        ]
      );
    } catch (e: any) {
      Alert.alert(t.intervalsError, e?.message ?? String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleUploadStrava() {
    setShowExportMenu(false);
    try {
      const auth = await stravaIsAuthenticated();
      if (!auth) {
        Alert.alert(
          'Strava',
          t.stravaNotConnected,
          [
            { text: t.cancel, style: 'cancel' },
            { text: t.settings, onPress: () => navigation.navigate('Settings') },
          ]
        );
        return;
      }
      setExporting(true);
      try {
        const result = await uploadGpxToStrava(
          activity.gpx_path,
          activity.id,
          activity.activity_type,
        );
        Alert.alert(
          'Strava',
          t.stravaSuccess,
          [
            { text: t.close, style: 'cancel' },
            { text: t.viewOnStrava, onPress: () => Linking.openURL(result.stravaUrl) },
          ]
        );
      } catch (e: any) {
        Alert.alert(t.stravaError, e?.message ?? String(e));
      } finally {
        setExporting(false);
      }
    } catch (e: any) {
      Alert.alert(t.stravaError, e?.message ?? String(e));
    }
  }

  async function handleShareGpx() {
    setShowExportMenu(false);
    try {
      await shareFile(activity.gpx_path);
    } catch (e: any) {
      Alert.alert(t.error, t.shareError + e?.message);
    }
  }

  async function handleSaveToDownloads() {
    setShowExportMenu(false);
    try {
      const fileName = activity.gpx_path.split('/').pop() ?? `${activity.id}.gpx`;
      await saveToDownloads(activity.gpx_path, fileName);
      Alert.alert(t.savedOk, t.savedMsg(fileName));
    } catch (e: any) {
      Alert.alert(t.error, t.saveError + e?.message);
    }
  }

  async function handleShareFit() {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const fitPath = await generateFitFile(activity.gpx_path, activity);
      await shareFile(fitPath, 'application/vnd.ant.fit');
    } catch (e: any) {
      Alert.alert(t.error, t.shareError + e?.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveFitToDownloads() {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const fitPath  = await generateFitFile(activity.gpx_path, activity);
      const fileName = fitPath.split('/').pop() ?? `${activity.id}.fit`;
      await saveToDownloads(fitPath, fileName, 'application/vnd.ant.fit');
      Alert.alert(t.savedOk, t.savedMsg(fileName));
    } catch (e: any) {
      Alert.alert(t.error, t.saveError + e?.message);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={styles.loadingText}>{t.loading}</Text>
      </View>
    );
  }

  if (points.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{t.noGps}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Carte Leaflet ── */}
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: leafletHtml }}
        originWhitelist={['about:', 'data:']}
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        // Real, 2026-08-09 - same real requirement desktop's own main.cpp comment documents:
        // tile.openstreetmap.org's usage policy (operations.osmfoundation.org/policies/tiles/)
        // requires a real, identifying User-Agent on every tile request, or it gets treated as
        // bulk/anonymous traffic. WebView's default sends a generic Android/Chrome UA with no
        // way to single out just the tile requests, so this sets it for the whole page load.
        userAgent="AmbitApp/2.0"
        onLoad={onWebViewLoad}
        onMessage={onMessage}
      />

      {/* ── Infos overlay ── */}
      <View style={styles.overlay}>
        <View style={styles.statsRow}>
          <StatChip styles={styles} label={t.distance} value={formatDist(stats.totalDistance)} />
          <StatChip styles={styles} label={t.duration} value={formatDurationMinSec(activity.duration_s)} />
          <StatChip styles={styles} label={t.pace} value={formatPace(activity.duration_s, stats.totalDistance)} />
        </View>
        <View style={styles.statsRow}>
          <StatChip styles={styles} label="D+" value={`${stats.dPlus} m`} />
          <StatChip styles={styles} label="D-" value={`${stats.dMinus} m`} />
          <StatChip styles={styles} label={t.avgSpeed} value={formatSpeed(activity.duration_s, stats.totalDistance)} />
        </View>
      </View>

      {/* ── Bouton export flottant ── */}
      <TouchableOpacity
        style={[styles.exportFab, exporting && styles.btnDisabled]}
        onPress={() => setShowExportMenu(v => !v)}
        disabled={exporting}
      >
        <Text style={styles.exportFabText}>{exporting ? '…' : '⬆'}</Text>
      </TouchableOpacity>

      {/* ── Menu d'export ── */}
      {showExportMenu && (
        <View style={styles.exportMenu}>
          <ExportMenuItem styles={styles} label={t.shareGpx}       onPress={handleShareGpx} />
          <ExportMenuItem styles={styles} label={t.saveDownloads}  onPress={handleSaveToDownloads} />
          <ExportMenuItem styles={styles} label={t.shareFit}       onPress={handleShareFit} />
          <ExportMenuItem styles={styles} label={t.saveFitDownloads} onPress={handleSaveFitToDownloads} />
          <ExportMenuItem styles={styles} label={t.uploadRunalyze} onPress={handleUploadRunalyze} />
          <ExportMenuItem styles={styles} label={t.uploadIntervals} onPress={handleUploadIntervals} />
          <ExportMenuItem styles={styles} label={t.uploadLivelox}  onPress={handleExportLivelox} />
          <ExportMenuItem styles={styles} label={t.uploadStrava}   onPress={handleUploadStrava} />
        </View>
      )}

      {/* ── Barre de Replay ── */}
      <View style={styles.replayBar}>
        <Text style={styles.replayModeText}>{replayMode === 'time' ? t.replayTime : t.replayDist}</Text>
        
        <View style={styles.replayControls}>
          <TouchableOpacity onPress={() => seekRelative(-15)} style={styles.replayBtn}>
            <Text style={styles.replayIcon}>⏪</Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={togglePlay} style={styles.replayBtnMain}>
            <Text style={styles.replayIconMain}>{isPlaying ? '⏸' : '▶️'}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => seekRelative(15)} style={styles.replayBtn}>
            <Text style={styles.replayIcon}>⏩</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.replayRight}>
          <Text style={styles.replayTimeText}>
            {replayMode === 'time' 
              ? `${formatDurationMinSec(currentReplayVal)} / ${formatDurationMinSec(maxReplayVal)}`
              : `${formatDist(currentReplayVal)} / ${formatDist(maxReplayVal)}`}
          </Text>
          <TouchableOpacity onPress={cycleSpeed} style={styles.speedBtn}>
            <Text style={styles.speedText}>x{replaySpeed}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Profil altimétrique ── */}
      <ElevationChart 
        points={points} 
        stats={stats} 
        externalProgress={stats.totalDistance > 0 ? currentReplayDist / stats.totalDistance : 0}
        onScrub={onChartScrub}
        onScrubEnd={onChartScrubEnd}
      />
    </View>
  );
}

// ─── Helpers Components ───────────────────────────────────────────────────────

function ExportMenuItem({ styles, label, onPress }: { styles: ReturnType<typeof createStyles>; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.exportItem} onPress={onPress}>
      <Text style={styles.exportItemText}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatChip({ styles, label, value }: { styles: ReturnType<typeof createStyles>; label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles(t: ReturnType<typeof useV3Theme>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    map: { flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background },
    loadingText: { color: t.mutedText, marginTop: 12 },
    errorText: { color: t.error, fontSize: 15 },
    overlay: {
      position: 'absolute',
      top: 12,
      left: 12,
      right: 12,
      backgroundColor: t.card,
      borderColor: t.mutedText + '33',
      borderWidth: 1,
      borderRadius: 14,
      paddingVertical: 8,
      paddingHorizontal: 8,
      gap: 8,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    chip: { alignItems: 'center', flex: 1 },
    chipLabel: { fontSize: 10, color: t.mutedText, marginBottom: 2 },
    chipValue: { fontSize: 13, fontWeight: '700', color: t.text },
    exportFab: {
      position: 'absolute',
      bottom: 188,
      right: 16,
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.card,
      borderColor: t.mutedText + '33',
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDisabled: { opacity: 0.5 },
    exportFabText: { fontSize: 20, color: t.text },
    exportMenu: {
      position: 'absolute',
      bottom: 244,
      right: 16,
      backgroundColor: t.card,
      borderColor: t.mutedText + '33',
      borderWidth: 1,
      borderRadius: 14,
      overflow: 'hidden',
      minWidth: 200,
    },
    exportItem: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: t.mutedText + '33',
    },
    exportItemText: { color: t.text, fontSize: 14 },

    // Replay bar
    replayBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.card,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: t.mutedText + '33',
    },
    replayModeText: {
      fontSize: 10,
      color: t.mutedText,
      width: 50,
    },
    replayControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    replayBtn: {
      padding: 8,
    },
    replayBtnMain: {
      padding: 8,
      backgroundColor: t.card,
      borderRadius: 20,
    },
    replayIcon: { fontSize: 16, color: t.text },
    replayIconMain: { fontSize: 20, color: t.text },
    replayRight: {
      alignItems: 'flex-end',
      width: 80,
    },
    replayTimeText: {
      color: t.text,
      fontSize: 10,
      fontWeight: '600',
    },
    speedBtn: {
      marginTop: 4,
      backgroundColor: t.card,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    speedText: {
      color: t.text,
      fontSize: 10,
      fontWeight: 'bold',
    },
  });
}
