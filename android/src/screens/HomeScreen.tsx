import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, useWindowDimensions, ScrollView, Linking,
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
  setDateTime,
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
import { manualUrlFor, garminManualUrlFor } from '../config/manuals';
import { t } from '../i18n';
import Icon from '../components/ui/Icon';
import { ActionTile, Badge, Button, Chip, Logo, StatusLine } from '../components/ui/primitives';
// v3.0 UI port (2026-08-09, "go all the way to the new theming") - the whole screen (not
// just the connected dashboard) is on the v3 palette now; tokens.ts/useTheme() aren't
// imported here anymore at all.
import { useV3Theme } from '../theme/v3';
import { Card } from '../components/ui/Card';
import { WeatherCard } from '../components/WeatherCard';
import { TrackPreview } from '../components/TrackPreview';
import { NavShell, NavShellItem } from '../navigation/NavShell';

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
type ConnPhase = 'searching' | 'connecting' | 'connected' | 'timeout' | 'connect-error';

// Real, 2026-08-09 (v3.0 planning: "via usb should be auto detected, refresh rate
// 2seconds if no usb is detected") - was 1200ms, bumped to the real requested 2s. Bluetooth
// stays button-triggered (homeBleConnectBtn / handleBleConnectRef), not auto-polled - the
// watch's BLE advertising window is short and scanning continuously would drain it for no
// benefit, see the BLE-connect comments further down this file.
const SEARCH_POLL_MS = 2000;
const SEARCH_TIMEOUT_MS = 15000;
const CONNECTED_POLL_MS = 4000;

// ─── Composant principal ──────────────────────────────────────────────────────
export default function HomeScreen() {
  // v3.0 UI port (2026-08-09, "go all the way to the new theming") - the whole screen is on
  // the v3 palette now, including the pre-connect phase screens (searching/no-device/
  // connecting/error/later) that were deliberately left on the old theme during the initial
  // proof-of-concept pass. `theme` is kept as the local name (not renamed to `v3`) purely to
  // avoid a much larger diff below - every value it returns is v3Colors now.
  const theme = useV3Theme();
  const styles = createStyles(theme);
  const navigation = useNavigation<Nav>();
  // deviceName/deviceSub keep their existing font metrics (createStyles(theme) above still
  // owns size/weight/spacing) - these two exist only because deviceName/deviceSub are style
  // *objects* (not just color), so overriding color needs a second style-array entry rather
  // than editing the object in place.
  const v3TextStyle = { color: theme.text };
  const v3MutedStyle = { color: theme.mutedText };

  // "No device connected" screens (searching/connecting/timeout/error) run
  // ~12.5% larger text than the rest of the app, scaled further by the
  // device's own width so it keeps that proportion on a tablet instead of
  // just growing the phone-sized number — clamped so it can't run away.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const deviceFlowScale = Math.min(1.6, Math.max(1.125, (winWidth / 380) * 1.125));
  // "Roomy" = actually landscape AND wide enough (a landscape tablet / large window),
  // where the connected screen lays its cards side by side and uses more tile columns.
  // Must be orientation-based, not width-only: this tablet is 800 px wide in PORTRAIT,
  // so a width-only test wrongly treated portrait as roomy. Portrait always keeps the
  // single-column layout. Kept in sync with ActionTile's own copy of this check.
  const roomy = winWidth > winHeight && winWidth >= 700;
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

  // Real, 2026-08-10 - see AmbitUsbModule.ts's own setDateTime() comment for the mechanism
  // (cable Ambit3's proven 0x0300/0x0302 pair, or Kailash's real BLE-only 0x1201 pushes).
  // No status persists across screens - a one-shot "did it work" line is enough here.
  const [timeSyncBusy, setTimeSyncBusy] = useState(false);
  const [timeSyncMsg, setTimeSyncMsg] = useState<string | null>(null);
  const handleSyncTime = useCallback(async () => {
    setTimeSyncBusy(true);
    setTimeSyncMsg(null);
    // Real, 2026-08-10 ("why it does that? doesn't make much sense... after error we
    // should be able to try again") - USB isn't a persistent link in this app: every
    // other USB operation (handleSync via SyncService.ts, connectFlow's own device-info/
    // history read above) already does its own connect()-operate-disconnect() cycle
    // rather than assuming one stays open, because connectFlow() itself disconnects
    // right after the initial info/history read, before the user can tap anything.
    // This button inherited neither half of that - it assumed a connection that was
    // usually already gone by the time it was tappable, and failed the exact same way
    // on every retry since nothing ever reconnected. BLE has no such gap (the link
    // stays up until explicitly closed - see bleConnected's own comments), so only
    // reconnect for the USB path.
    const usingBle = bleConnectedRef.current;
    try {
      if (!usingBle) {
        await ambitConnect();
      }
      try {
        await setDateTime();
        setTimeSyncMsg(t.homeTimeSyncOk);
      } finally {
        if (!usingBle) {
          await ambitDisconnect().catch(() => {});
        }
      }
    } catch (e: any) {
      setTimeSyncMsg(t.homeTimeSyncFailed(e?.message ?? String(e)));
    } finally {
      setTimeSyncBusy(false);
    }
  }, [t]);

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
    } else {
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
          {/* Real, 2026-08-10 ("under the icon put AmbitApp and a funny quote... even for
              the logo") - the very first thing shown on launch, while the app is still
              looking for the watch. */}
          {phase === 'searching' && (
            <Text style={[styles.deviceFlowTagline, deviceFlowTaglineScale(deviceFlowScale), { color: theme.mutedText }]}>
              {t.homeTagline}
            </Text>
          )}
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
          {/* Activities are stored locally and don't depend on a device being
              connected — don't trap the user behind the search/timeout screen
              if all they want is to look at what's already synced. */}
          <Button label={t.viewActivities} onPress={() => navigation.navigate('LogList')} variant="text" grow={false} />
        </View>
        {/* Real, 2026-08-10 ("you can remove the pair device later, doesn't make sense") -
            "Connect device later" led to a whole separate near-empty screen whose only real
            purpose was reaching Settings without a device connected - that's reachable
            directly now, no detour through an extra phase. */}
        <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.75}>
          <Icon name="settings" size={19} color={theme.text} />
        </TouchableOpacity>
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
          <Button label={t.viewActivities} onPress={() => navigation.navigate('LogList')} variant="text" grow={false} />
        </View>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.75}>
          <Icon name="settings" size={19} color={theme.text} />
        </TouchableOpacity>
      </View>
    );
  }

  // phase === 'connected' from here on

  // v3.0 UI port - the persistent nav shell (NavRail.qml's real pattern: a fixed item list,
  // visibility gated by connected-device type, selection by string id). Garmin routes to
  // GarminRoute/GarminPoi (its own params-carrying screens, see App.tsx's RootStackParamList
  // comment on why those are separate from Route/Poi) instead of Ambit's Route/Poi. Kailash
  // excludes Routes/POIs/Sport Modes, same real reasoning as the ActionTile grid below already
  // encoded (Kailash's own memory map has no route-following feature or CustomModes region).
  const navItems: NavShellItem[] = [
    { id: 'home', label: t.homeNavHome, icon: 'mountain', onPress: () => {} },
    { id: 'activities', label: t.viewActivities, icon: 'list', onPress: () => navigation.navigate('LogList') },
    ...(deviceType === 'garmin'
      ? [
          { id: 'routes', label: t.homeRoutesBtn, icon: 'route' as const, onPress: () => garminInfo && navigation.navigate('GarminRoute', { info: garminInfo }) },
          { id: 'pois', label: t.homePoisBtn, icon: 'poi' as const, onPress: () => garminInfo && navigation.navigate('GarminPoi', { info: garminInfo }) },
        ]
      : !isKailash(ambitInfo)
        ? [
            { id: 'routes', label: t.homeRoutesBtn, icon: 'route' as const, onPress: () => navigation.navigate('Route') },
            { id: 'pois', label: t.homePoisBtn, icon: 'poi' as const, onPress: () => navigation.navigate('Poi') },
          ]
        : []),
    { id: 'backup', label: t.backupButton, icon: 'backup', onPress: () => navigation.navigate('Backup') },
    ...(deviceType === 'ambit' && !isKailash(ambitInfo)
      ? [{ id: 'sportModes', label: t.sportModesButton, icon: 'watch' as const, onPress: () => navigation.navigate('SportModes') }]
      : []),
    { id: 'settings', label: t.settingsTitle, icon: 'settings', onPress: () => navigation.navigate('Settings') },
  ];

  return (
    <NavShell items={navItems} selectedId="home">
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
      {/* Real, 2026-08-09 ("the icon of the watch could be like 20% bigger while in
          vertical, on horizontal is ok") - portrait-only scale-up; roomy (landscape+wide)
          keeps the original 40. Not tied to `roomy` itself since a narrow landscape phone
          is neither roomy nor portrait and should also keep the unscaled size.
          Real, 2026-08-10 ("icon: please make it 10% bigger") - a real Garmin eTrex
          connected live revealed the etrex glyph reads a little small next to the Suunto
          watch glyph at the same nominal size - a further 10% bump, on top of the same
          portrait/landscape scaling above, Garmin-only. */}
      <Icon
        name={deviceType === 'garmin' ? 'etrex' : 'watch'}
        size={Math.round((winWidth < winHeight ? 48 : 40) * (deviceType === 'garmin' ? 1.1 : 1))}
        color={theme.text}
      />

      {/* ── Device info cards. Portrait: one centered column. Roomy/landscape: a
          side-by-side wrapping row (each card sized to share the width), so the space
          is used instead of stretching one card per line. ── */}
      <View style={[styles.cardStack, roomy && styles.cardStackRoomy]}>
      {deviceType === 'garmin' && garminInfo && (() => {
        const vol = garminInfo.volumes.find(v => v.hasGarminDeviceXml) ?? garminInfo.volumes[0];
        return (
          <Card style={[roomy ? styles.deviceCardRoomy : styles.deviceCardCol, styles.deviceCardInner]}>
            <Text style={[styles.deviceName, v3TextStyle]}>{vol?.model ?? t.garminUnknownModel}</Text>
            {!!vol?.firmwareVersion && (
              <Text style={[styles.deviceSub, v3MutedStyle]}>{t.garminFirmwareLabel} {vol.firmwareVersion}</Text>
            )}
            <View style={styles.deviceMetaRow}>
              <Text style={[styles.deviceSub, v3MutedStyle]}>
                {garminInfo.hasSdCard ? t.garminSdCardPresent : t.garminSdCardAbsent}
              </Text>
              <Chip icon="check" label={t.homeDeviceConnectedStatus} />
            </View>
            {/* Real, 2026-08-11 (André: "I added etrex manuals to the files, can you link
                it to the supported devices?") - same mechanism as the Ambit manual link
                below, family-matched (garminManualUrlFor()) since Garmin's own model text
                doesn't map 1:1 the way Suunto codenames do. */}
            <TouchableOpacity
              style={styles.timeSyncRow}
              onPress={() => Linking.openURL(garminManualUrlFor(vol?.model))}
            >
              <Icon name="info" size={14} color={theme.primary} />
              <Text style={[styles.timeSyncText, { color: theme.primary }]}>
                {t.homeManualLink}
              </Text>
            </TouchableOpacity>
          </Card>
        );
      })()}
      {deviceType === 'ambit' && ambitInfo && (
        <Card style={[roomy ? styles.deviceCardRoomy : styles.deviceCardCol, styles.deviceCardInner]}>
          <Text style={[styles.deviceName, v3TextStyle]}>{ambitInfo.name}</Text>
          {!!(ambitInfo.fwVersion || ambitInfo.hwVersion) && (
            <Text style={[styles.deviceSub, v3MutedStyle]}>
              {ambitInfo.fwVersion ? `${t.garminFirmwareLabel} ${ambitInfo.fwVersion}` : ''}
              {ambitInfo.hwVersion ? `  ·  ${t.homeHwLabel} ${ambitInfo.hwVersion}` : ''}
            </Text>
          )}
          <View style={styles.deviceMetaRow}>
            {ambitInfo.battery >= 0 && (
              <View style={styles.deviceBattery}>
                <Icon name="battery" size={15} color={theme.mutedText} />
                <Text style={[styles.deviceBatteryText, v3MutedStyle]}>{ambitInfo.battery}%</Text>
              </View>
            )}
            <Chip icon="check" label={t.homeDeviceConnectedStatus} />
            {/* Real, 2026-08-09 ("via usb should be auto detected... bluetooth yes it needs
                a button") - desktop's own hero card never needed this (USB-only), but Android
                genuinely has two transports now, so the connected card says which one is
                live. bleConnected is the same ref this screen already uses to gate the USB
                watchdog/sync-provider choice - not a new signal invented for this label. */}
            <Chip icon={bleConnected ? 'link' : 'check'} label={t.homeConnVia(bleConnected ? t.homeConnViaBle : t.homeConnViaUsb)} />
          </View>
          {/* Real, 2026-08-10 - was gated off for cable Kailash while that path was
              unconfirmed; a real cable capture (kailashsynctimefrom...) then showed it's
              the exact same 0x1201 mechanism as BLE, just without the second NextTime
              push - no gating needed, device_driver_ambit3.c's date_time_set() dispatches
              correctly on either transport now. */}
          <TouchableOpacity
            style={styles.timeSyncRow}
            disabled={timeSyncBusy}
            onPress={handleSyncTime}
          >
            <Icon name="sync" size={14} color={theme.primary} />
            <Text style={[styles.timeSyncText, { color: theme.primary }]}>
              {timeSyncBusy ? t.connecting : (timeSyncMsg ?? t.homeSyncTimeButton)}
            </Text>
          </TouchableOpacity>
          {/* Real, 2026-08-11 (André: "put the manual next to hardware") - opens the real
              Suunto user-guide PDF for whichever model is connected (manualUrlFor(),
              config/manuals.ts - same table as desktop's HomeViewModel.qml manualUrl) in
              the OS's own PDF viewer/browser, same Linking.openURL() mechanism as any other
              "open outside the app" action here. */}
          <TouchableOpacity
            style={styles.timeSyncRow}
            onPress={() => Linking.openURL(manualUrlFor(ambitInfo.model))}
          >
            <Icon name="info" size={14} color={theme.primary} />
            <Text style={[styles.timeSyncText, { color: theme.primary }]}>
              {t.homeManualLink}
            </Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* ── Kailash travel history - real, 2026-08-08 ("if we could import this data
          which is on the watch and read it to our app would be awesome"). Restyled onto
          the theme-redesign's own deviceCard pattern (2026-08-08 merge) - same as the
          ambitInfo card just above: deviceName for the title, deviceSub (repeated) for
          each muted detail line, rather than the pre-redesign deviceInfoBox styles this
          screen no longer defines. ── */}
      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashHistory && (
        <Card style={[roomy ? styles.deviceCardRoomy : styles.deviceCardCol, styles.deviceCardInner]}>
          <Text style={[styles.deviceName, v3TextStyle]}>{t.homeKailashTravelTitle}</Text>
          <Text style={[styles.deviceSub, v3MutedStyle]}>
            {t.homeKailashCitiesLabel} {kailashHistory.citiesVisited}
            {'  ·  '}{t.homeKailashCountriesLabel} {kailashHistory.countriesVisited}
          </Text>
          {kailashHistory.hasLastKnownLocation && (
            <Text style={[styles.deviceSub, v3MutedStyle]}>
              {kailashHistory.lastKnownLatitude.toFixed(4)}, {kailashHistory.lastKnownLongitude.toFixed(4)}
              {kailashHistory.lastKnownCountry ? ` (${kailashHistory.lastKnownCountry})` : ''}
            </Text>
          )}
          <Text style={[styles.deviceSub, v3MutedStyle]}>
            {t.homeKailashTravelledLabel} {(kailashHistory.travelledDistanceMeters / 1000).toFixed(1)} km
            {'  ·  '}{t.homeKailashFurthestLabel} {(kailashHistory.furthestFromHomeMeters / 1000).toFixed(1)} km
          </Text>
          {kailashHistory.sessions.length > 0 && (
            <Text style={[styles.deviceSub, v3MutedStyle]}>
              {t.homeKailashLogbookLabel} {kailashHistory.sessions.length}
            </Text>
          )}
        </Card>
      )}

      {/* ── Kailash visited-places world map - real, 2026-08-10 ("desktop version has more
          functions that were not passed to the android version, like for example the map
          with locations, can you implement it please?"). Ports desktop HomePage.qml's own
          MapView(markers: KailashService.visitedPlaces) - multiMarker mode (TrackPreview.tsx's
          own header comment) so each visited place gets its own dot instead of a nonsense
          polyline connecting unrelated cities in array order. ── */}
      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashHistory && kailashHistory.visitedPlaces.length > 0 && (
        <Card style={[roomy ? styles.deviceCardRoomy : styles.deviceCardCol, styles.deviceCardInner]}>
          <Text style={[styles.deviceName, v3TextStyle]}>
            {t.homeKailashPlacesTitle(kailashHistory.visitedPlaces.length)}
          </Text>
          <TrackPreview points={kailashHistory.visitedPlaces} multiMarker height={160} />
        </Card>
      )}

      {deviceType === 'ambit' && isKailash(ambitInfo) && kailashTrack && (
        <Card style={[roomy ? styles.deviceCardRoomy : styles.deviceCardCol, styles.deviceCardInner]}>
          <Text style={[styles.deviceName, v3TextStyle]}>{t.homeKailashTrackTitle}</Text>
          <Text style={[styles.deviceSub, v3MutedStyle]}>
            {realTrackPoints(kailashTrack).length} {t.homeKailashTrackPoints}
          </Text>
          <Button
            label={t.homeKailashTrackExport}
            onPress={handleExportKailashTrack}
            disabled={kailashExportBusy}
            grow={false}
          />
        </Card>
      )}
      </View>

      {/* ── Weather - real, 2026-08-09 (v3.0 UI port, "replicate the desktop version
          feature wise"). Same real placement as HomePage.qml: right after the device hero
          card(s), before the actions row. Collapses to nothing on its own (renders null)
          until the first fetch attempt finishes, same as WeatherCard.qml's own
          hasFetchedOnce gate.
          Real bug, found live ("something looks bizarre, sizing wise they are not the
          same, and we have all this space on the borders") - WeatherCard's own Card had no
          width cap of its own, so on a wide tablet it stretched to the ScrollView's full
          width while every card above it (deviceCardCol/cardStackRoomy) is capped -
          differently-sized cards stacked directly on top of each other. Follow-up ("on
          horizontal, the device info and weather are not the same width") - a flat
          CONTENT_MAX_WIDTH cap alone only matched portrait: roomy mode's device card(s) sit
          in cardStackRoomy, capped at 960 not CONTENT_MAX_WIDTH, so weatherWrap now follows
          the exact same roomy switch cardStack itself uses, instead of a single fixed cap. ── */}
      <View style={[styles.weatherWrap, roomy && styles.weatherWrapRoomy]}>
        <WeatherCard />
      </View>

      {/* ── Actions : uniquement les actions réelles (sync/GPS) - Routes/POIs/Backup/
          Sport Modes/Settings sont maintenant des destinations du NavShell ci-dessus,
          pas des actions sur cette carte (v3.0 UI port, 2026-08-09). ── */}
      {deviceType === 'garmin' ? (
        <View style={[styles.actionsRow, roomy && styles.actionsRowRoomy]}>
          <ActionTile
            icon="sync"
            label={garminSyncLabel}
            progress={garminSync.phase === 'writing' && garminSync.total > 0 ? `${garminSync.current}/${garminSync.total}` : undefined}
            busy={garminSyncBusy}
            onPress={() => handleGarminSync()}
            disabled={isBusy}
            grow
          />
        </View>
      ) : (
        <View style={[styles.actionsRow, roomy && styles.actionsRowRoomy]}>
          <ActionTile
            icon="sync"
            label={syncLabel}
            progress={sync.phase !== 'idle' && sync.total > 0 ? `${sync.current}/${sync.total}` : undefined}
            busy={syncBusy}
            onPress={handleSync}
            disabled={isBusy}
            grow
          />
          <ActionTile
            icon="satellite"
            label={orbitalLabel}
            grow
            busy={orbitalBusy}
            onPress={handleOrbital}
            disabled={isBusy}
          />
        </View>
      )}

      {/* ── Statut ── */}
      <StatusLine text={statusText} tone={statusTone} />

    </ScrollView>
    </NavShell>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deviceFlowTitleScale(scale: number) {
  return { fontSize: Math.round(16 * scale), lineHeight: Math.round(23 * scale) };
}

function deviceFlowTaglineScale(scale: number) {
  return { fontSize: Math.round(12.5 * scale) };
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

function createStyles(t: ReturnType<typeof useV3Theme>) {
  return StyleSheet.create({
    // The connected screen scrolls (a lot of content: device cards + a 2-column tile
    // grid + footer), so on short/landscape screens nothing clips.
    scroll: {
      flex: 1,
      backgroundColor: t.background,
    },
    // Real bug, found live ("on vertical there is a lot of space between the
    // cards...guess it may be 'replicating' something from horizontal") - this was
    // copy-pasted from `container` (used by the sparse pre-connect device-flow screens,
    // where space-between + flexGrow really is the layout: a handful of items centered
    // and spread across a mostly-empty screen). The connected dashboard has real,
    // differently-sized content (device cards, weather, a tile grid, a status line) -
    // space-between distributed ALL leftover portrait screen height between those few
    // children, stretching the gaps between them far past what any of them needed. A
    // fixed gap between sections, no artificial full-height spreading, fixes it.
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      gap: 24,
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
    // Real, 2026-08-10 ("the initial screen while we are waiting for devices to connect
    // has a big mix of type of letters, sizes, can you uniformize it") - deviceFlowTitle
    // had no explicit fontWeight at all (defaulting to regular, 400), looking flimsy next
    // to the wordmark's own bold 800 right above it; the tagline was italic (the only
    // italic text anywhere in this app) and didn't scale with deviceFlowScale the way the
    // wordmark/title/badge all do, so it looked disproportionately small on a tablet. Both
    // fixed: one consistent weight scheme (wordmark 800 > title 600 > tagline 500 > badge
    // 700, small-pill convention) and one consistent scale factor throughout.
    deviceFlowTitle: {
      color: t.mutedText,
      fontWeight: '600',
      fontSize: 16,
      textAlign: 'center',
      lineHeight: 23,
    },
    deviceFlowError: {
      color: t.error,
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
    deviceFlowTagline: {
      fontWeight: '500',
      fontSize: 12.5,
      textAlign: 'center',
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
    // Wrapper around the device-info cards. Portrait: a centered column. Roomy: a
    // centered wrapping row so the cards sit side by side (see cardStackRoomy).
    cardStack: {
      width: '100%',
      alignItems: 'center',
      gap: 8,
    },
    cardStackRoomy: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      maxWidth: 960,
      justifyContent: 'center',
      alignItems: 'stretch',
      gap: 10,
    },
    // v3.0 UI port - the old flat-theme surface (background/border) is gone; Card supplies
    // its own v3-palette background/radius/shadow now. This keeps only what's still real
    // layout, not color: centering the card's own content.
    deviceCardInner: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Portrait: one full-width card per row, capped so it doesn't stretch on a tablet.
    deviceCardCol: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
    },
    // Roomy: cards share the row, ~3 across (min 250 so they wrap to 2 when narrower).
    deviceCardRoomy: {
      flexBasis: '31%',
      flexGrow: 1,
      minWidth: 250,
    },
    // Same cap as deviceCardCol - see the JSX comment above on why WeatherCard needed this
    // (it's the only card on this screen that wasn't already capped to CONTENT_MAX_WIDTH).
    weatherWrap: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
    },
    // roomy: matches cardStackRoomy's own 960 cap, same reasoning as deviceCardRoomy above.
    weatherWrapRoomy: {
      maxWidth: 960,
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
      color: t.mutedText,
      fontSize: 11,
      fontWeight: '600',
    },
    deviceSub: {
      color: t.mutedText,
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
    timeSyncRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 10,
    },
    timeSyncText: {
      fontSize: 12,
      fontWeight: '600',
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
    // Roomy: widen the tile grid to match the side-by-side cards (tiles go 3 columns,
    // handled inside ActionTile's own width check).
    actionsRowRoomy: {
      maxWidth: 960,
    },
    settingsBtn: {
      width: 52,
      height: 52,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.mutedText + '33',
      backgroundColor: t.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
