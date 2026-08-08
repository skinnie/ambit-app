import * as Keychain from 'react-native-keychain';
import { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } from '../config/secrets';

// ─── Configuration OAuth2 Strava ──────────────────────────────────────────────

const STRAVA_REDIRECT_URI = 'opensportsync://oauth/strava';
const STRAVA_AUTH_URL     = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL    = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE     = 'https://www.strava.com/api/v3';
const STRAVA_SCOPES       = 'activity:write,read';

const KC_TOKEN = 'opensportsync_strava_token';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TokenData {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;  // timestamp ms
}

export interface StravaUploadResult {
  stravaUrl: string;
}

// ─── Token storage ────────────────────────────────────────────────────────────

async function saveToken(data: TokenData): Promise<void> {
  await Keychain.setGenericPassword('strava', JSON.stringify(data), { service: KC_TOKEN });
}

async function loadToken(): Promise<TokenData | null> {
  const creds = await Keychain.getGenericPassword({ service: KC_TOKEN });
  return creds ? JSON.parse(creds.password) : null;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await loadToken()) !== null;
}

export async function logout(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KC_TOKEN });
}

// ─── URL d'autorisation OAuth2 ────────────────────────────────────────────────

/**
 * Génère l'URL d'autorisation Strava.
 * Ouvrir avec Linking.openURL — retour via deep link opensportsync://oauth/strava?code=...
 */
export function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id:     STRAVA_CLIENT_ID,
    redirect_uri:  STRAVA_REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope:         STRAVA_SCOPES,
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

// ─── Échange du code contre un token ──────────────────────────────────────────

/**
 * Appelé par App.tsx quand le deep link opensportsync://oauth/strava?code=... est reçu.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Strava token exchange failed: HTTP ${response.status} — ${body}`);
  }

  const json = await response.json();
  await saveToken({
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    json.expires_at * 1000,  // Strava retourne des secondes
  });
}

// ─── Refresh automatique ──────────────────────────────────────────────────────

async function getValidToken(): Promise<string> {
  let token = await loadToken();
  if (!token) throw new Error('Non authentifié sur Strava');

  if (Date.now() > token.expires_at - 60_000) {
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: token.refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      await logout();
      throw new Error('Session Strava expirée, veuillez vous reconnecter');
    }

    const json = await response.json();
    token = {
      access_token:  json.access_token,
      refresh_token: json.refresh_token ?? token.refresh_token,
      expires_at:    json.expires_at * 1000,
    };
    await saveToken(token);
  }

  return token.access_token;
}

// ─── Mapping type d'activité → sport Strava ───────────────────────────────────

function mapActivityType(rawType: string): string {
  const t = rawType.toLowerCase();
  if (t.includes('course') || t.includes('orientation') || t.includes('marche') || t.includes('trail')) {
    return 'Run';
  }
  if (t.includes('vtt') || t.includes('cycl')) {
    return 'Ride';
  }
  if (t.includes('ski de fond') || t.includes('nordique')) {
    return 'NordicSki';
  }
  if (t.includes('ski alpin')) {
    return 'AlpineSki';
  }
  if (t.includes('natation') || t.includes('swim')) {
    return 'Swim';
  }
  if (t.includes('kayak')) {
    return 'Kayaking';
  }
  return 'Workout';
}

// ─── Upload GPX vers Strava ───────────────────────────────────────────────────

/**
 * Uploade un fichier GPX vers Strava et attend la fin du traitement.
 * Retourne l'URL de l'activité sur Strava.
 */
export async function uploadGpxToStrava(
  gpxPath: string,
  activityName: string,
  activityType: string,
): Promise<StravaUploadResult> {
  const accessToken   = await getValidToken();
  const stravaType    = mapActivityType(activityType);
  const fileUri       = gpxPath.startsWith('file://') ? gpxPath : `file://${gpxPath}`;
  const fileName      = gpxPath.split('/').pop() ?? 'activity.gpx';

  // 1. Soumettre le GPX via multipart/form-data
  const formData = new FormData();
  formData.append('file', {
    uri:  fileUri,
    type: 'application/gpx+xml',
    name: fileName,
  } as any);
  formData.append('data_type',     'gpx');
  formData.append('activity_type', stravaType);
  formData.append('name',          activityName || fileName.replace('.gpx', ''));

  const uploadRes = await fetch(`${STRAVA_API_BASE}/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (uploadRes.status === 429) {
    throw new Error('Quota Strava atteint (200 req/15 min). Réessaie dans 15 min.');
  }
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Strava upload failed: HTTP ${uploadRes.status} — ${body}`);
  }

  const upload = await uploadRes.json();
  if (upload.error) {
    throw new Error(`Strava: ${upload.error}`);
  }

  const uploadId = upload.id_str ?? String(upload.id);

  // 2. Polling jusqu'à traitement (max 30 × 2s = 60s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const statusRes = await fetch(`${STRAVA_API_BASE}/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (statusRes.status === 429) {
      throw new Error('Quota Strava atteint (200 req/15 min). Réessaie dans 15 min.');
    }
    if (!statusRes.ok) continue;

    const status = await statusRes.json();

    if (status.error) {
      throw new Error(`Strava processing error: ${status.error}`);
    }
    if (status.activity_id) {
      return { stravaUrl: `https://www.strava.com/activities/${status.activity_id}` };
    }
    // status: "Your activity is being processed." → continuer
  }

  throw new Error('Strava timeout: traitement non terminé après 60 secondes');
}
