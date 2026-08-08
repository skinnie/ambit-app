import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

// ─── Configuration OAuth2 Livelox ─────────────────────────────────────────────
import { LIVELOX_CLIENT_ID } from '../config/secrets';

const LIVELOX_REDIRECT_URI = 'opensportsync://oauth/livelox';
const LIVELOX_AUTH_URL     = 'https://api.livelox.com/oauth2/authorize';
const LIVELOX_TOKEN_URL    = 'https://api.livelox.com/oauth2/token';
const LIVELOX_API_BASE     = 'https://api.livelox.com';

const KC_TOKEN   = 'opensportsync_livelox_token';
const KC_PKCE    = 'opensportsync_livelox_pkce';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TokenData {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;  // timestamp ms
}

export interface LiveloxImportResult {
  viewerUrl: string;
}

// ─── Token storage ────────────────────────────────────────────────────────────

async function saveToken(data: TokenData): Promise<void> {
  await Keychain.setGenericPassword('livelox', JSON.stringify(data), { service: KC_TOKEN });
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

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let v = '';
  for (let i = 0; i < 64; i++) {
    v += chars[Math.floor(Math.random() * chars.length)];
  }
  return v;
}

// ─── SHA-256 pure JS (crypto.subtle absent dans Hermes) ───────────────────────

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

// ─── PKCE S256 ────────────────────────────────────────────────────────────────

async function sha256Base64Url(input: string): Promise<string> {
  const hash = sha256Bytes(new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── URL d'autorisation OAuth2 (PKCE S256) ────────────────────────────────────

/**
 * Génère l'URL d'autorisation Livelox et stocke le code_verifier PKCE (Keychain).
 * Ouvrir cette URL dans le navigateur système (Linking.openURL).
 * L'app recevra le callback via le deep link opensportsync://oauth/livelox?code=...
 */
export async function getAuthorizationUrl(): Promise<string> {
  const verifier  = generateVerifier();
  const challenge = await sha256Base64Url(verifier);
  await Keychain.setGenericPassword('pkce', verifier, { service: KC_PKCE });

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             LIVELOX_CLIENT_ID,
    redirect_uri:          LIVELOX_REDIRECT_URI,
    scope:                 'routes.import',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  return `${LIVELOX_AUTH_URL}?${params.toString()}`;
}

// ─── Échange du code contre un token ──────────────────────────────────────────

/**
 * Appelé par App.tsx quand le deep link opensportsync://oauth/livelox?code=... est reçu.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const creds = await Keychain.getGenericPassword({ service: KC_PKCE });
  const verifier = creds ? creds.password : null;
  if (!verifier) throw new Error('PKCE verifier introuvable');

  const response = await fetch(LIVELOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  LIVELOX_REDIRECT_URI,
      client_id:     LIVELOX_CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });

  await Keychain.resetGenericPassword({ service: KC_PKCE });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OAuth2 token exchange failed: HTTP ${response.status} — ${body}`);
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
  if (!token) throw new Error('Non authentifié sur Livelox');

  if (Date.now() > token.expires_at - 60_000) {
    const response = await fetch(LIVELOX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: token.refresh_token,
        client_id:     LIVELOX_CLIENT_ID,
      }).toString(),
    });
    if (!response.ok) {
      await logout();
      throw new Error('Session Livelox expirée, veuillez vous reconnecter');
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

// ─── Import GPX via Route Integration API ─────────────────────────────────────

function generateId(): string {
  return `oss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Importe un fichier GPX vers Livelox via /importableRoutes.
 * Retourne l'URL du viewer Livelox une fois le traitement terminé.
 */
export async function uploadGpxToLivelox(gpxPath: string): Promise<LiveloxImportResult> {
  const accessToken = await getValidToken();
  const gpxContent  = await RNFS.readFile(gpxPath, 'base64');
  const importId    = generateId();

  // 1. Soumettre le GPX
  const postRes = await fetch(`${LIVELOX_API_BASE}/importableRoutes`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id:          importId,
      data:        gpxContent,
      deviceModel: 'Suunto Ambit',
    }),
  });

  if (!postRes.ok) {
    const body = await postRes.text();
    throw new Error(`Livelox import failed: HTTP ${postRes.status} — ${body}`);
  }

  // 2. Poller jusqu'à traitement (max 10× 2s = 20s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const getRes = await fetch(`${LIVELOX_API_BASE}/importableRoutes/${importId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!getRes.ok) continue;

    const status = await getRes.json();
    if (status.status === 'imported') {
      const viewerUrl = status.viewerUrl ?? `https://livelox.com/viewer?routeId=${importId}`;
      return { viewerUrl };
    }
    if (status.status === 'error') {
      throw new Error(`Livelox processing error: ${status.errorMessage ?? 'unknown'}`);
    }
    // status === 'pending' → continuer à poller
  }

  throw new Error('Livelox timeout: traitement non terminé après 20 secondes');
}
