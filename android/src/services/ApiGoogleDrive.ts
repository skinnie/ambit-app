import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

// ─── Cloud backup - Google Drive (added 2026-08-12, "implement the ones that the user can set
// up easily by itself"). Self-serve, same principle as ApiDropbox.ts/ApiStrava.ts: the user
// registers their own free OAuth Client ID (type "Desktop app", Google Drive API enabled) at
// console.cloud.google.com and pastes it in Settings. drive.file scope means this app only
// ever sees files/folders it created itself - ports desktop's own CloudStorageService
// (cloudstorageservice.cpp's ensureGoogleDriveFolder()/uploadOneFile()/downloadOneFile()),
// same "AmbitApp Backups" Drive folder, search-or-create once then cache the id. ──

const GOOGLEDRIVE_REDIRECT_URI = 'opensportsync://oauth/googledrive';
const GOOGLEDRIVE_AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLEDRIVE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GOOGLEDRIVE_API_BASE     = 'https://www.googleapis.com/drive/v3';
const GOOGLEDRIVE_UPLOAD_BASE  = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLEDRIVE_SCOPES       = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME              = 'AmbitApp Backups';

const KC_CREDS  = 'opensportsync_googledrive_creds';
const KC_TOKEN  = 'opensportsync_googledrive_token';
const KC_FOLDER = 'opensportsync_googledrive_folder';

interface CredsData {
  clientId: string;
  clientSecret: string;
}

interface TokenData {
  access_token:  string;
  refresh_token: string;
  expires_at:    number; // ms epoch
}

// ─── Credential + token storage ────────────────────────────────────────────────

async function saveCreds(creds: CredsData): Promise<void> {
  await Keychain.setGenericPassword('googledrive', JSON.stringify(creds), { service: KC_CREDS });
}

async function loadCreds(): Promise<CredsData | null> {
  const creds = await Keychain.getGenericPassword({ service: KC_CREDS });
  return creds ? JSON.parse(creds.password) : null;
}

export async function getSavedClientId(): Promise<string> {
  return (await loadCreds())?.clientId ?? '';
}

export async function getSavedClientSecret(): Promise<string> {
  return (await loadCreds())?.clientSecret ?? '';
}

async function saveToken(data: TokenData): Promise<void> {
  await Keychain.setGenericPassword('googledrive', JSON.stringify(data), { service: KC_TOKEN });
}

async function loadToken(): Promise<TokenData | null> {
  const creds = await Keychain.getGenericPassword({ service: KC_TOKEN });
  return creds ? JSON.parse(creds.password) : null;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await loadToken()) !== null;
}

export async function logout(): Promise<void> {
  await Promise.all([
    Keychain.resetGenericPassword({ service: KC_TOKEN }),
    Keychain.resetGenericPassword({ service: KC_FOLDER }),
  ]);
}

// ─── URL d'autorisation OAuth2 ────────────────────────────────────────────────

/**
 * Sauvegarde les identifiants saisis par l'utilisateur (Client ID/secret) et génère l'URL
 * d'autorisation Google. Ouvrir avec Linking.openURL - retour via le deep link
 * opensportsync://oauth/googledrive?code=...
 */
export async function getAuthorizationUrl(clientId: string, clientSecret: string): Promise<string> {
  await saveCreds({ clientId, clientSecret });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  GOOGLEDRIVE_REDIRECT_URI,
    response_type: 'code',
    access_type:   'offline', // nécessaire pour recevoir un refresh_token
    prompt:        'consent', // force un refresh_token même en re-consentement
    scope:         GOOGLEDRIVE_SCOPES,
  });
  return `${GOOGLEDRIVE_AUTH_URL}?${params.toString()}`;
}

// ─── Échange du code contre un token ──────────────────────────────────────────

/**
 * Appelé par App.tsx quand le deep link opensportsync://oauth/googledrive?code=... est reçu.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const creds = await loadCreds();
  if (!creds) throw new Error('Google Drive client ID/secret not found - reconnect from Settings.');

  const response = await fetch(GOOGLEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  GOOGLEDRIVE_REDIRECT_URI,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Drive token exchange failed: HTTP ${response.status} — ${body}`);
  }

  const json = await response.json();
  await saveToken({
    access_token:  json.access_token,
    refresh_token: json.refresh_token,
    expires_at:    Date.now() + json.expires_in * 1000,
  });
}

// ─── Refresh automatique ──────────────────────────────────────────────────────

async function getValidToken(): Promise<string> {
  let token = await loadToken();
  if (!token) throw new Error('Not connected to Google Drive');

  if (Date.now() > token.expires_at - 60_000) {
    const creds = await loadCreds();
    if (!creds) throw new Error('Google Drive client ID/secret not found - reconnect from Settings.');

    const response = await fetch(GOOGLEDRIVE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     creds.clientId,
        client_secret: creds.clientSecret,
        grant_type:    'refresh_token',
        refresh_token: token.refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      await logout();
      throw new Error('Google Drive session expired, please reconnect');
    }

    const json = await response.json();
    token = {
      access_token:  json.access_token,
      // Google ne renvoie pas toujours un nouveau refresh_token
      refresh_token: json.refresh_token ?? token.refresh_token,
      expires_at:    Date.now() + json.expires_in * 1000,
    };
    await saveToken(token);
  }

  return token.access_token;
}

// Échappe une valeur insérée dans une chaîne littérale d'une requête Drive `q=` (délimitée par
// des apostrophes). Drive attend le backslash comme caractère d'échappement, donc on protège
// `\` puis `'` : un nom de fichier contenant une apostrophe (ex. "Andr's watch.bak") ne casse
// plus la requête et ne peut plus en modifier la logique.
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── Dossier "AmbitApp Backups" - drive.file n'expose rien créé ailleurs, donc chercher ou
// créer une fois, puis mettre en cache l'id (permanent) pour les appels suivants. ──

async function ensureFolder(accessToken: string): Promise<string> {
  const cached = await Keychain.getGenericPassword({ service: KC_FOLDER });
  if (cached) return cached.password;

  const q = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapeDriveQueryValue(FOLDER_NAME)}' and trashed=false`,
    fields: 'files(id)',
  });
  const searchRes = await fetch(`${GOOGLEDRIVE_API_BASE}/files?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) {
    throw new Error(`Google Drive: HTTP ${searchRes.status} — ${await searchRes.text()}`);
  }
  const searchJson = await searchRes.json();
  const existing = searchJson.files?.[0]?.id as string | undefined;
  if (existing) {
    await Keychain.setGenericPassword('folder', existing, { service: KC_FOLDER });
    return existing;
  }

  const createRes = await fetch(`${GOOGLEDRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!createRes.ok) {
    throw new Error(`Google Drive: could not create the backups folder - HTTP ${createRes.status} — ${await createRes.text()}`);
  }
  const createJson = await createRes.json();
  const id = createJson.id as string;
  if (!id) throw new Error('Google Drive: folder creation did not return an id.');
  await Keychain.setGenericPassword('folder', id, { service: KC_FOLDER });
  return id;
}

// ─── Binary transfer helpers (same data: URI / Blob trick as ApiDropbox.ts) ──

async function localFileToBlob(localPath: string): Promise<Blob> {
  const base64 = await RNFS.readFile(localPath, 'base64');
  const res = await fetch(`data:application/octet-stream;base64,${base64}`);
  return res.blob();
}

async function responseToLocalFile(response: Response, localPath: string): Promise<void> {
  const blob = await response.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  await RNFS.writeFile(localPath, base64, 'base64');
}

// ─── Upload / list / download - scoped to the "AmbitApp Backups" folder ───────────────────

/**
 * Two-step create-then-fill-content instead of desktop's single multipart/related request:
 * RN's fetch has no multipart/related body type (only multipart/form-data via FormData,
 * which Drive's combined-upload endpoint does not accept), so this creates the metadata
 * (name + parent) first, then PATCHes the raw bytes into that file's media endpoint - same
 * end result, one extra round-trip.
 */
export async function uploadFile(localPath: string, remoteName: string): Promise<void> {
  const accessToken = await getValidToken();
  const folderId = await ensureFolder(accessToken);

  const createRes = await fetch(`${GOOGLEDRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: remoteName, parents: [folderId] }),
  });
  if (!createRes.ok) {
    throw new Error(`Google Drive upload failed: HTTP ${createRes.status} — ${await createRes.text()}`);
  }
  const fileId = (await createRes.json()).id as string;

  const blob = await localFileToBlob(localPath);
  const contentRes = await fetch(`${GOOGLEDRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: blob,
  });
  if (!contentRes.ok) {
    throw new Error(`Google Drive upload failed: HTTP ${contentRes.status} — ${await contentRes.text()}`);
  }
}

export async function listFiles(): Promise<string[]> {
  const accessToken = await getValidToken();
  const folderId = await ensureFolder(accessToken);

  const q = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(name)',
  });
  const response = await fetch(`${GOOGLEDRIVE_API_BASE}/files?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google Drive list failed: HTTP ${response.status} — ${await response.text()}`);
  }
  const json = await response.json();
  return (json.files ?? []).map((f: any) => f.name as string);
}

export async function downloadFile(remoteName: string, localPath: string): Promise<void> {
  const accessToken = await getValidToken();
  const folderId = await ensureFolder(accessToken);

  const q = new URLSearchParams({
    q: `name='${escapeDriveQueryValue(remoteName)}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
  });
  const searchRes = await fetch(`${GOOGLEDRIVE_API_BASE}/files?${q.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) {
    throw new Error(`Google Drive download failed: HTTP ${searchRes.status} — ${await searchRes.text()}`);
  }
  const fileId = (await searchRes.json()).files?.[0]?.id as string | undefined;
  if (!fileId) throw new Error('File not found on Google Drive.');

  const dlRes = await fetch(`${GOOGLEDRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!dlRes.ok) {
    throw new Error(`Google Drive download failed: HTTP ${dlRes.status} — ${await dlRes.text()}`);
  }
  await responseToLocalFile(dlRes, localPath);
}
