import RNFS from 'react-native-fs';
import { Share } from 'react-native';
import { TrackPoint } from './GpxParser';

const EXPORT_DIR = `${RNFS.DocumentDirectoryPath}/exports`;

/**
 * Génère un fichier XML au format Vikazimut (CO) depuis un tableau de points GPS.
 *
 * Format Vikazimut : XML propriétaire utilisé par la plateforme française
 * de course d'orientation Vikazimut (vikazimut.com).
 * Chaque point est un <pt> avec attributs lat, lon, alt, t (timestamp Unix en s).
 */
export async function exportToVikazimut(
  points: TrackPoint[],
  activityId: string,
  activityDate: string
): Promise<string> {
  await ensureDir();

  const xml = buildVikazimutXml(points, activityId, activityDate);
  const fileName = `vikazimut_${activityId}.xml`;
  const filePath = `${EXPORT_DIR}/${fileName}`;

  await RNFS.writeFile(filePath, xml, 'utf8');
  return filePath;
}

/** Partage le fichier XML via l'intent de partage Android. */
export async function shareVikazimutFile(filePath: string): Promise<void> {
  await Share.share({
    title: 'Export Vikazimut',
    url: `file://${filePath}`,
    message: 'Parcours exporté depuis AmbitSync',
  });
}

// ─── Construction du XML ──────────────────────────────────────────────────────

function buildVikazimutXml(
  points: TrackPoint[],
  activityId: string,
  activityDate: string
): string {
  const date = activityDate ? new Date(activityDate).toISOString() : new Date().toISOString();

  const ptLines = points.map(p => {
    const tSec = p.timestamp ? Math.floor(p.timestamp / 1000) : 0;
    return `    <pt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}" alt="${p.elevation.toFixed(1)}" t="${tSec}"/>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<vikazimut version="1.0">
  <track id="${escapeXml(activityId)}" date="${escapeXml(date)}" source="AmbitSync">
    <points count="${points.length}">
${ptLines}
    </points>
  </track>
</vikazimut>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function ensureDir(): Promise<void> {
  if (!(await RNFS.exists(EXPORT_DIR))) await RNFS.mkdir(EXPORT_DIR);
}
