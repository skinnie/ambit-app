import { NativeModules, NativeEventEmitter } from 'react-native';

const { GarminModule: NativeGarmin } = NativeModules;

if (!NativeGarmin) {
  throw new Error(
    'GarminModule native module not found. ' +
    'Check that GarminPackage is registered in MainApplication.kt ' +
    'and that the libaums Gradle dependency resolved.'
  );
}

/**
 * v2.3 beta — Garmin USB Mass Storage support. See GARMIN_USB_IMPORT_SPEC.md.
 *
 * Garmin devices work completely differently from the Ambit3 (plain GPX files on
 * a FAT filesystem, not an NSP flash protocol) — this is a separate device
 * integration, not an extension of AmbitUsbModule.
 */

export interface GarminVolumeInfo {
  volumeIndex: number;
  hasGarminDeviceXml: boolean;
  model: string | null;
  firmwareVersion: string | null; // e.g. "5.01" — already formatted, see GarminModule.kt
  partNumber: string | null;
  activityPath: string | null; // resolved from GarminDevice.xml, e.g. "Garmin/GPX/Current"
}

export interface GarminConnectResult {
  volumes: GarminVolumeInfo[];
  hasSdCard: boolean; // heuristic: a volume without GarminDeviceXml alongside one that has it
}

const emitter = new NativeEventEmitter(NativeGarmin);

/** Fires while connect() is retrying — Garmin devices can take up to ~40s to
 * finish mounting after the USB link comes up (real-world reference: see
 * GARMIN_USB_IMPORT_SPEC.md), so connect() polls rather than failing fast. */
export interface GarminMountWaitingEvent {
  attempt: number;
  secondsLeft: number;
}
export function onMountWaiting(callback: (e: GarminMountWaitingEvent) => void): () => void {
  const subscription = emitter.addListener('GarminMountWaiting', callback);
  return () => subscription.remove();
}

/** Finds a connected Garmin device, requests USB permission if needed, and mounts
 * every volume it exposes (internal memory + SD card show up separately). Retries
 * internally for up to ~45s — see onMountWaiting() to show progress meanwhile. */
export function connect(): Promise<GarminConnectResult> {
  return NativeGarmin.connect();
}

/** Lists activity file names in the given volume's resolved activity folder
 * (GarminConnectResult.volumes[i].activityPath). Content, not just names — use
 * readActivityFile() next. */
export function listActivityFiles(volumeIndex: number): Promise<string[]> {
  return NativeGarmin.listActivityFiles(volumeIndex);
}

/** Reads one activity file's full text content (GPX is plain XML) — parse the
 * result with RouteGpxParser.ts/GpxParser.ts, same as any other GPX source. */
export function readActivityFile(volumeIndex: number, fileName: string): Promise<string> {
  return NativeGarmin.readActivityFile(volumeIndex, fileName);
}

/** Lists .gpx file names directly inside `<volume>/Garmin/GPX` (not recursive —
 * Current/'s activity files are excluded automatically). This is where saved
 * routes/tracks and BaseCamp-authored "Waypoints*.gpx" POI files live. */
export function listGpxDirFiles(volumeIndex: number): Promise<string[]> {
  return NativeGarmin.listGpxDirFiles(volumeIndex);
}

/** Reads one file's content from `<volume>/Garmin/GPX` (see listGpxDirFiles()). */
export function readGpxDirFile(volumeIndex: number, fileName: string): Promise<string> {
  return NativeGarmin.readGpxDirFile(volumeIndex, fileName);
}

/**
 * Writes a GPX file (route or POI — same mechanism, see GARMIN_USB_IMPORT_SPEC.md)
 * to `<volume>/Garmin/GPX/<fileName>`.
 *
 * SAFETY: refuses (GARMIN_REFUSED_INTERNAL_WRITE) if `volumeIndex` refers to the
 * internal-memory volume — confirmed with André, 2026-08-07: never write to
 * internal memory, no exceptions. Only ever call this with an SD-card volume's
 * index (GarminConnectResult.volumes[i] where hasGarminDeviceXml === false).
 */
export function writeGpxToSdCard(volumeIndex: number, fileName: string, gpxContent: string): Promise<boolean> {
  return NativeGarmin.writeGpxToSdCard(volumeIndex, fileName, gpxContent);
}

export function disconnect(): Promise<boolean> {
  return NativeGarmin.disconnect();
}
