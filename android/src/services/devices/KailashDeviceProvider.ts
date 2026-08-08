// ─── KailashDeviceProvider ────────────────────────────────────────────────────
// DeviceProvider for the Suunto Kailash ("Hoopoe") - real, 2026-08-08 ("Yes I want to
// implement it both to desktop and android version"). Kailash has no sport-mode logbook or
// ExerciseLog flash region the way Ambit3 does (confirmed from the watch's own real memory
// map - see the companion research project's custom_modes_andre.md), so unlike
// AmbitDeviceProvider it doesn't call the native ExerciseLog/PMEM20 walker at all: getLogs()
// reads the real TrackLog region directly (readRegion(), the same generic primitive
// RouteReader.ts already uses) and decodes it in TS (KailashTrackLogReader.ts).
//
// connect()/disconnect() are unchanged from the Ambit path - Kailash already answers the
// same USB init + 0x0000 device-info commands (AmbitUsbModule.kt's SUUNTO_PID_NAMES/
// device_filter.xml both now include its real product ID, 0x002a) - only the log-reading
// step differs. This is why HomeScreen.tsx doesn't need a third `detectAttachedDeviceType()`
// branch: Kailash already comes back as "ambit" from that check (any known Suunto PID does),
// and only routes to this provider once getDeviceInfo().model says "Hoopoe" - see
// HomeScreen.tsx's own comment at the point it picks between ambitDeviceProvider and this.

import * as AmbitUsbModule from '../../native/AmbitUsbModule';
import { DeviceProvider, DeviceInfo } from './DeviceProvider';
import { SyncProgressEvent } from '../../native/AmbitUsbModule';
import { decodeTrackLogToGpx, KAILASH_TRACKLOG_BASE, KAILASH_TRACKLOG_SIZE } from '../KailashTrackLogReader';

export class KailashDeviceProvider implements DeviceProvider {
  readonly deviceName = 'Suunto Kailash';

  connect(): Promise<DeviceInfo> {
    return AmbitUsbModule.connect();
  }

  disconnect(): Promise<void> {
    return AmbitUsbModule.disconnect();
  }

  // knownIds is intentionally unused: TrackLog is one continuous passive-tracking buffer,
  // not a per-session logbook to filter - SyncService.ts's own isActivitySynced(id) check
  // (keyed off the GPX's <metadata><time>, the first real point's own timestamp) already
  // skips writing it again if that hasn't changed since the last sync.
  async getLogs(): Promise<string[]> {
    const b64 = await AmbitUsbModule.readRegion(KAILASH_TRACKLOG_BASE, KAILASH_TRACKLOG_SIZE);
    const gpx = decodeTrackLogToGpx(b64);
    return gpx ? [gpx] : [];
  }

  onSyncProgress(_callback: (event: SyncProgressEvent) => void): () => void {
    // No incremental native progress event exists for a plain readRegion() call (unlike the
    // native ExerciseLog walker's own per-log callback) - honestly reporting nothing rather
    // than fabricating fake progress ticks. SyncService.ts's own UI already tolerates a
    // fetching phase with no progress events (it starts current/total at 0 and only updates
    // them if an event actually fires).
    return () => {};
  }
}

export const kailashDeviceProvider = new KailashDeviceProvider();
