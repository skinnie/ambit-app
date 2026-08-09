import RNFS from 'react-native-fs';
import * as Garmin from '../native/GarminModule';
import type { GarminConnectResult } from '../native/GarminModule';
import { saveToDownloads } from '../native/AmbitUsbModule';
import { parseRouteGpx, parseGpxWaypoints, RouteWaypoint } from './RouteGpxParser';
import { computeDistanceAscentDescent } from './NavigationService';

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

// Real, 2026-08-10 ("Garmin: POIs and routes, please follow the same logic as suunto,
// showing them on the maps") - a real Garmin connected live surfaced that GarminRoute/
// PoiScreen only ever offered "export everything to Downloads", no browsable "On the
// device" list with a map preview the way RouteScreen/PoiScreen already have for Suunto.
// Same real files (Garmin/GPX/*.gpx) as exportGarminGpxFiles above, just parsed for
// display (RouteGpxParser.ts's parseRouteGpx/parseGpxWaypoints - the same real parsers
// Suunto's own pending-route-preview and GPX-import flows already use) instead of only
// ever being saved straight to Downloads unseen.

export interface GarminRoutePreview {
  fileName: string;
  volumeIndex: number;
  name: string;
  points: { lat: number; lon: number }[];
  distanceM: number;
  ascentM: number;
  descentM: number;
}

export async function listGarminRoutePreviews(info: GarminConnectResult): Promise<GarminRoutePreview[]> {
  const results: GarminRoutePreview[] = [];
  for (const vol of info.volumes) {
    let files: string[];
    try {
      files = await Garmin.listGpxDirFiles(vol.volumeIndex);
    } catch {
      continue;
    }
    for (const fileName of files.filter(isGarminRouteFile)) {
      try {
        const content = await Garmin.readGpxDirFile(vol.volumeIndex, fileName);
        const parsed = parseRouteGpx(content, fileName.replace(/\.gpx$/i, ''));
        const { distanceM, ascentM, descentM } = computeDistanceAscentDescent(parsed.points);
        results.push({
          fileName, volumeIndex: vol.volumeIndex, name: parsed.name,
          points: parsed.points.map(p => ({ lat: p.latitude, lon: p.longitude })),
          distanceM, ascentM, descentM,
        });
      } catch {
        // one bad/unparseable file shouldn't hide every other real route - skip it
      }
    }
  }
  return results;
}

export interface GarminPoiPreview {
  fileName: string;
  volumeIndex: number;
  waypoint: RouteWaypoint;
}

export async function listGarminPoiPreviews(info: GarminConnectResult): Promise<GarminPoiPreview[]> {
  const results: GarminPoiPreview[] = [];
  for (const vol of info.volumes) {
    let files: string[];
    try {
      files = await Garmin.listGpxDirFiles(vol.volumeIndex);
    } catch {
      continue;
    }
    for (const fileName of files.filter(isGarminWaypointFile)) {
      try {
        const content = await Garmin.readGpxDirFile(vol.volumeIndex, fileName);
        for (const waypoint of parseGpxWaypoints(content)) {
          results.push({ fileName, volumeIndex: vol.volumeIndex, waypoint });
        }
      } catch {
        // one bad/unparseable file shouldn't hide every other real POI - skip it
      }
    }
  }
  return results;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A single waypoint as its own standalone GPX file - for GarminPoiScreen's per-item
 * Export (a POI file on the device may hold several waypoints; exporting just the one
 * being looked at, not the whole file, matches PoiService.ts's own exportSinglePoiToGpx). */
export function waypointToGpx(wp: RouteWaypoint): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="AmbitApp" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <wpt lat="${wp.latitude.toFixed(7)}" lon="${wp.longitude.toFixed(7)}"><name>${escapeXml(wp.name)}</name></wpt>\n</gpx>`;
}
