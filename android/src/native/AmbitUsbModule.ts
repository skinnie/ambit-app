import { NativeModules, NativeEventEmitter } from 'react-native';
import type { DeviceConnector, DeviceInfo, SyncProgressEvent } from './DeviceConnector';

const { AmbitUsbModule: NativeAmbit } = NativeModules;

if (!NativeAmbit) {
  throw new Error(
    'AmbitUsbModule natif introuvable. ' +
    'Vérifiez que AmbitUsbPackage est bien enregistré dans MainApplication.kt ' +
    'et que le build NDK a réussi.'
  );
}

// ─── Re-export des types génériques ───────────────────────────────────────────

export type { DeviceInfo, SyncProgressEvent };

// ─── Implémentation DeviceConnector pour Suunto Ambit (USB OTG + libambit) ───

const emitter = new NativeEventEmitter(NativeAmbit);

/**
 * Connecteur Suunto Ambit — implémente DeviceConnector.
 * Supporte Ambit 1, 2, 2S, 2R, 3 Peak, 3 Sport, 3 Run, 3 Vertical.
 */
export const ambitConnector: DeviceConnector = {
  connect(): Promise<DeviceInfo> {
    return NativeAmbit.connect();
  },

  disconnect(): Promise<void> {
    return NativeAmbit.disconnect();
  },

  getLogs(knownIds: string[] = []): Promise<string[]> {
    return NativeAmbit.getLogs(knownIds);
  },

  updateSgee(path: string): Promise<boolean> {
    return NativeAmbit.updateSgee(path);
  },

  onSyncProgress(callback: (event: SyncProgressEvent) => void): () => void {
    const subscription = emitter.addListener('AmbitSyncProgress', callback);
    return () => subscription.remove();
  },
};

// ─── API fonctionnelle (rétro-compatibilité) ──────────────────────────────────

// Transport-awareness (2026-08-09): every watch operation (sync, POI, orbital,
// sport modes, route) calls connect()/disconnect() around its native call, and
// the native operations themselves act on the shared g_device regardless of
// transport. So the ONLY thing that made these USB-only was connect() opening a
// USB device. When a BLE connection is already established (AmbitBleModule set
// this flag), connect() must be a no-op that returns the info already learned
// from the BLE handshake, and disconnect() must leave the BLE link up (the Home
// screen owns its lifecycle). Making that switch HERE means every existing
// service works over BLE with zero changes to it.
let bleActive = false;
export function setBleTransportActive(active: boolean) { bleActive = active; }
export function isBleTransportActive() { return bleActive; }

export const connect = async (): Promise<DeviceInfo> => {
  if (bleActive) {
    try {
      const info = await NativeAmbit.getDeviceInfo();
      return { name: info?.name || 'Suunto Ambit', vendorId: 0x1493, productId: 0 };
    } catch {
      return { name: 'Suunto Ambit', vendorId: 0x1493, productId: 0 };
    }
  }
  return ambitConnector.connect();
};
export const disconnect = async (): Promise<void> => {
  if (bleActive) return;           // leave the BLE link up; HomeScreen manages it
  return ambitConnector.disconnect();
};
export const getLogs    = (knownIds?: string[]) => ambitConnector.getLogs(knownIds);
export const updateSgee = (path: string) => ambitConnector.updateSgee!(path);
export const onSyncProgress = (cb: (e: SyncProgressEvent) => void) =>
  ambitConnector.onSyncProgress(cb);

export function shareFile(filePath: string, mimeType = 'application/gpx+xml'): Promise<void> {
  return NativeAmbit.shareFile(filePath, mimeType);
}

export function saveToDownloads(filePath: string, fileName: string, mimeType = 'application/gpx+xml'): Promise<void> {
  return NativeAmbit.saveToDownloads(filePath, fileName, mimeType);
}

/** Opens the system "Save as" picker (Storage Access Framework), defaulting to
 * the Downloads folder — the user can browse elsewhere, but accepting the
 * picker's default is equivalent to saveToDownloads(). Resolves with the
 * chosen destination's content:// URI, or rejects with SAVE_AS_CANCELLED if
 * the user backs out. */
export function saveFileAs(sourcePath: string, suggestedName: string, mimeType: string): Promise<string> {
  return NativeAmbit.saveFileAs(sourcePath, suggestedName, mimeType);
}

// ─── Navigation (GPX-to-watch route write) ────────────────────────────────────

/** Ouvre le sélecteur de fichiers Android et renvoie le chemin local du fichier copié. */
export function pickGpxFile(): Promise<string> {
  return NativeAmbit.pickGpxFile();
}

export interface NativeRoutePoint {
  lat: number;
  lon: number;
  alt: number | null; // null -> AMBIT3_ALTITUDE_NONE côté natif
}

export interface NativeRouteWaypoint {
  lat: number;
  lon: number;
  name: string;
  pointIndex: number; // rang du point de route auquel ce waypoint est rattaché
}

export interface NativeRoute {
  name: string;
  points: NativeRoutePoint[];      // déjà simplifiés, <= 1000 (voir RouteSimplify.ts)
  waypoints: NativeRouteWaypoint[]; // au moins 1, sinon la route n'apparaît pas sur la montre
  distanceM: number;
  ascentM: number;
  descentM: number;
  timestampSec: number; // timestamp Unix réel ; la conversion vers l'epoch de la montre se fait côté natif
}

/** La montre doit déjà être connectée (connect() appelé avant). */
export function writeRoute(route: NativeRoute): Promise<boolean> {
  return NativeAmbit.writeRoute(route);
}

/**
 * Ajoute un POI, en préservant ceux déjà présents sur la montre.
 * La montre doit déjà être connectée (connect() appelé avant).
 */
export function addPoi(name: string, lat: number, lon: number): Promise<boolean> {
  return NativeAmbit.addPoi(name, lat, lon);
}

/**
 * Lit `length` octets à `address` sur la montre, renvoyés en base64.
 * Lecture seule, aucun risque pour la montre. Décodage côté TS (RouteReader.ts).
 * La montre doit déjà être connectée (connect() appelé avant).
 */
export function readRegion(address: number, length: number): Promise<string> {
  return NativeAmbit.readRegion(address, length);
}

/**
 * Lit la liste brute des POI (0x0b24) en base64, entrées SBEM0102 incluses.
 * Décodage côté TS (PoiService.ts). La montre doit déjà être connectée.
 */
export function readPoiListRaw(): Promise<string> {
  return NativeAmbit.readPoiListRaw();
}

/**
 * Kailash only. Reads the watch's raw sml.DeviceHistory reply (0x1200, entry 0x67) in
 * base64 - visited cities/countries, travel stats, and a real activity-mode logbook bundled
 * in the same reply. Decoding happens in TS (KailashHistoryReader.ts), the same split
 * readPoiListRaw() above already uses. The watch must already be connected.
 */
export function readDeviceHistoryRaw(): Promise<string> {
  return NativeAmbit.readDeviceHistoryRaw();
}

/**
 * Kailash test hook (2026-08-09). Reads the watch's raw sml.DeviceLog reply
 * (0x1200, entry 0x53) in base64 — the ephemeral per-activity GPS sample store,
 * distinct from readDeviceHistoryRaw()'s persistent 0x67 summaries. Exists to
 * confirm KAILASH-BLE-FINDINGS.md Finding 7 live over BLE; no decoder yet, a
 * non-empty result is the signal. The watch must already be connected.
 */
export function readDeviceLogRaw(): Promise<string> {
  return NativeAmbit.readDeviceLogRaw();
}

/**
 * Ambit3 (and Traverse/Ambit2, same schema family). Reads the watch's raw
 * sml.DeviceSettings reply (0x1100, four zero bytes) in base64. Decoding happens in TS
 * (AmbitSettingsReader.ts). The watch must already be connected.
 */
export function readSettingsRaw(): Promise<string> {
  return NativeAmbit.readSettingsRaw();
}

/**
 * Real, hardware-confirmed 2026-08-08: writes a full sml.DeviceSettings blob back via
 * 0x1101 - André confirmed on a real connected Ambit3's own screen that this exact
 * mechanism visibly switched the display Light -> Dark. `dataBase64` must be the *entire*
 * settings blob (read via readSettingsRaw(), patch one field, send the whole thing back) -
 * see AmbitSettingsWriter.ts's own writeSetting() for that dance. Resolving `true` here
 * only means the write was sent without error - it does NOT by itself confirm the watch
 * applied it; the caller re-reads to check, matching this project's own "prove it, don't
 * just trust the ACK" rule found necessary during live testing.
 */
export function writeSettingsRaw(dataBase64: string): Promise<boolean> {
  return NativeAmbit.writeSettingsRaw(dataBase64);
}

/**
 * Real, 2026-08-08. Reads the watch's raw 12288-byte CustomModes region (sport modes) in
 * base64 - the same region tools/custom_modes.py already reads. Decoding happens in TS
 * (CustomModesReader.ts). The watch must already be connected.
 */
export function readCustomModesRaw(): Promise<string> {
  return NativeAmbit.readCustomModesRaw();
}

/**
 * Real mechanism, NOT yet hardware-confirmed on Android specifically - see
 * ambit3_write_custom_modes_raw()'s own comment in device_driver_ambit3.c for exactly what
 * is and isn't proven (the desktop side of this same write mechanism is fully confirmed
 * working - custom_modes_andre.md; this native Android port reuses the same proven
 * building blocks but the composition itself hasn't been tested on this platform yet).
 * `dataBase64` must be the *entire* 12288-byte region (read first, patch specific bytes,
 * send the whole thing back). Resolving `true` only means the write+tail+commit sequence
 * completed without a protocol-level failure - it does NOT confirm the watch's live state
 * reflects it; the caller re-reads to check, the same "prove it" rule already established.
 */
export function writeCustomModesRaw(dataBase64: string): Promise<boolean> {
  return NativeAmbit.writeCustomModesRaw(dataBase64);
}

// ─── Auto-sync on USB attach ───────────────────────────────────────────────────
// AndroidManifest.xml (launchMode="singleTask" + USB_DEVICE_ATTACHED intent-filter
// + device_filter.xml) already lets the OS launch/foreground the app when the
// watch is plugged in. Two cases:
//  - cold launch: query once on mount (wasLaunchedViaUsbAttach) — an emitted event
//    this early could race a JS listener that hasn't subscribed yet.
//  - already running: MainActivity.onNewIntent() emits "AmbitUsbAttached" live.

/** Was this app instance launched (or brought to front) by the watch being plugged in? */
export function wasLaunchedViaUsbAttach(): Promise<boolean> {
  return NativeAmbit.wasLaunchedViaUsbAttach();
}

/** Fires when the watch is plugged in while the app is already running. */
export function onUsbAttached(callback: () => void): () => void {
  const subscription = emitter.addListener('AmbitUsbAttached', callback);
  return () => subscription.remove();
}

/** v2.3 beta — USB_DEVICE_ATTACHED now fires for Garmin devices too (see
 * device_filter.xml), so it no longer implies "an Ambit was plugged in" by
 * itself. Call this before routing to either device's flow. */
export type AttachedDeviceType = 'ambit' | 'garmin' | 'none';
export function detectAttachedDeviceType(): Promise<AttachedDeviceType> {
  return NativeAmbit.detectAttachedDeviceType();
}

// ─── Device info (v2.3.2 beta) ─────────────────────────────────────────────────

export interface AmbitDeviceInfo {
  name: string;        // e.g. "Suunto Ambit3 Sport" — from the known-PID table
  model: string;        // from the watch's own device-info reply
  serial: string;
  fwVersion: string;    // "X.Y.Z"
  hwVersion: string;    // "X.Y.Z"
  battery: number;      // percent, or -1 if the read failed
}

/** Model, serial, firmware/hardware version, and a live battery read.
 * The watch must already be connected (connect() called first). */
export function getDeviceInfo(): Promise<AmbitDeviceInfo> {
  return NativeAmbit.getDeviceInfo();
}
