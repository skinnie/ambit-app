import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { runSync, SyncState } from '../services/SyncService';
import { updateOrbitalData, OrbitalUpdateState } from '../services/SgeeService';
import {
  connect as ambitConnect, disconnect as ambitDisconnect, getDeviceInfo, AmbitDeviceInfo,
  wasLaunchedViaUsbAttach, onUsbAttached, detectAttachedDeviceType, AttachedDeviceType,
  readDeviceHistoryRaw,
} from '../native/AmbitUsbModule';
import * as Garmin from '../native/GarminModule';
import type { GarminConnectResult } from '../native/GarminModule';
import { syncGarminActivities, GarminActivitySyncState } from '../services/GarminActivityService';
import { kailashDeviceProvider } from '../services/devices/KailashDeviceProvider';
import { decodeDeviceHistory, KailashHistory } from '../services/KailashHistoryReader';
import { APP_VERSION } from '../config/version';
import { t } from '../i18n';

// Real, 2026-08-08: Kailash ("Hoopoe") answers the same USB init + 0x0000 device-info
// commands every Ambit/Traverse does (AmbitUsbModule.kt's SUUNTO_PID_NAMES/
// device_filter.xml both now include its real product ID) - detectAttachedDeviceType()
// already reports it as "ambit", no separate branch needed there. This is the one place
// that distinguishes it: everywhere below that would otherwise assume Ambit3's own
// ExerciseLog/sport-mode shape switches to the Kailash-specific path instead.
const isKailash = (info: AmbitDeviceInfo | null) => info?.model === 'Hoopoe';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>;
type ActiveAction = 'sync' | 'orbital';

// v2.3.2 beta — how the device area of Home progresses. 'searching'/'connecting'
// happen automatically (no manual "Connect" tap anymore, per André's spec: the
// OS's USB_DEVICE_ATTACHED intent-filter + device_filter.xml already launches/
// forefronts the app when something is plugged in — this state machine is what
// runs once that's happened, not a replacement for it).
type ConnPhase = 'searching' | 'connecting' | 'connected' | 'timeout' | 'later' | 'connect-error';

const SEARCH_POLL_MS = 1200;
const SEARCH_TIMEOUT_MS = 15000;

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

// ─── Anneau pulsant autour d'un bouton ────────────────────────────────────────
function PulseRing({ active, color, size }: { active: boolean; color: string; size: number }) {
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
        { width: size + 16, height: size + 16, borderRadius: (size + 16) / 2,
          borderColor: color, transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ─── Bouton d'action circulaire (SYNC / GPS / ROUTE / POI) ───────────────────
function ActionButton({
  label, progress, active, color, onPress, disabled,
}: {
  label: string; progress?: string; active: boolean; color: string;
  onPress: () => void; disabled: boolean;
}) {
  return (
    <View style={styles.actionWrapper}>
      <PulseRing active={active} color={color} size={BTN_SIZE} />
      <TouchableOpacity
        style={[styles.actionBtn, { borderColor: color }, active && styles.actionBtnBusy]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Text style={[styles.actionBtnLabel, { color }]} numberOfLines={2}>{label}</Text>
        {progress ? <Text style={styles.actionBtnProgress}>{progress}</Text> : null}
      </TouchableOpacity>
    </View>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [sync, setSync] = useState<SyncState>({ phase: 'idle', current: 0, total: 0, newCount: 0 });
  const [orbital, setOrbital] = useState<OrbitalUpdateState>({ phase: 'idle' });
  const [lastActive, setLastActive] = useState<ActiveAction>('sync');

  // Garmin activity sync — runs inline from the "Sync Activities" button, no
  // sub-screen (per André's feedback: "just like the suunto counterpart, it
  // should read the activities and log them. no sub menu needed").
  const [garminSync, setGarminSync] = useState<GarminActivitySyncState>({ phase: 'idle', current: 0, total: 0, newCount: 0 });
  const garminSyncBusy = garminSync.phase !== 'idle' && garminSync.phase !== 'done' && garminSync.phase !== 'error';

  const syncBusy    = sync.phase    !== 'idle' && sync.phase    !== 'done' && sync.phase    !== 'error';
  const orbitalBusy = orbital.phase !== 'idle' && orbital.phase !== 'done' && orbital.phase  !== 'error';
  const isBusy = syncBusy || orbitalBusy || garminSyncBusy;

  // ── Connecting flow (v2.3.2 beta) ────────────────────────────────────────
  const [phase, setPhase] = useState<ConnPhase>('searching');
  const [deviceType, setDeviceType] = useState<AttachedDeviceType>('none');
  const [connectError, setConnectError] = useState<string | undefined>();
  const [waitingSeconds, setWaitingSeconds] = useState<number | null>(null);
  const [ambitInfo, setAmbitInfo] = useState<AmbitDeviceInfo | null>(null);
  const [garminInfo, setGarminInfo] = useState<GarminConnectResult | null>(null);
  // Kailash only - visited cities/countries, travel stats, and the real activity-mode
  // logbook, all fetched once at connect time (see connectFlow's own 'ambit' branch below).
  const [kailashHistory, setKailashHistory] = useState<KailashHistory | null>(null);

  // Refs mirroring the state above — the search-poll interval and the
  // attach-event listener are both set up once and must always see the
  // latest phase/deviceType, not whatever was captured when they started.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const deviceTypeRef = useRef(deviceType);
  deviceTypeRef.current = deviceType;

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopSearchTimers() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
  }

  async function connectFlow(type: 'ambit' | 'garmin') {
    setDeviceType(type);
    setConnectError(undefined);
    setPhase('connecting');

    if (type === 'ambit') {
      try {
        const info = await ambitConnect();
        let devInfo: AmbitDeviceInfo | null = null;
        try { devInfo = await getDeviceInfo(); } catch { /* non-fatal — hide the info block below */ }
        // Real, 2026-08-08 ("resumind: 7r button, last city visit... if we could import
        // this data which is on the watch and read it to our app would be awesome").
        // Fetched here, still connected - readDeviceHistoryRaw() needs the same open link
        // getDeviceInfo() just used, not a second connect(). Non-fatal like devInfo above:
        // a failed history read shouldn't block showing the rest of Home.
        if (isKailash(devInfo)) {
          try {
            const b64 = await readDeviceHistoryRaw();
            setKailashHistory(decodeDeviceHistory(b64));
          } catch { setKailashHistory(null); }
        } else {
          setKailashHistory(null);
        }
        await ambitDisconnect().catch(() => {});
        setAmbitInfo(devInfo ?? {
          name: info.name, model: '', serial: '', fwVersion: '', hwVersion: '', battery: -1,
        });
        setPhase('connected');
        handleSyncRef.current(); // preserve existing auto-sync-on-connect behavior
      } catch (e: any) {
        setConnectError(e?.message ?? t.unknownError);
        setPhase('connect-error');
      }
      return;
    }

    // Garmin — Garmin.connect() already retries internally for up to ~45s
    // while the mass-storage volume finishes mounting (see GarminModule.kt);
    // onMountWaiting surfaces that wait here instead of a silent hang.
    const unsubscribe = Garmin.onMountWaiting(e => setWaitingSeconds(e.secondsLeft));
    try {
      const result = await Garmin.connect();
      setGarminInfo(result);
      setPhase('connected');
      handleGarminSyncRef.current(result); // mirror Ambit's auto-sync-on-connect behavior
    } catch (e: any) {
      setConnectError(`${e?.code ?? ''} ${e?.message ?? t.unknownError}`.trim());
      setPhase('connect-error');
    } finally {
      unsubscribe();
      setWaitingSeconds(null);
    }
  }
  const connectFlowRef = useRef(connectFlow);
  connectFlowRef.current = connectFlow;

  function startSearching() {
    stopSearchTimers();
    setPhase('searching');
    setConnectError(undefined);

    const poll = async () => {
      const type = await detectAttachedDeviceType().catch(() => 'none' as const);
      if (type !== 'none') {
        stopSearchTimers();
        connectFlowRef.current(type);
      }
    };
    poll(); // immediate check, don't wait for the first interval tick
    pollTimerRef.current = setInterval(poll, SEARCH_POLL_MS);
    timeoutTimerRef.current = setTimeout(() => {
      stopSearchTimers();
      setPhase(p => (p === 'searching' ? 'timeout' : p));
    }, SEARCH_TIMEOUT_MS);
  }
  const startSearchingRef = useRef(startSearching);
  startSearchingRef.current = startSearching;

  function handleConnectLater() {
    stopSearchTimers();
    setPhase('later');
  }

  // On every focus: if we're already showing a connected device, just check
  // it's still there rather than restarting the whole search/connect dance
  // (that would re-trigger auto-sync every time the user comes back from
  // another screen). Otherwise (first mount, or the user hadn't connected
  // yet), run the normal search.
  useFocusEffect(useCallback(() => {
    if (phaseRef.current === 'connected') {
      detectAttachedDeviceType().then(type => {
        if (type === 'none' || type !== deviceTypeRef.current) startSearchingRef.current();
      }).catch(() => {});
    } else if (phaseRef.current !== 'later') {
      startSearchingRef.current();
    }
    return () => stopSearchTimers();
  }, []));

  async function handleSync() {
    if (isBusy) return;
    setLastActive('sync');
    try {
      // Real, 2026-08-08: Kailash has no ExerciseLog for the default provider's native
      // walker to find (see KailashDeviceProvider.ts's own header comment) - its one real
      // activity source is the passive TrackLog region, decoded to GPX in TS and routed
      // through this exact same sync pipeline (writeGpxFile/markActivitySynced) so no new
      // "synced activities" list/UI is needed for it.
      await runSync(setSync, isKailash(ambitInfo) ? kailashDeviceProvider : undefined);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setSync(s => ({ ...s, phase: 'error' }));
    }
  }

  // Auto-sync when the watch is plugged in — see AndroidManifest.xml's
  // USB_DEVICE_ATTACHED intent-filter + MainActivity.onNewIntent(). A ref
  // keeps this always pointing at the latest handleSync/isBusy rather than
  // whatever was captured when the effect first ran, since the listener
  // below is subscribed once on mount, not re-subscribed on every render.
  const handleSyncRef = useRef(handleSync);
  handleSyncRef.current = handleSync;

  // v2.3 beta: USB_DEVICE_ATTACHED now also fires for Garmin devices
  // (device_filter.xml) — it no longer implies "the Ambit was plugged in" by
  // itself. A live attach event jumps straight into the connect flow (no
  // need to wait out the search poll — we already know something's there).
  useEffect(() => {
    function onAttach() {
      stopSearchTimers();
      detectAttachedDeviceType().then(type => {
        if (type !== 'none') connectFlowRef.current(type);
      }).catch(() => {});
    }
    wasLaunchedViaUsbAttach().then(was => { if (was) onAttach(); }).catch(() => {});
    return onUsbAttached(onAttach);
  }, []);

  async function handleOrbital() {
    if (isBusy) return;
    setLastActive('orbital');
    try {
      await updateOrbitalData(setOrbital);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setOrbital({ phase: 'error', error: e?.message });
    }
  }

  async function handleGarminSync(result?: GarminConnectResult) {
    const target = result ?? garminInfo;
    if (isBusy || !target) return;
    try {
      await syncGarminActivities(target, setGarminSync);
    } catch (e: any) {
      Alert.alert(t.error, e?.message ?? t.unknownError);
      setGarminSync(s => ({ ...s, phase: 'error', error: e?.message }));
    }
  }
  const handleGarminSyncRef = useRef(handleGarminSync);
  handleGarminSyncRef.current = handleGarminSync;

  const activeColor = (busy: boolean, phase: 'error' | 'done' | string) =>
    phase === 'error' ? '#f44336' : phase === 'done' ? '#2ecc71' : '#00e5ff';

  const syncColor    = activeColor(syncBusy, sync.phase);
  const orbitalColor = activeColor(orbitalBusy, orbital.phase);
  const garminSyncColor = activeColor(garminSyncBusy, garminSync.phase);

  const syncLabel = syncBusy ? syncPhaseLabel(sync.phase)
    : sync.phase === 'done' ? t.synced
    : sync.phase === 'error' ? t.retry
    : t.homeActivitiesBtn;

  const orbitalLabel = orbitalBusy ? orbitalPhaseLabel(orbital.phase)
    : orbital.phase === 'done' ? t.gpsDone
    : orbital.phase === 'error' ? t.retry
    : t.gpsUpdate;

  const garminSyncLabel = garminSyncBusy
    ? (garminSync.phase === 'reading' ? t.conn : t.read)
    : garminSync.phase === 'done' ? t.synced
    : garminSync.phase === 'error' ? t.retry
    : t.homeSyncActivitiesBtn;

  const statusColor = lastActive === 'orbital' ? orbitalColor : syncColor;
  const statusText = lastActive === 'orbital' ? orbitalStatusMessage(orbital) : syncStatusMessage(sync);

  // ── Device area render (searching/connecting/timeout/error states) ───────
  if (phase === 'searching' || phase === 'timeout') {
    return (
      <View style={styles.deviceFlowContainer}>
        {phase === 'searching' ? (
          <>
            <ActivityIndicator size="large" color="#00e5ff" />
            <Text style={styles.deviceFlowTitle}>{t.homeSearchingTitle}</Text>
          </>
        ) : (
          <Text style={styles.deviceFlowTitle}>{t.homeNoDeviceTitle}</Text>
        )}
        <View style={styles.deviceFlowButtons}>
          {phase === 'timeout' && (
            <TouchableOpacity style={styles.deviceFlowSecondaryBtn} onPress={startSearching} activeOpacity={0.8}>
              <Text style={styles.deviceFlowSecondaryBtnText}>{t.homeConnectRetryBtn}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.deviceFlowPrimaryBtn} onPress={handleConnectLater} activeOpacity={0.8}>
            <Text style={styles.deviceFlowPrimaryBtnText}>{t.homeConnectLaterBtn}</Text>
          </TouchableOpacity>
          {/* Activities are stored locally and don't depend on a device being
              connected — don't trap the user behind the search/timeout screen
              if all they want is to look at what's already synced. */}
          <TouchableOpacity style={styles.deviceFlowSecondaryBtn} onPress={() => navigation.navigate('LogList')} activeOpacity={0.8}>
            <Text style={styles.deviceFlowSecondaryBtnText}>{t.viewActivities}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === 'connecting') {
    const msg = deviceType === 'garmin' && waitingSeconds !== null
      ? t.garminWaitingForMount(waitingSeconds)
      : deviceType === 'ambit' ? t.homeConnectingAmbit : t.connecting;
    return (
      <View style={styles.deviceFlowContainer}>
        <ActivityIndicator size="large" color="#00e5ff" />
        <Text style={styles.deviceFlowTitle}>{msg}</Text>
        <TouchableOpacity style={styles.deviceFlowSecondaryBtn} onPress={() => navigation.navigate('LogList')} activeOpacity={0.8}>
          <Text style={styles.deviceFlowSecondaryBtnText}>{t.viewActivities}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'connect-error') {
    return (
      <View style={styles.deviceFlowContainer}>
        <Text style={[styles.deviceFlowTitle, styles.deviceFlowError]}>{connectError}</Text>
        <View style={styles.deviceFlowButtons}>
          <TouchableOpacity
            style={styles.deviceFlowSecondaryBtn}
            onPress={() => connectFlowRef.current(deviceType as 'ambit' | 'garmin')}
            activeOpacity={0.8}
          >
            <Text style={styles.deviceFlowSecondaryBtnText}>{t.homeConnectRetryBtn}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deviceFlowPrimaryBtn} onPress={handleConnectLater} activeOpacity={0.8}>
            <Text style={styles.deviceFlowPrimaryBtnText}>{t.homeConnectLaterBtn}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deviceFlowSecondaryBtn} onPress={() => navigation.navigate('LogList')} activeOpacity={0.8}>
            <Text style={styles.deviceFlowSecondaryBtnText}>{t.viewActivities}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === 'later') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.appName}>AmbitApp</Text>
          <Text style={styles.versionText}>v{APP_VERSION}</Text>
        </View>
        <View />
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

  // phase === 'connected' from here on

  return (
    <View style={styles.container}>

      {/* ── Tracé GPS en filigrane ── */}
      <View style={styles.traceWrapper} pointerEvents="none">
        <GpsTraceDecoration size={260} />
      </View>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appName}>AmbitApp</Text>
        <Text style={styles.versionText}>v{APP_VERSION}</Text>
      </View>

      {/* ── Device info (both device types show name/battery/firmware/hardware) ── */}
      {deviceType === 'garmin' && garminInfo && (() => {
        const vol = garminInfo.volumes.find(v => v.hasGarminDeviceXml) ?? garminInfo.volumes[0];
        return (
          <View style={styles.deviceInfoBox}>
            <Text style={styles.deviceInfoPrimary}>{vol?.model ?? t.garminUnknownModel}</Text>
            <Text style={styles.deviceInfoSecondary}>
              {vol?.firmwareVersion ? `${t.garminFirmwareLabel} ${vol.firmwareVersion}` : ''}
            </Text>
            <Text style={styles.deviceInfoSecondary}>
              {garminInfo.hasSdCard ? t.garminSdCardPresent : t.garminSdCardAbsent}
            </Text>
          </View>
        );
      })()}
      {deviceType === 'ambit' && ambitInfo && (
        <View style={styles.deviceInfoBox}>
          <Text style={styles.deviceInfoPrimary}>{ambitInfo.name}</Text>
          <Text style={styles.deviceInfoSecondary}>
            {ambitInfo.fwVersion ? `${t.garminFirmwareLabel} ${ambitInfo.fwVersion}` : ''}
            {ambitInfo.hwVersion ? `  ·  ${t.homeHwLabel} ${ambitInfo.hwVersion}` : ''}
          </Text>
          {ambitInfo.battery >= 0 && (
            <Text style={styles.deviceInfoSecondary}>{t.homeBatteryLabel} {ambitInfo.battery}%</Text>
          )}
        </View>
      )}

      {/* ── Kailash travel history - real, 2026-08-08 ("if we could import this data
          which is on the watch and read it to our app would be awesome"). Reuses the same
          deviceInfoBox styling as the block above rather than introducing a new one - this
          is presentationally the same kind of "facts about the connected watch" card. ── */}
      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashHistory && (
        <View style={styles.deviceInfoBox}>
          <Text style={styles.deviceInfoPrimary}>{t.homeKailashTravelTitle}</Text>
          <Text style={styles.deviceInfoSecondary}>
            {t.homeKailashCitiesLabel} {kailashHistory.citiesVisited}
            {'  ·  '}{t.homeKailashCountriesLabel} {kailashHistory.countriesVisited}
          </Text>
          {kailashHistory.hasLastKnownLocation && (
            <Text style={styles.deviceInfoSecondary}>
              {kailashHistory.lastKnownLatitude.toFixed(4)}, {kailashHistory.lastKnownLongitude.toFixed(4)}
              {kailashHistory.lastKnownCountry ? ` (${kailashHistory.lastKnownCountry})` : ''}
            </Text>
          )}
          <Text style={styles.deviceInfoSecondary}>
            {t.homeKailashTravelledLabel} {(kailashHistory.travelledDistanceMeters / 1000).toFixed(1)} km
            {'  ·  '}{t.homeKailashFurthestLabel} {(kailashHistory.furthestFromHomeMeters / 1000).toFixed(1)} km
          </Text>
          {kailashHistory.sessions.length > 0 && (
            <Text style={styles.deviceInfoSecondary}>
              {t.homeKailashLogbookLabel} {kailashHistory.sessions.length}
            </Text>
          )}
        </View>
      )}

      {/* ── Menu : dépend de l'appareil connecté (v2.3.2 beta) ── */}
      {deviceType === 'garmin' ? (
        <View style={styles.actionsRow}>
          <ActionButton
            label={garminSyncLabel}
            progress={garminSync.phase === 'writing' && garminSync.total > 0 ? `${garminSync.current}/${garminSync.total}` : undefined}
            active={garminSyncBusy}
            color={garminSyncColor}
            onPress={() => handleGarminSync()}
            disabled={isBusy}
          />
          <ActionButton
            label={t.homeRoutesBtn}
            active={false}
            color="#00a651"
            onPress={() => garminInfo && navigation.navigate('GarminRoute', { info: garminInfo })}
            disabled={isBusy}
          />
          <ActionButton
            label={t.homePoisBtn}
            active={false}
            color="#00a651"
            onPress={() => garminInfo && navigation.navigate('GarminPoi', { info: garminInfo })}
            disabled={isBusy}
          />
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <ActionButton
            label={syncLabel}
            progress={sync.phase !== 'idle' && sync.total > 0 ? `${sync.current}/${sync.total}` : undefined}
            active={syncBusy}
            color={syncColor}
            onPress={handleSync}
            disabled={isBusy}
          />
          <ActionButton
            label={orbitalLabel}
            active={orbitalBusy}
            color={orbitalColor}
            onPress={handleOrbital}
            disabled={isBusy}
          />
          <ActionButton
            label={t.homeRoutesBtn}
            active={false}
            color="#8b5cf6"
            onPress={() => navigation.navigate('Route')}
            disabled={isBusy}
          />
          <ActionButton
            label={t.homePoisBtn}
            active={false}
            color="#8b5cf6"
            onPress={() => navigation.navigate('Poi')}
            disabled={isBusy}
          />
          <ActionButton
            label={t.backupButton}
            active={false}
            color="#ffb300"
            onPress={() => navigation.navigate('Backup')}
            disabled={isBusy}
          />
          {/* Real, 2026-08-08 - Ambit3-only: Kailash's own memory map has no CustomModes
              region at all (confirmed empty, see custom_modes_andre.md's Kailash section),
              the same exclusion the desktop app's own NavRail.qml applies. */}
          {!isKailash(ambitInfo) && (
            <ActionButton
              label={t.sportModesButton}
              active={false}
              color="#8b5cf6"
              onPress={() => navigation.navigate('SportModes')}
              disabled={isBusy}
            />
          )}
        </View>
      )}

      {/* ── Statut ── */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusText}
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

function syncPhaseLabel(phase: SyncState['phase']): string {
  switch (phase) {
    case 'connecting': return t.conn;
    case 'fetching':   return t.read;
    case 'writing':    return t.save;
    default:           return '…';
  }
}

function syncStatusMessage(sync: SyncState): string {
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

function orbitalPhaseLabel(phase: OrbitalUpdateState['phase']): string {
  switch (phase) {
    case 'connecting':  return t.conn;
    case 'downloading': return t.gpsDownloading;
    case 'writing':     return t.save;
    default:            return '…';
  }
}

function orbitalStatusMessage(s: OrbitalUpdateState): string {
  switch (s.phase) {
    case 'idle':        return t.gpsIdle;
    case 'connecting':  return t.connecting;
    case 'downloading': return t.gpsDownloadingMsg;
    case 'writing':     return t.writing;
    case 'done':        return t.gpsDoneMsg;
    case 'error':        return s.error ?? t.error;
    default:             return '';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BTN_SIZE = 82;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 56,
    paddingHorizontal: 24,
  },
  deviceFlowContainer: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
  deviceFlowTitle: {
    color: '#8ab4d8',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 23,
  },
  deviceFlowError: {
    color: '#ff5252',
  },
  deviceFlowButtons: {
    gap: 12,
    width: '100%',
    alignItems: 'center',
  },
  deviceFlowPrimaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    backgroundColor: 'rgba(15,52,96,0.5)',
  },
  deviceFlowPrimaryBtnText: {
    color: '#8ab4d8',
    fontSize: 15,
    fontWeight: '600',
  },
  deviceFlowSecondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  deviceFlowSecondaryBtnText: {
    color: '#00e5ff',
    fontSize: 14,
    fontWeight: '600',
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
  versionText: {
    fontSize: 10,
    color: '#3a5a8a',
    letterSpacing: 1,
    marginTop: 2,
  },
  deviceInfoBox: {
    alignItems: 'center',
    marginTop: -20,
  },
  deviceInfoPrimary: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  deviceInfoSecondary: {
    color: '#8899aa',
    fontSize: 12,
    marginBottom: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: BTN_SIZE + 24,
    height: BTN_SIZE + 24,
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  actionBtn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    borderWidth: 2.5,
    backgroundColor: 'rgba(0,229,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  actionBtnBusy: {
    backgroundColor: 'rgba(0,229,255,0.03)',
  },
  actionBtnLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  actionBtnProgress: {
    fontSize: 10,
    color: '#8899aa',
    marginTop: 3,
    letterSpacing: 0.5,
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
