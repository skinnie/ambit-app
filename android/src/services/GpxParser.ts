import { XMLParser } from 'fast-xml-parser';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrackPoint {
  latitude: number;
  longitude: number;
  elevation: number;   // mètres
  timestamp: number;   // Unix ms
  cumDist: number;     // mètres cumulés depuis le départ
  cumTime: number;     // secondes cumulées depuis le départ
}

export interface ElevationStats {
  dPlus: number;       // dénivelé positif cumulé (m)
  dMinus: number;      // dénivelé négatif cumulé (m)
  altMin: number;
  altMax: number;
  totalDistance: number; // mètres
}

export interface GpxMetadata {
  date: string;        // ISO 8601 du premier point
  durationS: number;
  distanceM: number;
  dPlus: number;
  activityType: string; // ex: "Orienteering", "Running", "Cycling"…
}

// ─── Suunto sport_type uint8 → nom lisible ────────────────────────────────────
// Source : AmbitSync / openambit (MoveInfoActivity.java) + codes Suunto connus
const SPORT_TYPE_MAP: Record<number, string> = {
  0x03: 'Course à pied',
  0x04: 'Cyclisme',
  0x05: 'VTT',
  0x07: 'Patinage',
  0x0a: 'Randonnée',
  0x0b: 'Marche',
  0x13: 'Ski alpin',
  0x14: 'Snowboard',
  0x15: 'Ski de fond',
  0x45: 'Patinage sur glace',
  0x49: 'Alpinisme',
  0x4a: 'Orientation',   // Ambit 3+
  0x4b: 'Orientation',   // Ambit 1
  0x4d: 'Ski de randonnée',
  0x51: 'Trail',
  0x52: 'Natation',
};

// ─── Parser ───────────────────────────────────────────────────────────────────

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Extrait les points GPS d'une string GPX. */
export function parseTrackPoints(gpxXml: string): TrackPoint[] {
  const obj = parser.parse(gpxXml);
  const trkseg = obj?.gpx?.trk?.trkseg;
  if (!trkseg) return [];

  const rawPoints = Array.isArray(trkseg.trkpt) ? trkseg.trkpt : [trkseg.trkpt];

  const points: TrackPoint[] = [];
  let firstTimestamp = 0;
  let lastValidPoint: TrackPoint | null = null;

  for (const p of rawPoints) {
    if (p?.['@_lat'] === undefined || p?.['@_lon'] === undefined) continue;

    const latitude = parseFloat(p['@_lat']);
    const longitude = parseFloat(p['@_lon']);
    const elevation = parseFloat(p.ele ?? '0');
    const timestamp = p.time ? new Date(p.time).getTime() : 0;

    if (points.length === 0) {
      firstTimestamp = timestamp;
      const pt: TrackPoint = { latitude, longitude, elevation, timestamp, cumDist: 0, cumTime: 0 };
      points.push(pt);
      lastValidPoint = pt;
      continue;
    }

    if (lastValidPoint) {
      const dist = haversineM(lastValidPoint.latitude, lastValidPoint.longitude, latitude, longitude);
      const newCumDist = lastValidPoint.cumDist + dist;
      let newCumTime = lastValidPoint.cumTime;

      if (timestamp > 0 && firstTimestamp > 0) {
        newCumTime = (timestamp - firstTimestamp) / 1000;
        // Filtrage des sauts temporels en arrière ou doublons temporels
        if (newCumTime <= lastValidPoint.cumTime) {
          continue; 
        }
      }

      const pt: TrackPoint = { latitude, longitude, elevation, timestamp, cumDist: newCumDist, cumTime: newCumTime };
      points.push(pt);
      lastValidPoint = pt;
    }
  }

  return points;
}

/** Calcule les statistiques altimétriques et la distance totale. */
export function computeElevationStats(points: TrackPoint[]): ElevationStats {
  if (points.length === 0) {
    return { dPlus: 0, dMinus: 0, altMin: 0, altMax: 0, totalDistance: 0 };
  }

  let dPlus = 0;
  let dMinus = 0;
  let altMin = points[0].elevation;
  let altMax = points[0].elevation;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // Dénivelé
    const dEle = curr.elevation - prev.elevation;
    if (dEle > 0) dPlus += dEle;
    else dMinus += Math.abs(dEle);

    if (curr.elevation < altMin) altMin = curr.elevation;
    if (curr.elevation > altMax) altMax = curr.elevation;
  }

  return {
    dPlus: Math.round(dPlus),
    dMinus: Math.round(dMinus),
    altMin: Math.round(altMin),
    altMax: Math.round(altMax),
    totalDistance: Math.round(points[points.length - 1].cumDist),
  };
}

/** Extrait les métadonnées principales d'un GPX (date, durée, distance, D+).
 *  Utilise <metadata><time> comme date de référence (= header.date_time de la montre)
 *  pour que l'ID généré corresponde à celui du skip_callback C (formatLogId). */
export function extractGpxMetadata(gpxXml: string): GpxMetadata {
  const obj = parser.parse(gpxXml);
  const metaTime: string | undefined = obj?.gpx?.metadata?.time;

  const points = parseTrackPoints(gpxXml);
  const stats = points.length > 0 ? computeElevationStats(points) : null;
  const first = points[0];
  const last  = points[points.length - 1];

  return {
    // Préférer metadata/time (stable, timezone-free) plutôt que premier trkpt
    date: metaTime
      ? new Date(metaTime).toISOString()
      : (first?.timestamp ? new Date(first.timestamp).toISOString() : ''),
    durationS: last?.timestamp && first?.timestamp
      ? Math.round((last.timestamp - first.timestamp) / 1000)
      : 0,
    distanceM: stats?.totalDistance ?? 0,
    dPlus:     stats?.dPlus ?? 0,
    activityType: (() => {
      // 1. Essayer activity_name (peut être vide sur Ambit 1)
      const rawName = obj?.gpx?.trk?.name;
      const name = rawName && rawName !== true ? String(rawName).trim() : '';
      if (name && name !== 'Activité') return name;
      // 2. Regex sur la string brute — plus fiable que le parser pour les extensions
      const m = gpxXml.match(/<sport_type>(\d+)<\/sport_type>/);
      const code = m ? parseInt(m[1], 10) : -1;
      return SPORT_TYPE_MAP[code] ?? '';
    })(),
  };
}

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
