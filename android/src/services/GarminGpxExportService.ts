import RNFS from 'react-native-fs';
import * as Garmin from '../native/GarminModule';
import type { GarminConnectResult } from '../native/GarminModule';
import { saveToDownloads } from '../native/AmbitUsbModule';

/*
 * v2.3.2 beta — shared by GarminRouteScreen's "Export routes" and
 * GarminPoiScreen's "Retrieve POIs": both read plain .gpx files sitting
 * directly in a volume's Garmin/GPX folder (not the Current/ subfolder,
 * which is recorded activities — see GarminActivityService.ts for that) and
 * save them to Downloads. The only difference is which files match:
 * "Waypoints*.gpx" is BaseCamp's POI naming (confirmed on real hardware,
 * see GARMIN_USB_IMPORT_SPEC.md); everything else here is a saved
 * route/track. Scans every volume — "Device and sdcard" per André's spec,
 * not just the one carrying GarminDevice.xml.
 */

export interface GarminGpxExportResult {
  fileName: string;   // as saved to Downloads (volume-prefixed to avoid collisions)
  localPath: string;  // for the "share / choose location" follow-up action
}

export interface GarminGpxExportState {
  phase: 'idle' | 'reading' | 'done' | 'error';
  count?: number;
  error?: string;
}

export async function exportGarminGpxFiles(
  info: GarminConnectResult,
  isMatch: (fileName: string) => boolean,
  onState: (s: GarminGpxExportState) => void
): Promise<GarminGpxExportResult[]> {
  onState({ phase: 'reading' });
  const results: GarminGpxExportResult[] = [];

  try {
    for (const vol of info.volumes) {
      const prefix = vol.hasGarminDeviceXml ? 'device' : 'sdcard';
      let files: string[];
      try {
        files = await Garmin.listGpxDirFiles(vol.volumeIndex);
      } catch {
        continue; // this volume has no Garmin/GPX folder — not an error, just nothing to export
      }
      for (const fileName of files.filter(isMatch)) {
        try {
          const content = await Garmin.readGpxDirFile(vol.volumeIndex, fileName);
          const savedName = `${prefix}_${fileName}`;
          const localPath = `${RNFS.CachesDirectoryPath}/${savedName}`;
          await RNFS.writeFile(localPath, content, 'utf8');
          await saveToDownloads(localPath, savedName, 'application/gpx+xml');
          results.push({ fileName: savedName, localPath });
        } catch {
          // one bad file shouldn't abort the whole export — skip it, keep going
        }
      }
    }
    onState({ phase: 'done', count: results.length });
    return results;
  } catch (e: any) {
    onState({ phase: 'error', error: e?.message ?? 'Export failed' });
    return results;
  }
}

/** BaseCamp's POI-file naming, confirmed on real hardware — see GARMIN_USB_IMPORT_SPEC.md. */
export function isGarminWaypointFile(fileName: string): boolean {
  return /^waypoints/i.test(fileName);
}

/** Anything in Garmin/GPX that isn't a Waypoints* POI file is a saved route/track. */
export function isGarminRouteFile(fileName: string): boolean {
  return !isGarminWaypointFile(fileName);
}
