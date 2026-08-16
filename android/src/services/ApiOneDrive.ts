import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

// ─── Cloud backup - OneDrive (added 2026-08-12, "implement the ones that the user can set up
// easily by itself"). Self-serve, same principle as ApiDropbox.ts/ApiGoogleDrive.ts: the user
// registers their own free app at entra.microsoft.com (platform "Mobile and desktop
// applications", no secret needed - PKCE) and pastes its Application (client) ID in Settings.
// PKCE helper code (generateVerifier/sha256Base64Url) copied from ApiLivelox.ts, which
// already had to solve "no crypto.subtle in Hermes" for its own OAuth2 PKCE flow. Ports
// desktop's own CloudStorageService (cloudstorageservice.cpp), same
// /me/drive/special/approot Graph endpoints, same app-folder scoping. ──

const ONEDRIVE_REDIRECT_URI = 'opensportsync://oauth/onedrive';
const ONEDRIVE_AUTH_URL     = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const ONEDRIVE_TOKEN_URL    = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const ONEDRIVE_API_BASE     = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const ONEDRIVE_SCOPES       = 'Files.ReadWrite.AppFolder offline_access';

const KC_CREDS = 'opensportsync_onedrive_creds';
const KC_TOKEN = 'opensportsync_onedrive_token';
const KC_PKCE  = 'opensportsync_onedrive_pkce';

interface TokenData {
  access_token:  string;
  refresh_token: string;
  expires_at:    number; // ms epoch
}

// ─── Credential + token storage ────────────────────────────────────────────────

export async function getSavedClientId(): Promise<string> {
  const creds = await Keychain.getGenericPassword({ service: KC_CREDS });
  return creds ? creds.password : '';
}

async function saveToken(data: TokenData): Promise<void> {
  await Keychain.setGenericPassword('onedrive', JSON.stringify(data), { service: KC_TOKEN });
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
    Keychain.resetGenericPassword({ service: KC_PKCE }),
  ]);
}

// ─── PKCE helpers (identical to ApiLivelox.ts - see that file for the "why pure JS SHA-256"
// note: Hermes has no crypto.subtle) ──

function generateVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let v = '';
  for (let i = 0; i < 64; i++) {
    v += chars[Math.floor(Math.random() * chars.length)];
  }
  return v;
}

function rotr32(x: number, n: number): number { return (x >>> n) | (x << (32 - n)); }

function sha256Bytes(msg: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
  let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bitLen = msg.length * 8;
  const padLen = (msg.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Array(64);
  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr32(w[j-15],7) ^ rotr32(w[j-15],18) ^ (w[j-15]>>>3);
      const s1 = rotr32(w[j-2],17) ^ rotr32(w[j-2],19)  ^ (w[j-2]>>>10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let j = 0; j < 64; j++) {
      const S1  = rotr32(e,6) ^ rotr32(e,11) ^ rotr32(e,25);
      const ch  = (e & f) ^ (~e & g);
      const t1  = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0  = rotr32(a,2) ^ rotr32(a,13) ^ rotr32(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2  = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v,i) => ov.setUint32(i*4, v, false));
  return out;
}

async function sha256Base64Url(input: string): Promise<string> {
  const hash = sha256Bytes(new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── URL d'autorisation OAuth2 (PKCE S256) ────────────────────────────────────

/**
 * Sauvegarde le Client ID saisi par l'utilisateur, stocke le code_verifier PKCE (Keychain)
 * et génère l'URL d'autorisation Microsoft. Ouvrir avec Linking.openURL - retour via le deep
 * link opensportsync://oauth/onedrive?code=...
 */
export async function getAuthorizationUrl(clientId: string): Promise<string> {
  await Keychain.setGenericPassword('onedrive', clientId, { service: KC_CREDS });

  const verifier  = generateVerifier();
  const challenge = await sha256Base64Url(verifier);
  await Keychain.setGenericPassword('pkce', verifier, { service: KC_PKCE });

  const params = new URLSearchParams({
    client_id:              clientId,
    redirect_uri:           ONEDRIVE_REDIRECT_URI,
    response_type:          'code',
    response_mode:          'query',
    scope:                  ONEDRIVE_SCOPES,
    code_challenge:         challenge,
    code_challenge_method:  'S256',
  });
  return `${ONEDRIVE_AUTH_URL}?${params.toString()}`;
}

// ─── Échange du code contre un token ──────────────────────────────────────────

/**
 * Appelé par App.tsx quand le deep link opensportsync://oauth/onedrive?code=... est reçu.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const clientId = await getSavedClientId();
  if (!clientId) throw new Error('OneDrive client ID not found - reconnect from Settings.');

  const pkceCreds = await Keychain.getGenericPassword({ service: KC_PKCE });
  const verifier = pkceCreds ? pkceCreds.password : null;
  if (!verifier) throw new Error('PKCE verifier not found');

  const response = await fetch(ONEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  ONEDRIVE_REDIRECT_URI,
      code_verifier: verifier,
    }).toString(),
  });

  await Keychain.resetGenericPassword({ service: KC_PKCE });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OneDrive token exchange failed: HTTP ${response.status} — ${body}`);
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
  if (!token) throw new Error('Not connected to OneDrive');

  if (Date.now() > token.expires_at - 60_000) {
    const clientId = await getSavedClientId();
    if (!clientId) throw new Error('OneDrive client ID not found - reconnect from Settings.');

    const response = await fetch(ONEDRIVE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        grant_type:    'refresh_token',
        refresh_token: token.refresh_token,
        scope:         ONEDRIVE_SCOPES,
      }).toString(),
    });

    if (!response.ok) {
      await logout();
      throw new Error('OneDrive session expired, please reconnect');
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

// ─── Upload / list / download - scoped to this app's own OneDrive app folder ──────────────

export async function uploadFile(localPath: string, remoteName: string): Promise<void> {
  const accessToken = await getValidToken();
  const blob = await localFileToBlob(localPath);

  const response = await fetch(`${ONEDRIVE_API_BASE}:/${remoteName}:/content`, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: blob,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OneDrive upload failed: HTTP ${response.status} — ${body}`);
  }
}

export async function listFiles(): Promise<string[]> {
  const accessToken = await getValidToken();

  const response = await fetch(`${ONEDRIVE_API_BASE}/children?$select=name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OneDrive list failed: HTTP ${response.status} — ${body}`);
  }

  const json = await response.json();
  return (json.value ?? []).map((f: any) => f.name as string);
}

export async function downloadFile(remoteName: string, localPath: string): Promise<void> {
  const accessToken = await getValidToken();

  const response = await fetch(`${ONEDRIVE_API_BASE}:/${remoteName}:/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OneDrive download failed: HTTP ${response.status} — ${body}`);
  }

  await responseToLocalFile(response, localPath);
}
