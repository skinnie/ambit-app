import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Dimensions } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Circle } from 'react-native-svg';
import { TrackPoint, ElevationStats } from '../services/GpxParser';

interface Props {
  points: TrackPoint[];
  stats: ElevationStats;
  externalProgress?: number; // 0 to 1
  onScrub?: (progress: number) => void;
  onScrubEnd?: () => void;
}

const CHART_HEIGHT = 120;
const PADDING = { top: 8, bottom: 24, left: 36, right: 8 };

export default function ElevationChart({ points, stats, externalProgress, onScrub, onScrubEnd }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const chartW = screenWidth - PADDING.left - PADDING.right;
  const chartH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const [cursorX, setCursorX] = useState<number | null>(null);

  // ── Calcul des distances cumulées ──────────────────────────────────────────
  const { distances, elevations } = useMemo(() => {
    const dist: number[] = [0];
    const elev: number[] = [points[0]?.elevation ?? 0];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      dist.push(dist[i - 1] + haversineM(prev.latitude, prev.longitude, curr.latitude, curr.longitude));
      elev.push(curr.elevation);
    }
    return { distances: dist, elevations: elev };
  }, [points]);

  const totalDist = distances[distances.length - 1] || 1;
  const elevMin = stats.altMin - 10;
  const elevMax = stats.altMax + 10;
  const elevRange = elevMax - elevMin || 1;

  // ── Convertit (distance, altitude) → coordonnées SVG ──────────────────────
  const toX = (d: number) => (d / totalDist) * chartW;
  const toY = (e: number) => chartH - ((e - elevMin) / elevRange) * chartH;

  // ── Chemin SVG du profil ───────────────────────────────────────────────────
  const pathD = useMemo(() => {
    if (distances.length === 0) return '';
    const pts = distances.map((d, i) => `${toX(d).toFixed(1)},${toY(elevations[i]).toFixed(1)}`);
    return `M${pts.join(' L')}`;
  }, [distances, elevations, chartW, chartH]);

  // ── Zone remplie sous la courbe ────────────────────────────────────────────
  const fillD = pathD
    ? `${pathD} L${toX(totalDist).toFixed(1)},${chartH} L0,${chartH} Z`
    : '';

  // ── PanResponder pour le curseur interactif ────────────────────────────────
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (_, gs) => {
      const x = Math.max(0, Math.min(gs.x0 - PADDING.left, chartW));
      setCursorX(x);
      onScrub?.(x / chartW);
    },
    onPanResponderMove: (_, gs) => {
      const x = Math.max(0, Math.min(gs.moveX - PADDING.left, chartW));
      setCursorX(x);
      onScrub?.(x / chartW);
    },
    onPanResponderRelease: () => {
      setCursorX(null);
      onScrubEnd?.();
    },
    onPanResponderTerminate: () => {
      setCursorX(null);
      onScrubEnd?.();
    },
  }), [chartW, onScrub, onScrubEnd]);

  // ── Point actif sous le curseur ────────────────────────────────────────────
  const activePoint = useMemo(() => {
    let effectiveCursorX = cursorX;
    if (cursorX === null && externalProgress !== undefined) {
      effectiveCursorX = externalProgress * chartW;
    }

    if (effectiveCursorX === null || distances.length === 0) return null;
    const targetDist = (effectiveCursorX / chartW) * totalDist;
    let idx = distances.findIndex(d => d >= targetDist);
    if (idx < 0) idx = distances.length - 1;
    return {
      x: toX(distances[idx]),
      y: toY(elevations[idx]),
      elevation: Math.round(elevations[idx]),
      dist: distances[idx],
    };
  }, [cursorX, distances, elevations, chartW, totalDist]);

  if (points.length < 2) return null;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* Légende D+ / D- */}
      <View style={styles.legend}>
        <Text style={styles.legendItem}>
          <Text style={styles.legendGreen}>▲{stats.dPlus} m</Text>
          {'  '}
          <Text style={styles.legendRed}>▼{stats.dMinus} m</Text>
          {'  '}
          <Text style={styles.legendGray}>{stats.altMin}–{stats.altMax} m</Text>
        </Text>
      </View>

      {/* Graphique SVG */}
      <Svg
        width={screenWidth}
        height={CHART_HEIGHT}
        style={styles.svg}
      >
        {/* Axes Y (alt min / max) */}
        <SvgText
          x={PADDING.left - 4}
          y={PADDING.top + 6}
          fill="#8899aa"
          fontSize={9}
          textAnchor="end"
        >
          {stats.altMax}
        </SvgText>
        <SvgText
          x={PADDING.left - 4}
          y={PADDING.top + chartH}
          fill="#8899aa"
          fontSize={9}
          textAnchor="end"
        >
          {stats.altMin}
        </SvgText>

        {/* Zone remplie */}
        <Path
          d={fillD}
          fill="rgba(231,76,60,0.15)"
          translateX={PADDING.left}
          translateY={PADDING.top}
        />

        {/* Courbe */}
        <Path
          d={pathD}
          stroke="#e74c3c"
          strokeWidth={2}
          fill="none"
          translateX={PADDING.left}
          translateY={PADDING.top}
        />

        {/* Curseur interactif */}
        {activePoint && (
          <>
            <Line
              x1={PADDING.left + activePoint.x}
              y1={PADDING.top}
              x2={PADDING.left + activePoint.x}
              y2={PADDING.top + chartH}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <Circle
              cx={PADDING.left + activePoint.x}
              cy={PADDING.top + activePoint.y}
              r={4}
              fill="#fff"
              stroke="#e74c3c"
              strokeWidth={2}
            />
            <SvgText
              x={Math.min(PADDING.left + activePoint.x + 6, screenWidth - 50)}
              y={PADDING.top + activePoint.y - 6}
              fill="#fff"
              fontSize={10}
              fontWeight="bold"
            >
              {activePoint.elevation} m
            </SvgText>
          </>
        )}

        {/* Axe X (distance) */}
        <SvgText
          x={PADDING.left}
          y={CHART_HEIGHT - 4}
          fill="#8899aa"
          fontSize={9}
        >
          0
        </SvgText>
        <SvgText
          x={PADDING.left + chartW - 4}
          y={CHART_HEIGHT - 4}
          fill="#8899aa"
          fontSize={9}
          textAnchor="end"
        >
          {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${Math.round(totalDist)} m`}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(22,33,62,0.95)',
    paddingTop: 4,
  },
  legend: {
    paddingHorizontal: PADDING.left,
    paddingBottom: 2,
  },
  legendItem: { fontSize: 11 },
  legendGreen: { color: '#4caf50', fontWeight: '600' },
  legendRed: { color: '#f44336', fontWeight: '600' },
  legendGray: { color: '#8899aa' },
  svg: {},
});
