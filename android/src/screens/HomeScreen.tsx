import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { runSync, SyncState } from '../services/SyncService';
import { t } from '../i18n';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;

// ─── Tracé GPS décoratif (SVG-like path via View) ────────────────────────────
// Points normalisés 0-1 représentant un parcours d'orientation stylisé
const TRACK_POINTS = [
  [0.12, 0.78], [0.28, 0.55], [0.20, 0.35], [0.42, 0.18],
  [0.65, 0.28], [0.55, 0.52], [0.78, 0.42], [0.85, 0.65],
];

function GpsTraceDecoration({ size = 120 }: { size?: number }) {
  const pts = TRACK_POINTS.map(([x, y]) => ({ x: x * size, y: y * size }));
  return (
    <View style={{ width: size, height: size }}>
      {pts.slice(0, -1).map((p, i) => {
        const next = pts[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y - 1,
              width: len,
              height: 2,
              backgroundColor: 'rgba(0,229,255,0.5)',
              transformOrigin: '0 50%',
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}
      {/* Marqueur départ */}
      <View style={[styles.dot, { left: pts[0].x - 4, top: pts[0].y - 4, backgroundColor: '#2ecc71' }]} />
      {/* Marqueur arrivée */}
      <View style={[styles.dot, { left: pts[pts.length - 1].x - 4, top: pts[pts.length - 1].y - 4, backgroundColor: '#e74c3c' }]} />
    </View>
  );
}

// ─── Anneau pulsant autour du bouton principal ────────────────────────────────
function PulseRing({ active, color }: { active: boolean; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.setValue(0);
    }
  }, [active]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacity = anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 0.3, 0] });

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        { borderColor: color, transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [sync, setSync] = useState<SyncState>({ phase: 'idle', current: 0, total: 0, newCount: 0 });

  async function handleSync() {
    if (sync.phase !== 'idle' && sync.phase !== 'done' && sync.phase !== 'error') return;
    try {
      await runSync(setSync);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setSync(s => ({ ...s, phase: 'error' }));
    }
  }

  const isBusy = sync.phase !== 'idle' && sync.phase !== 'done' && sync.phase !== 'error';

  const ringColor = sync.phase === 'error' ? '#f44336'
    : sync.phase === 'done' ? '#2ecc71'
    : '#00e5ff';

  const btnLabel = isBusy ? phaseLabel(sync.phase)
    : sync.phase === 'done' ? t.synced
    : sync.phase === 'error' ? t.retry
    : t.sync;

  return (
    <View style={styles.container}>

      {/* ── Tracé GPS en filigrane ── */}
      <View style={styles.traceWrapper} pointerEvents="none">
        <GpsTraceDecoration size={260} />
      </View>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appName}>OpenSportsSync</Text>
        <Text style={styles.deviceName}>Suunto Ambit</Text>
      </View>

      {/* ── Bouton circulaire central ── */}
      <View style={styles.center}>
        <PulseRing active={isBusy} color={ringColor} />
        <TouchableOpacity
          style={[styles.syncBtn, { borderColor: ringColor }, isBusy && styles.syncBtnBusy]}
          onPress={handleSync}
          disabled={isBusy}
          activeOpacity={0.8}
        >
          <Text style={[styles.syncBtnLabel, { color: ringColor }]}>{btnLabel}</Text>
          {sync.phase !== 'idle' && sync.total > 0 && (
            <Text style={styles.syncProgress}>{sync.current}/{sync.total}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Statut ── */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: ringColor }]} />
        <Text style={[styles.statusText, { color: ringColor }]}>
          {statusMessage(sync)}
        </Text>
      </View>

      {/* ── Bas de page : activités + paramètres ── */}
      <View style={styles.bottomRow}>
        <TouchableOpacity
          style={styles.activitiesBtn}
          onPress={() => navigation.navigate('LogList')}
          activeOpacity={0.8}
        >
          <Text style={styles.activitiesBtnText}>{t.viewActivities}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.8}
        >
          <Text style={styles.settingsBtnText}>⚙</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function phaseLabel(phase: SyncState['phase']): string {
  switch (phase) {
    case 'connecting': return t.conn;
    case 'fetching':   return t.read;
    case 'writing':    return t.save;
    default:           return '…';
  }
}

function statusMessage(sync: SyncState): string {
  switch (sync.phase) {
    case 'idle':       return t.idle;
    case 'connecting': return t.connecting;
    case 'fetching':   return t.fetching;
    case 'writing':    return t.writing;
    case 'done':       return t.done(sync.newCount);
    case 'error':      return sync.error ?? t.error;
    default:           return '';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CYAN = '#00e5ff';
const BTN_SIZE = 160;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 56,
    paddingHorizontal: 24,
  },
  traceWrapper: {
    position: 'absolute',
    top: '20%',
    left: '10%',
    opacity: 0.25,
  },
  header: {
    alignItems: 'center',
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1.5,
  },
  deviceName: {
    fontSize: 13,
    color: '#4a6fa5',
    letterSpacing: 2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    width: BTN_SIZE + 60,
    height: BTN_SIZE + 60,
  },
  pulseRing: {
    position: 'absolute',
    width: BTN_SIZE + 16,
    height: BTN_SIZE + 16,
    borderRadius: (BTN_SIZE + 16) / 2,
    borderWidth: 2,
  },
  syncBtn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,229,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnBusy: {
    backgroundColor: 'rgba(0,229,255,0.03)',
  },
  syncBtnLabel: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 3,
  },
  syncProgress: {
    fontSize: 12,
    color: '#8899aa',
    marginTop: 4,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  bottomRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    alignItems: 'center',
  },
  activitiesBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    backgroundColor: 'rgba(15,52,96,0.5)',
    alignItems: 'center',
  },
  activitiesBtnText: {
    color: '#8ab4d8',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  settingsBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    backgroundColor: 'rgba(15,52,96,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtnText: {
    fontSize: 22,
    color: '#00e5ff',
  },
  dot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
