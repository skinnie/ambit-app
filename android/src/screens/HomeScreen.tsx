import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, useWindowDimensions, ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { runSync, SyncState } from '../services/SyncService';
import { updateOrbitalData, OrbitalUpdateState } from '../services/SgeeService';
import {
  connect as ambitConnect, disconnect as ambitDisconnect, getDeviceInfo, AmbitDeviceInfo,
  wasLaunchedViaUsbAttach, onUsbAttached, detectAttachedDeviceType, AttachedDeviceType,
  readDeviceHistoryRaw, readDeviceLogRaw, setBleTransportActive, saveToDownloads,
} from '../native/AmbitUsbModule';
import RNFS from 'react-native-fs';
import { scanAndConnect as bleScanAndConnect } from '../native/AmbitBleModule';
import * as Garmin from '../native/GarminModule';
import type { GarminConnectResult } from '../native/GarminModule';
import { syncGarminActivities, GarminActivitySyncState } from '../services/GarminActivityService';
import { kailashDeviceProvider } from '../services/devices/KailashDeviceProvider';
import { ambitBleDeviceProvider } from '../services/devices/AmbitBleDeviceProvider';
import { decodeDeviceHistory, KailashHistory } from '../services/KailashHistoryReader';
import { decodeDeviceLog, realTrackPoints, deviceLogToGpx, KailashDeviceLog } from '../services/KailashDeviceLogReader';
import { APP_VERSION } from '../config/version';
import { t } from '../i18n';
import { useTheme } from '../theme/useTheme';
import Icon from '../components/ui/Icon';
import { ActionTile, Badge, Button, Chip, Logo, StatusLine } from '../components/ui/primitives';

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
const CONNECTED_POLL_MS = 4000;

// ─── Composant principal ──────────────────────────────────────────────────────
export default function HomeScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();

  // "No device connected" screens (searching/connecting/timeout/error) run
  // ~12.5% larger text than the rest of the app, scaled further by the
  // device's own width so it keeps that proportion on a tablet instead of
  // just growing the phone-sized number — clamped so it can't run away.
  const { width: winWidth } = useWindowDimensions();
  const deviceFlowScale = Math.min(1.6, Math.max(1.125, (winWidth / 380) * 1.125));
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
  // Kailash only - the ephemeral GPS track (DeviceLog 0x53) fetched over the live BLE link
  // at connect time; null when the store was empty (already drained by the 7R app). Held so
  // the "export track" action below can write it without a second read. See handleBleConnect.
  const [kailashTrack, setKailashTrack] = useState<KailashDeviceLog | null>(null);
  const [kailashExportBusy, setKailashExportBusy] = useState(false);
  // Distinguishes a BLE connect attempt from connectFlow('ambit')'s USB one for
  // the "connecting…" message only — both land on the same deviceType==='ambit'.
  const [bleAttempt, setBleAttempt] = useState(false);
  // True once connected over BLE. Gates two things off the USB-only machinery:
  // (1) the connected-state watchdog below must NOT poll detectAttachedDeviceType()
  //     (USB-only — it returns 'none' for a BLE link and would evict us back to the
  //     no-device screen, which is exactly what happened before this flag existed);
  // (2) sync must use the BLE device provider (no USB connect()), see handleSync.
  const [bleConnected, setBleConnected] = useState(false);

  // Refs mirroring the state above — the search-poll interval and the
  // attach-event listener are both set up once and must always see the
  // latest phase/deviceType, not whatever was captured when they started.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const deviceTypeRef = useRef(deviceType);
  deviceTypeRef.current = deviceType;
  const bleConnectedRef = useRef(bleConnected);
  bleConnectedRef.current = bleConnected;

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopSearchTimers() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
  }

  async function connectFlow(type: 'ambit' | 'garmin') {
    setDeviceType(type);
    setBleAttempt(false);
    setBleConnected(false);          // this is a USB connect path
    bleConnectedRef.current = false;
    setBleTransportActive(false);    // USB path — connect()/disconnect() hit USB
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

  // BLE connect (2026-08-08) — there was previously no way to reach a BLE
  // pairing flow at all from Home: startSearching()/detectAttachedDeviceType()
  // only ever look for a USB attach event, and the BLE send/export buttons
  // already sitting in RouteScreen.tsx are unreachable until phase==='connected',
  // which only USB/Garmin detection could ever produce. This mirrors
  // connectFlow('ambit')'s post-connect half (same getDeviceInfo() call, same
  // phase==='connected'/deviceType==='ambit' target state) so the existing
  // action tiles — including Routes, which is where the real BLE send/export
  // UI lives — become reachable the same way a cable connection already does.
  // Ambit3/Traverse only; unlike Garmin/Ambit-over-USB this needs the user to
  // trigger the watch's own menu action first, right before scanning, since
  // its BLE advertising window is short (same reasoning as RouteScreen.tsx's
  // waitForSyncNowTap).
  async function handleBleConnect() {
    // Straight to scanning — no confirmation dialog. The scan already waits ~15 s
    // (SCAN_TIMEOUT_MS in AmbitBleModule.kt), which is the watch's advertising
    // window, so the user just triggers "Pair Mobile App"/"Sync now" on the watch
    // while "Connecting via Bluetooth…" is showing. Removing the extra tap loses
    // no function (the old t.homeBleReadyMsg guidance now lives on that screen).
    stopSearchTimers();
    setDeviceType('ambit');
    setBleAttempt(true);
    setConnectError(undefined);
    setPhase('connecting');
    try {
      await bleScanAndConnect();
      let devInfo: AmbitDeviceInfo | null = null;
      try { devInfo = await getDeviceInfo(); } catch { /* non-fatal — hide the info block below */ }
      setAmbitInfo(devInfo);
      // Kailash (2026-08-09, KAILASH-BLE-FINDINGS.md Finding 7): while the BLE link is
      // live, read the persistent activity summaries (DeviceHistory 0x67 → the on-screen
      // panel) and the EPHEMERAL GPS sample store (DeviceLog 0x53 → an exportable track).
      // 0x53 only has real samples over an active BLE session and before the 7R app drains
      // it, so this read must happen here, on the live link. Both non-fatal.
      if (isKailash(devInfo)) {
        try {
          setKailashHistory(decodeDeviceHistory(await readDeviceHistoryRaw()));
        } catch { setKailashHistory(null); }
        try {
          const log = decodeDeviceLog(await readDeviceLogRaw());
          setKailashTrack(log && realTrackPoints(log).length > 0 ? log : null);
        } catch { setKailashTrack(null); }
      } else {
        setKailashHistory(null);
        setKailashTrack(null);
      }
      setBleConnected(true);
      bleConnectedRef.current = true;
      setBleTransportActive(true);   // route all connect()/disconnect() through BLE
      setPhase('connected');
      // No auto-sync on BLE connect — let the user pick an action from the menu.
      // (Auto-sync on connect is a USB-attach convenience; over BLE the connect
      // is already an explicit user action and the sync path is experimental.)
    } catch (e: any) {
      setBleConnected(false);
      bleConnectedRef.current = false;
      setBleTransportActive(false);
      setConnectError(e?.message ?? t.unknownError);
      setPhase('connect-error');
    }
  }
  const handleBleConnectRef = useRef(handleBleConnect);
  handleBleConnectRef.current = handleBleConnect;

  // Writes the Kailash track fetched at connect time (kailashTrack) to Downloads as GPX.
  // No watch round-trip here — the samples were already read over the live link in
  // handleBleConnect, because DeviceLog (0x53) is ephemeral (see KailashDeviceLogReader.ts).
  async function handleExportKailashTrack() {
    if (!kailashTrack || kailashExportBusy) return;
    setKailashExportBusy(true);
    try {
      const pts = realTrackPoints(kailashTrack);
      const gpx = deviceLogToGpx(kailashTrack, `Kailash ${pts[0]?.time ?? ''}`.trim());
      if (!gpx) { Alert.alert(t.homeKailashTrackTitle, t.homeKailashExportEmpty); return; }
      const stamp = (pts[0]?.time ?? new Date().toISOString()).replace(/[:.]/g, '-');
      const fileName = `kailash_${stamp}.gpx`;
      const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
      await RNFS.writeFile(path, gpx, 'utf8');
      await saveToDownloads(path, fileName, 'application/gpx+xml');
      Alert.alert(t.homeKailashTrackTitle, t.homeKailashExportDone.replace('%d', String(pts.length)));
    } catch (e: any) {
      Alert.alert(t.homeKailashTrackTitle, e?.message ?? t.unknownError);
    } finally {
      setKailashExportBusy(false);
    }
  }

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
    // A BLE connection is invisible to detectAttachedDeviceType() (USB-only), so
    // never run the USB re-check while BLE-connected — it would falsely see
    // 'none' and bounce back to the search screen.
    if (bleConnectedRef.current) return () => {};
    if (phaseRef.current === 'connected') {
      detectAttachedDeviceType().then(type => {
        if (type === 'none' || type !== deviceTypeRef.current) startSearchingRef.current();
      }).catch(() => {});
    } else if (phaseRef.current !== 'later') {
      startSearchingRef.current();
    }
    return () => stopSearchTimers();
  }, []));

  // Live refresh while sitting on the connected dashboard: rather than only
  // re-checking on focus (which misses "watch unplugged while I was looking
  // at this screen"), poll periodically. If nothing's attached any more,
  // fall back to the no-device screen; if a *different* device answers
  // (e.g. the Ambit was swapped for the eTrex), jump straight into that
  // device's connect flow instead of bouncing through an extra search step.
  useEffect(() => {
    if (phase !== 'connected') return;
    const iv = setInterval(async () => {
      // BLE links aren't visible to the USB attach check — skip the watchdog
      // entirely while BLE-connected so it can't evict us to the no-device screen.
      if (bleConnectedRef.current) return;
      const type = await detectAttachedDeviceType().catch(() => 'none' as const);
      if (type === deviceTypeRef.current) return;
      if (type === 'none') startSearchingRef.current();
      else connectFlowRef.current(type);
    }, CONNECTED_POLL_MS);
    return () => clearInterval(iv);
  }, [phase]);

  async function handleSync() {
    if (isBusy) return;
    setLastActive('sync');
    try {
      // Real, 2026-08-08: Kailash has no ExerciseLog for the default provider's native
      // walker to find (see KailashDeviceProvider.ts's own header comment) - its one real
      // activity source is the passive TrackLog region, decoded to GPX in TS and routed
      // through this exact same sync pipeline (writeGpxFile/markActivitySynced) so no new
      // "synced activities" list/UI is needed for it.
      // Over BLE the connection is already up (GATT server + handshake); use the
      // BLE provider so sync doesn't try a USB connect() ("check cable" error).
      // The native getLogs itself is transport-agnostic (operates on the shared
      // device), so activity read works the same either way once connected.
      const provider = bleConnectedRef.current
        ? ambitBleDeviceProvider
        : (isKailash(ambitInfo) ? kailashDeviceProvider : undefined);
      await runSync(setSync, provider);
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

  // Which of the two Ambit-only operations last ran drives the status line
  // below — same derivation as before, just expressed as a tone (muted vs.
  // the one alert color) instead of a hardcoded hex per phase.
  const statusPhase = lastActive === 'orbital' ? orbital.phase : sync.phase;
  const statusText = lastActive === 'orbital' ? orbitalStatusMessage(orbital) : syncStatusMessage(sync);
  const statusTone: 'muted' | 'alert' = statusPhase === 'error' ? 'alert' : 'muted';

  // ── Device area render (searching/connecting/timeout/error states) ───────
  if (phase === 'searching' || phase === 'timeout') {
    return (
      <View style={styles.deviceFlowContainer}>
        <View style={styles.deviceFlowLogo}>
          <Logo size={Math.round(56 * deviceFlowScale)} />
          <Badge label={`v${APP_VERSION}`} />
        </View>
        {phase === 'searching' ? (
          <>
            <ActivityIndicator size="large" color={theme.text} />
            <Text style={[styles.deviceFlowTitle, deviceFlowTitleScale(deviceFlowScale)]}>{t.homeSearchingTitle}</Text>
          </>
        ) : (
          <Text style={[styles.deviceFlowTitle, deviceFlowTitleScale(deviceFlowScale)]}>{t.homeNoDeviceTitle}</Text>
        )}
        <View style={styles.deviceFlowButtons}>
          {phase === 'timeout' && (
            <Button label={t.homeConnectRetryBtn} onPress={startSearching} variant="text" grow={false} />
          )}
          <Button label={t.homeBleConnectBtn} onPress={handleBleConnectRef.current} variant="text" grow={false} />
          <Button label={t.homeConnectLaterBtn} onPress={handleConnectLater} variant="outline" grow={false} />
          {/* Activities are stored locally and don't depend on a device being
              connected — don't trap the user behind the search/timeout screen
              if all they want is to look at what's already synced. */}
          <Button label={t.viewActivities} onPress={() => navigation.navigate('LogList')} variant="text" grow={false} />
        </View>
      </View>
    );
  }

  if (phase === 'connecting') {
    const msg = deviceType === 'garmin' && waitingSeconds !== null
      ? t.garminWaitingForMount(waitingSeconds)
      : deviceType === 'ambit' ? (bleAttempt ? t.homeConnectingBle : t.homeConnectingAmbit) : t.connecting;
    return (
      <View style={styles.deviceFlowContainer}>
        <View style={styles.deviceFlowLogo}>
          <Logo size={Math.round(56 * deviceFlowScale)} />
          <Badge label={`v${APP_VERSION}`} />
        </View>
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={[styles.deviceFlowTitle, deviceFlowTitleScale(deviceFlowScale)]}>{msg}</Text>
        {bleAttempt && (
          <Text style={[styles.deviceSub, { textAlign: 'center', paddingHorizontal: 24 }]}>
            {t.homeBleReadyMsg}
          </Text>
        )}
        <Button label={t.viewActivities} onPress={() => navigation.navigate('LogList')} variant="text" grow={false} />
      </View>
    );
  }

  if (phase === 'connect-error') {
    return (
      <View style={styles.deviceFlowContainer}>
        <View style={styles.deviceFlowLogo}>
          <Logo size={Math.round(56 * deviceFlowScale)} />
          <Badge label={`v${APP_VERSION}`} />
        </View>
        <Text style={[styles.deviceFlowTitle, deviceFlowTitleScale(deviceFlowScale)]}>{connectError}</Text>
        <View style={styles.deviceFlowButtons}>
          <Button
            label={t.homeConnectRetryBtn}
            onPress={() => bleAttempt ? handleBleConnectRef.current() : connectFlowRef.current(deviceType as 'ambit' | 'garmin')}
            variant="text"
            grow={false}
          />
          {!bleAttempt && (
            <Button label={t.homeBleConnectBtn} onPress={handleBleConnectRef.current} variant="text" grow={false} />
          )}
          <Button label={t.homeConnectLaterBtn} onPress={handleConnectLater} variant="outline" grow={false} />
          <Button label={t.viewActivities} onPress={() => navigation.navigate('LogList')} variant="text" grow={false} />
        </View>
      </View>
    );
  }

  if (phase === 'later') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.appName}>AmbitApp</Text>
          <Badge label={`v${APP_VERSION}`} />
        </View>
        <Icon name="mountain" size={48} color={theme.text} />
        <Button label={t.homeBleConnectBtn} onPress={handleBleConnectRef.current} variant="text" grow={false} />
        <View style={styles.bottomRow}>
          <Button
            label={t.viewActivities}
            icon="list"
            onPress={() => navigation.navigate('LogList')}
            variant="outline"
          />
          <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.75}>
            <Icon name="settings" size={19} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // phase === 'connected' from here on

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appName}>AmbitApp</Text>
        <Badge label={`v${APP_VERSION}`} />
      </View>
      <Icon name={deviceType === 'garmin' ? 'etrex' : 'watch'} size={40} color={theme.text} />

      {/* ── Device info (both device types show name/battery/firmware/hardware) ── */}
      {deviceType === 'garmin' && garminInfo && (() => {
        const vol = garminInfo.volumes.find(v => v.hasGarminDeviceXml) ?? garminInfo.volumes[0];
        return (
          <View style={styles.deviceCard}>
            <Text style={styles.deviceName}>{vol?.model ?? t.garminUnknownModel}</Text>
            {!!vol?.firmwareVersion && (
              <Text style={styles.deviceSub}>{t.garminFirmwareLabel} {vol.firmwareVersion}</Text>
            )}
            <View style={styles.deviceMetaRow}>
              <Text style={styles.deviceSub}>
                {garminInfo.hasSdCard ? t.garminSdCardPresent : t.garminSdCardAbsent}
              </Text>
              <Chip icon="check" label={t.homeDeviceConnectedStatus} />
            </View>
          </View>
        );
      })()}
      {deviceType === 'ambit' && ambitInfo && (
        <View style={styles.deviceCard}>
          <Text style={styles.deviceName}>{ambitInfo.name}</Text>
          {!!(ambitInfo.fwVersion || ambitInfo.hwVersion) && (
            <Text style={styles.deviceSub}>
              {ambitInfo.fwVersion ? `${t.garminFirmwareLabel} ${ambitInfo.fwVersion}` : ''}
              {ambitInfo.hwVersion ? `  ·  ${t.homeHwLabel} ${ambitInfo.hwVersion}` : ''}
            </Text>
          )}
          <View style={styles.deviceMetaRow}>
            {ambitInfo.battery >= 0 && (
              <View style={styles.deviceBattery}>
                <Icon name="battery" size={15} color={theme.textMuted} />
                <Text style={styles.deviceBatteryText}>{ambitInfo.battery}%</Text>
              </View>
            )}
            <Chip icon="check" label={t.homeDeviceConnectedStatus} />
          </View>
        </View>
      )}

      {/* ── Kailash travel history - real, 2026-08-08 ("if we could import this data
          which is on the watch and read it to our app would be awesome"). Restyled onto
          the theme-redesign's own deviceCard pattern (2026-08-08 merge) - same as the
          ambitInfo card just above: deviceName for the title, deviceSub (repeated) for
          each muted detail line, rather than the pre-redesign deviceInfoBox styles this
          screen no longer defines. ── */}
      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashHistory && (
        <View style={styles.deviceCard}>
          <Text style={styles.deviceName}>{t.homeKailashTravelTitle}</Text>
          <Text style={styles.deviceSub}>
            {t.homeKailashCitiesLabel} {kailashHistory.citiesVisited}
            {'  ·  '}{t.homeKailashCountriesLabel} {kailashHistory.countriesVisited}
          </Text>
          {kailashHistory.hasLastKnownLocation && (
            <Text style={styles.deviceSub}>
              {kailashHistory.lastKnownLatitude.toFixed(4)}, {kailashHistory.lastKnownLongitude.toFixed(4)}
              {kailashHistory.lastKnownCountry ? ` (${kailashHistory.lastKnownCountry})` : ''}
            </Text>
          )}
          <Text style={styles.deviceSub}>
            {t.homeKailashTravelledLabel} {(kailashHistory.travelledDistanceMeters / 1000).toFixed(1)} km
            {'  ·  '}{t.homeKailashFurthestLabel} {(kailashHistory.furthestFromHomeMeters / 1000).toFixed(1)} km
          </Text>
          {kailashHistory.sessions.length > 0 && (
            <Text style={styles.deviceSub}>
              {t.homeKailashLogbookLabel} {kailashHistory.sessions.length}
            </Text>
          )}
        </View>
      )}

      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashTrack && (
        <View style={styles.deviceCard}>
          <Text style={styles.deviceName}>{t.homeKailashTrackTitle}</Text>
          <Text style={styles.deviceSub}>
            {realTrackPoints(kailashTrack).length} {t.homeKailashTrackPoints}
          </Text>
          <Button
            label={t.homeKailashTrackExport}
            onPress={handleExportKailashTrack}
            disabled={kailashExportBusy}
            grow={false}
          />
        </View>
      )}

      {/* ── Menu : dépend de l'appareil connecté (v2.3.2 beta) ── */}
      {deviceType === 'garmin' ? (
        <View style={styles.actionsRow}>
          <ActionTile
            icon="sync"
            label={garminSyncLabel}
            progress={garminSync.phase === 'writing' && garminSync.total > 0 ? `${garminSync.current}/${garminSync.total}` : undefined}
            busy={garminSyncBusy}
            onPress={() => handleGarminSync()}
            disabled={isBusy}
          />
          <ActionTile
            icon="route"
            label={t.homeRoutesBtn}
            onPress={() => garminInfo && navigation.navigate('GarminRoute', { info: garminInfo })}
            disabled={isBusy}
          />
          <ActionTile
            icon="poi"
            label={t.homePoisBtn}
            onPress={() => garminInfo && navigation.navigate('GarminPoi', { info: garminInfo })}
            disabled={isBusy}
          />
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <ActionTile
            icon="sync"
            label={syncLabel}
            progress={sync.phase !== 'idle' && sync.total > 0 ? `${sync.current}/${sync.total}` : undefined}
            busy={syncBusy}
            onPress={handleSync}
            disabled={isBusy}
          />
          <ActionTile
            icon="satellite"
            label={orbitalLabel}
            busy={orbitalBusy}
            onPress={handleOrbital}
            disabled={isBusy}
          />
          <ActionTile
            icon="route"
            label={t.homeRoutesBtn}
            onPress={() => navigation.navigate('Route')}
            disabled={isBusy}
          />
          <ActionTile
            icon="poi"
            label={t.homePoisBtn}
            onPress={() => navigation.navigate('Poi')}
            disabled={isBusy}
          />
          <ActionTile
            icon="backup"
            label={t.backupButton}
            onPress={() => navigation.navigate('Backup')}
            disabled={isBusy}
          />
          {/* Real, 2026-08-08 - Ambit3-only: Kailash's own memory map has no CustomModes
              region at all (confirmed empty, see custom_modes_andre.md's Kailash section),
              the same exclusion the desktop app's own NavRail.qml applies. Uses ActionTile
              (2026-08-08 merge) - the theme redesign's own tile component, not the
              pre-redesign ActionButton this screen no longer defines. */}
          {!isKailash(ambitInfo) && (
            <ActionTile
              icon="watch"
              label={t.sportModesButton}
              onPress={() => navigation.navigate('SportModes')}
              disabled={isBusy}
            />
          )}
        </View>
      )}

      {/* ── Statut ── */}
      <StatusLine text={statusText} tone={statusTone} />

      {/* ── Bas de page : activités + paramètres ── */}
      <View style={styles.bottomRow}>
        <Button
          label={t.viewActivities}
          icon="list"
          onPress={() => navigation.navigate('LogList')}
          variant="outline"
        />
        <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.75}>
          <Icon name="settings" size={19} color={theme.text} />
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deviceFlowTitleScale(scale: number) {
  return { fontSize: Math.round(16 * scale), lineHeight: Math.round(23 * scale) };
}

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

// Cap the content column so cards/tiles form a tidy centered stack instead of
// stretching edge-to-edge on a wide (landscape/tablet) screen. Portrait phones are
// narrower than this, so they're unaffected — width:'100%' still wins there.
const CONTENT_MAX_WIDTH = 560;

function createStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 56,
      paddingHorizontal: 24,
    },
    // The connected screen scrolls (a lot of content: device cards + a 2-column tile
    // grid + footer), so on short/landscape screens nothing clips; on tall/portrait
    // ones flexGrow + space-between still fills the screen the way `container` did.
    scroll: {
      flex: 1,
      backgroundColor: t.background,
    },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 56,
      paddingHorizontal: 24,
    },
    deviceFlowContainer: {
      flex: 1,
      backgroundColor: t.background,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 24,
    },
    deviceFlowTitle: {
      color: t.textMuted,
      fontSize: 16,
      textAlign: 'center',
      lineHeight: 23,
    },
    deviceFlowError: {
      color: t.alert,
    },
    deviceFlowButtons: {
      gap: 10,
      width: '100%',
      alignItems: 'center',
    },
    deviceFlowLogo: {
      alignItems: 'center',
      gap: 10,
    },
    header: {
      alignItems: 'center',
      gap: 6,
    },
    appName: {
      fontSize: 26,
      fontWeight: '800',
      color: t.text,
      letterSpacing: 1.5,
    },
    deviceCard: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      backgroundColor: t.surfaceHigh,
      borderColor: t.outline,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      marginTop: -8,
      alignItems: 'center',
    },
    deviceName: {
      color: t.text,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
    },
    deviceBattery: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    deviceBatteryText: {
      color: t.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    deviceSub: {
      color: t.textMuted,
      fontSize: 11.5,
      textAlign: 'center',
      marginTop: 2,
    },
    deviceMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      marginTop: 8,
    },
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    bottomRow: {
      flexDirection: 'row',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      gap: 10,
      alignItems: 'center',
    },
    settingsBtn: {
      width: 52,
      height: 52,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.outline,
      backgroundColor: t.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
