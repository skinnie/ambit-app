import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'opensportsync_runalyze';
const UPLOAD_URL       = 'https://runalyze.com/api/v1/activities/uploads';

export async function getRunalyzeApiKey(): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  return creds ? creds.password : null;
}

export async function saveRunalyzeApiKey(key: string): Promise<void> {
  await Keychain.setGenericPassword('runalyze', key.trim(), { service: KEYCHAIN_SERVICE });
}

export async function removeRunalyzeApiKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
}

export interface RunalyzeUploadResult {
  activityId: number;
}

export async function uploadFitToRunalyze(
  fitPath: string,
  apiKey: string,
): Promise<RunalyzeUploadResult> {
  const fileName = fitPath.split('/').pop() ?? 'activity.fit';
  const formData = new FormData();
  formData.append('file', {
    uri: `file://${fitPath}`,
    name: fileName,
    type: 'application/fit',
  } as any);

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { token: apiKey },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Runalyze: ${response.status} ${response.statusText} — ${text}`);
  }

  const json = await response.json();
  if (json?.status !== 'success') throw new Error('Runalyze: réponse inattendue\n' + JSON.stringify(json));
  // activity_id peut être null si en file d'attente (queue_id présent)
  return { activityId: json.activity_id ?? json.queue_id ?? 0 };
}

export async function uploadToRunalyze(
  gpxPath: string,
  apiKey: string,
): Promise<RunalyzeUploadResult> {
  const base64 = await RNFS.readFile(gpxPath, 'base64');
  const fileName = gpxPath.split('/').pop() ?? 'activity.gpx';

  // multipart/form-data via fetch + FormData
  const formData = new FormData();
  formData.append('file', {
    uri: `file://${gpxPath}`,
    name: fileName,
    type: 'application/gpx+xml',
  } as any);

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      token: apiKey,
      // Content-Type positionné automatiquement par fetch + FormData
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Runalyze: ${response.status} ${response.statusText} — ${text}`);
  }

  const json = await response.json();
  // Runalyze retourne { "activityId": 12345 }
  if (!json?.activityId) throw new Error('Runalyze: réponse inattendue\n' + JSON.stringify(json));
  return { activityId: json.activityId };
}
