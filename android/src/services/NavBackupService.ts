import RNFS from 'react-native-fs';
import { connect, disconnect, readRegion, saveFileAs } from '../native/AmbitUsbModule';
import { readNavBases } from './MemoryMap';
import * as ApiDropbox from './ApiDropbox';
import * as ApiGoogleDrive from './ApiGoogleDrive';
import * as ApiOneDrive from './ApiOneDrive';

// v3.0 UI port (2026-08-09, "re do... backup to match entirely desktop") - real "Backup &
// Restore" card from desktop's own BackupPage.qml ("the backup that milestone 4 asked for
// and never had" - write_nav.py's own words), covering Routes+Waypoints together (the
// watch's whole navigation database), same scope as desktop's own mechanism.
//
// **Real, deliberate scope cut from desktop parity**: this is create-backup only. Desktop's
// own Restore button calls write_nav.py's `restore PREFIX --write`, which needs a raw
// region WRITE (not just read()) - a real, currently-nonexistent native capability on
// Android (jni_bridge.cpp/device_driver_ambit3.c have no generic raw-region-write function
// at all, only the specific typed writers: writeRoute/writeSettingsRaw/
// writeCustomModesRaw). Building that blind, the same session this app's other real
// flash-write bug (CustomModes' used-extent/commit fix) was found and fixed, is exactly the
// kind of new native write path that needs its own careful, deliberate treatment - not
// something to add as a side effect of a UI pass. Create-backup only needs readRegion(),
// already proven and already used this same way by exportNavigationToGpx().

const BACKUPS_DIR = `${RNFS.DocumentDirectoryPath}/backups`;

export interface BackupEntry {
  prefix: string;
  createdAt: number;
}

async function ensureDir(): Promise<void> {
  if (!(await RNFS.exists(BACKUPS_DIR))) {
    await RNFS.mkdir(BACKUPS_DIR);
  }
}

/** Reads Waypoints+Routes off the watch and saves them as raw binary files locally - the
 * exact same two regions exportNavigationToGpx() already reads, just kept as raw bytes
 * instead of being parsed into a GPX. Read-only, no risk to the watch. */
export async function createNavBackup(): Promise<void> {
  await ensureDir();
  await connect();
  try {
    const bases = await readNavBases();
    const [waypointsB64, routesB64] = await Promise.all([
      readRegion(bases.waypointBase, bases.waypointSize),
      readRegion(bases.routeBase, bases.routeSize),
    ]);
    const prefix = String(Date.now());
    await RNFS.writeFile(`${BACKUPS_DIR}/${prefix}_waypoints.bin`, waypointsB64, 'base64');
    await RNFS.writeFile(`${BACKUPS_DIR}/${prefix}_routes.bin`, routesB64, 'base64');
  } finally {
    await disconnect().catch(() => {});
  }
}

/** Every backup created so far, newest first - grouped by the shared timestamp prefix
 * createNavBackup() names both files with. */
export async function listNavBackups(): Promise<BackupEntry[]> {
  await ensureDir();
  const files = await RNFS.readDir(BACKUPS_DIR);
  const prefixes = new Set<string>();
  for (const f of files) {
    const m = /^(\d+)_(waypoints|routes)\.bin$/.exec(f.name);
    if (m) prefixes.add(m[1]);
  }
  return Array.from(prefixes)
    .map(prefix => ({ prefix, createdAt: parseInt(prefix, 10) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function backupsFolderPath(): string {
  return BACKUPS_DIR;
}

/**
 * "Backup database to folder" (André, 2026-08-16) - the keyless replacement for the cloud-OAuth
 * upload. Reads the same two nav regions createNavBackup() does, bundles them into one file, and
 * hands it to the system "Save as" picker so the user can drop it in any folder - point it at a
 * Dropbox/OneDrive/Drive sync folder and it syncs, no keys, no sign-in.
 *
 * One bundled file (not the two raw .bin) so it's a single tap through one picker; Android backup
 * is export-only anyway (no raw-region write exists here - see this file's header), so this is a
 * safety copy, with both regions recoverable from the base64 inside. Throws SAVE_AS_CANCELLED if
 * the user backs out of the picker - callers treat that as a no-op, not an error.
 */
export async function backupNavToFile(): Promise<void> {
  await connect();
  try {
    // Per-device region bases from the watch's own 0x0b21 map (not the hardcoded Ambit3
    // offsets), so a Traverse backs up its real Waypoints/Routes regions.
    const bases = await readNavBases();
    const [waypointsB64, routesB64] = await Promise.all([
      readRegion(bases.waypointBase, bases.waypointSize),
      readRegion(bases.routeBase, bases.routeSize),
    ]);
    const bundle = JSON.stringify({
      format: 'ambit-nav-backup',
      version: 1,
      createdAt: Date.now(),
      routes_b64: routesB64,
      waypoints_b64: waypointsB64,
    });
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `Sommet-nav-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
      + `-${pad(d.getHours())}${pad(d.getMinutes())}.ambitbak`;
    const tmp = `${RNFS.CachesDirectoryPath}/${name}`;
    await RNFS.writeFile(tmp, bundle, 'utf8');
    try {
      await saveFileAs(tmp, name, 'application/octet-stream');
    } finally {
      RNFS.unlink(tmp).catch(() => {});
    }
  } finally {
    await disconnect().catch(() => {});
  }
}

// ─── Cloud backup - added 2026-08-12 ("implement the ones that the user can set up easily by
// itself"). Optional second destination for the exact same two files above, uploaded to
// whichever provider is connected (Api{Dropbox,GoogleDrive,OneDrive}.ts). Desktop's own
// BackupPage.qml/CloudStorageService got this first (2026-08-12, same day) - this ports the
// same shape: local files stay untouched, only the naming at the cloud boundary differs. ──

export type CloudProvider = 'dropbox' | 'googledrive' | 'onedrive';

function providerApi(provider: CloudProvider) {
  if (provider === 'dropbox') return ApiDropbox;
  if (provider === 'googledrive') return ApiGoogleDrive;
  return ApiOneDrive;
}

const CLOUD_LABEL_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/** This app's own local prefix is Date.now() (ms epoch) - desktop's is "YYYYMMDD-HHMMSS".
 * The cloud naming convention uses desktop's shape (not this app's) so a backup uploaded
 * from either platform is recognizable, and downloadable, from the other - both are already
 * local-time based (Python's time.strftime() default, same as Date's own getters here), so
 * this only needs a format conversion, not a timezone one. */
function labelFromPrefix(prefix: string): string {
  const d = new Date(parseInt(prefix, 10));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`
       + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Reverse of labelFromPrefix() - falls back to the label itself (not a valid ms-epoch
 * prefix, but still a usable, if unsortable, local filename) if it doesn't parse, so
 * downloading a cloud backup that didn't originate from either app's own convention still
 * works. */
function prefixFromLabel(label: string): string {
  const m = CLOUD_LABEL_RE.exec(label);
  if (!m) return label;
  const [, y, mo, da, h, mi, s] = m;
  return String(
    new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(s)).getTime(),
  );
}

export async function uploadNavBackupToCloud(provider: CloudProvider, entry: BackupEntry): Promise<void> {
  const api = providerApi(provider);
  const label = labelFromPrefix(entry.prefix);
  await api.uploadFile(`${BACKUPS_DIR}/${entry.prefix}_routes.bin`, `${label}-routes.bin`);
  await api.uploadFile(`${BACKUPS_DIR}/${entry.prefix}_waypoints.bin`, `${label}-waypoints.bin`);
}

export interface CloudBackupEntry {
  label: string;
  createdAt: number; // ms epoch, 0 if the label doesn't parse as one of this convention's dates
}

/** Every backup found in the connected provider's app folder - same "only a real, complete
 * routes+waypoints pair counts" rule desktop's CloudStorageService applies. */
export async function listCloudNavBackups(provider: CloudProvider): Promise<CloudBackupEntry[]> {
  const api = providerApi(provider);
  const names = await api.listFiles();
  const labels = new Set<string>();
  for (const name of names) {
    if (name.endsWith('-routes.bin')) {
      const label = name.slice(0, -'-routes.bin'.length);
      if (names.includes(`${label}-waypoints.bin`)) labels.add(label);
    }
  }
  return Array.from(labels)
    .map(label => {
      const m = CLOUD_LABEL_RE.exec(label);
      const createdAt = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime()
        : 0;
      return { label, createdAt };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Downloads both files into BACKUPS_DIR under this app's own local naming convention, so
 * listNavBackups() picks the result up immediately - no separate cloud-restore UI needed. */
export async function downloadNavBackupFromCloud(provider: CloudProvider, label: string): Promise<void> {
  await ensureDir();
  const api = providerApi(provider);
  const prefix = prefixFromLabel(label);
  await api.downloadFile(`${label}-routes.bin`, `${BACKUPS_DIR}/${prefix}_routes.bin`);
  await api.downloadFile(`${label}-waypoints.bin`, `${BACKUPS_DIR}/${prefix}_waypoints.bin`);
}
