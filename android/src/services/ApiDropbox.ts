import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

// ─── Cloud backup - Dropbox (added 2026-08-12, "implement the ones that the user can set up
// easily by itself"). Self-serve, same principle as ApiStrava.ts: not a shared AmbitApp-owned
// app - the user registers their own free app at dropbox.com/developers/apps (App folder
// access) and pastes its App key/secret in Settings, see SettingsScreen.tsx's Dropbox modal.
// Ports desktop's own CloudStorageService (cloudstorageservice.cpp) - same endpoints, same
// "AmbitApp Backups" app-folder scoping, see that file's header comment for the full
// reasoning this mirrors. ──

const DROPBOX_REDIRECT_URI = 'opensportsync://oauth/dropbox';
const DROPBOX_AUTH_URL     = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL    = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_SCOPES       = 'files.content.write files.content.read files.metadata.read';

const KC_CREDS = 'opensportsync_dropbox_creds';
const KC_TOKEN = 'opensportsync_dropbox_token';

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
  await Keychain.setGenericPassword('dropbox', JSON.stringify(creds), { service: KC_CREDS });
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
  await Keychain.setGenericPassword('dropbox', JSON.stringify(data), { service: KC_TOKEN });
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
 * Sauvegarde les identifiants saisis par l'utilisateur (App key/secret) et génère l'URL
 * d'autorisation Dropbox. Ouvrir avec Linking.openURL - retour via le deep link
 * opensportsync://oauth/dropbox?code=...
 */
export async function getAuthorizationUrl(clientId: string, clientSecret: string): Promise<string> {
  await saveCreds({ clientId, clientSecret });

  const params = new URLSearchParams({
    client_id:          clientId,
    redirect_uri:       DROPBOX_REDIRECT_URI,
    response_type:      'code',
    token_access_type:  'offline', // nécessaire pour recevoir un refresh_token
    scope:              DROPBOX_SCOPES,
  });
  return `${DROPBOX_AUTH_URL}?${params.toString()}`;
}

// ─── Échange du code contre un token ──────────────────────────────────────────

/**
 * Appelé par App.tsx quand le deep link opensportsync://oauth/dropbox?code=... est reçu.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const creds = await loadCreds();
  if (!creds) throw new Error('Dropbox client key/secret not found - reconnect from Settings.');

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  DROPBOX_REDIRECT_URI,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dropbox token exchange failed: HTTP ${response.status} — ${body}`);
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
  if (!token) throw new Error('Not connected to Dropbox');

  if (Date.now() > token.expires_at - 60_000) {
    const creds = await loadCreds();
    if (!creds) throw new Error('Dropbox client key/secret not found - reconnect from Settings.');

    const response = await fetch(DROPBOX_TOKEN_URL, {
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
      throw new Error('Dropbox session expired, please reconnect');
    }

    const json = await response.json();
    token = {
      access_token:  json.access_token,
      refresh_token: json.refresh_token ?? token.refresh_token,
      expires_at:    Date.now() + json.expires_in * 1000,
    };
    await saveToken(token);
  }

  return token.access_token;
}

// ─── Binary transfer helpers (RN fetch has no direct file<->body path; the data: URI trick
// gets a binary-safe Blob without pulling in a native module, see e.g.
// https://github.com/facebook/react-native/issues/28551) ──

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

// ─── Upload / list / download - App Folder scoped, "/" is the app's own root ──────────────

export async function uploadFile(localPath: string, remoteName: string): Promise<void> {
  const accessToken = await getValidToken();
  const blob = await localFileToBlob(localPath);

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization:      `Bearer ${accessToken}`,
      'Dropbox-API-Arg':  JSON.stringify({ path: `/${remoteName}`, mode: 'overwrite', mute: true }),
      'Content-Type':     'application/octet-stream',
    },
    body: blob,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dropbox upload failed: HTTP ${response.status} — ${body}`);
  }
}

export async function listFiles(): Promise<string[]> {
  const accessToken = await getValidToken();

  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: '' }), // app-folder root
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dropbox list failed: HTTP ${response.status} — ${body}`);
  }

  const json = await response.json();
  return (json.entries ?? []).map((e: any) => e.name as string);
}

export async function downloadFile(remoteName: string, localPath: string): Promise<void> {
  const accessToken = await getValidToken();

  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization:     `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: `/${remoteName}` }),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dropbox download failed: HTTP ${response.status} — ${body}`);
  }

  await responseToLocalFile(response, localPath);
}
