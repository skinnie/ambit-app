import * as Keychain from 'react-native-keychain';

// ─── Intervals.icu — auth par clé API personnelle (pas d'OAuth) ───────────────
// Voir Settings → Developer Settings sur intervals.icu pour la clé et l'ID athlète.
// Auth : HTTP Basic, username="API_KEY", password=<clé>.

const KEYCHAIN_SERVICE = 'opensportsync_intervals_icu';
const API_BASE         = 'https://intervals.icu/api/v1';

export interface IntervalsIcuCredentials {
  athleteId: string;
  apiKey: string;
}

// Stocké dans le Keychain comme (username=athleteId, password=apiKey) —
// un seul secret générique suffit pour les deux valeurs.
export async function getIntervalsIcuCredentials(): Promise<IntervalsIcuCredentials | null> {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (!creds) return null;
  return { athleteId: creds.username, apiKey: creds.password };
}

export async function saveIntervalsIcuCredentials(athleteId: string, apiKey: string): Promise<void> {
  await Keychain.setGenericPassword(athleteId.trim(), apiKey.trim(), { service: KEYCHAIN_SERVICE });
}

export async function removeIntervalsIcuCredentials(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
}

export interface IntervalsIcuUploadResult {
  activityId: string;
  viewerUrl: string;
}

export async function uploadFitToIntervalsIcu(
  fitPath: string,
  athleteId: string,
  apiKey: string,
): Promise<IntervalsIcuUploadResult> {
  const fileName = fitPath.split('/').pop() ?? 'activity.fit';
  const formData = new FormData();
  formData.append('file', {
    uri: `file://${fitPath}`,
    name: fileName,
    type: 'application/fit',
  } as any);

  // Basic Auth : username="API_KEY", password=<clé API perso>
  const authHeader = 'Basic ' + btoa(`API_KEY:${apiKey}`);

  const response = await fetch(
    `${API_BASE}/athlete/${encodeURIComponent(athleteId)}/activities`,
    {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Intervals.icu: ${response.status} ${response.statusText} — ${text}`);
  }

  const json = await response.json();
  // La réponse peut être un objet unique ou un tableau (import multi-activités) selon le fichier FIT
  const first = Array.isArray(json) ? json[0] : json;
  const activityId = String(first?.id ?? first?.activity_id ?? '');
  if (!activityId) {
    throw new Error('Intervals.icu: unexpected response\n' + JSON.stringify(json));
  }

  return {
    activityId,
    viewerUrl: `https://intervals.icu/activities/${activityId}`,
  };
}
