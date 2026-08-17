import RNFS from 'react-native-fs';
import { connect, disconnect, readRegion, saveFileAs } from '../native/AmbitUsbModule';
import { readNavBases } from './MemoryMap';

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
