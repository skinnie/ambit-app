import { DeviceProvider } from './devices/DeviceProvider';
import { ambitDeviceProvider } from './devices/AmbitDeviceProvider';
import { writeGpxFile } from './GpxService';
import { extractGpxMetadata } from './GpxParser';
import { isActivitySynced, markActivitySynced, getAllSyncedIds } from '../database/db';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncState {
  phase: 'idle' | 'connecting' | 'fetching' | 'writing' | 'done' | 'error';
  current: number;
  total: number;
  newCount: number;   // logs effectivement écrits (nouveaux)
  error?: string;
}

type SyncListener = (state: SyncState) => void;

// ─── SyncService ──────────────────────────────────────────────────────────────

/**
 * Orchestre une synchronisation complète :
 *   connect → getLogs → (pour chaque log nouveau) writeGpx → markSynced → disconnect
 *
 * @param onState  Callback appelé à chaque changement d'état
 * @param provider DeviceProvider à utiliser (par défaut : Suunto Ambit)
 * @returns        Nombre de nouveaux logs écrits
 */
export async function runSync(
  onState: SyncListener,
  provider: DeviceProvider = ambitDeviceProvider,
): Promise<number> {
  const emit = (partial: Partial<SyncState> & { phase: SyncState['phase'] }) =>
    onState({ current: 0, total: 0, newCount: 0, ...partial });

  // ── 1. Connexion ────────────────────────────────────────────────────────────
  emit({ phase: 'connecting' });
  try {
    await provider.connect();
  } catch (e: any) {
    emit({ phase: 'error', error: e?.message ?? 'Connexion échouée' });
    return 0;
  }

  // ── 2. Récupération des logs ─────────────────────────────────────────────────
  emit({ phase: 'fetching', current: 0, total: 0 });

  // Charger les IDs déjà connus → passés au skip_callback natif pour éviter
  // de relire le payload complet des logs déjà synchronisés
  const knownIds = await getAllSyncedIds();

  let current = 0;
  let total = 0;
  const unsubscribe = provider.onSyncProgress(event => {
    current = event.current;
    total = event.total;
    onState({ phase: 'fetching', current, total, newCount: 0 });
  });

  let gpxLogs: string[];
  try {
    gpxLogs = await provider.getLogs(knownIds);
  } catch (e: any) {
    unsubscribe();
    emit({ phase: 'error', error: e?.message ?? 'Lecture des logs échouée' });
    await provider.disconnect().catch(() => {});
    return 0;
  }
  unsubscribe();

  // ── 3. Écriture des nouveaux logs ────────────────────────────────────────────
  emit({ phase: 'writing', current: 0, total: gpxLogs.length, newCount: 0 });
  let newCount = 0;

  for (let i = 0; i < gpxLogs.length; i++) {
    const gpxXml = gpxLogs[i];

    const meta = extractGpxMetadata(gpxXml);
    const id = meta.date
      ? meta.date.replace(/[^0-9T]/g, '').substring(0, 15) // "20240615T093000"
      : `log_${Date.now()}_${i}`;

    onState({ phase: 'writing', current: i + 1, total: gpxLogs.length, newCount });

    if (await isActivitySynced(id)) continue;

    const gpxPath = await writeGpxFile(id, gpxXml);
    if (!gpxPath) continue;

    await markActivitySynced({
      id,
      synced_at: Date.now(),
      gpx_path: gpxPath,
      date: meta.date,
      duration_s: meta.durationS,
      distance_m: meta.distanceM,
      d_plus: meta.dPlus,
      activity_type: meta.activityType,
    });
    newCount++;
  }

  // ── 4. Déconnexion ───────────────────────────────────────────────────────────
  await provider.disconnect().catch(() => {});
  emit({ phase: 'done', current: gpxLogs.length, total: gpxLogs.length, newCount });
  return newCount;
}
