import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { base64ToBytes } from './Base64';

// App-Zone catalog, imported from the user's OWN SuuntoLink 'suunto-apps/index.json' (we ship
// none of Suunto's proprietary content, and the App Zone service is dead so there's no live
// source). The heavy 29 MB index.json is parsed NATIVELY (AmbitCatalogModule, streaming) into a
// compact catalog.json + catalog.bin in app storage; this TS layer reads that compact copy:
// catalog.json (a few MB) is JSON.parsed, and each app's bytecode is sliced out of catalog.bin
// by binaryOffset/binaryLength - never loading the whole 9 MB blob at once.

const Native = (NativeModules as any).AmbitCatalog as
  | {
      hasCatalog(): Promise<boolean>;
      catalogPath(): Promise<string>;
      binPath(): Promise<string>;
      importIndex(): Promise<{ count: number; bytes: number }>;
      pickFile(): Promise<{ base64: string; name: string }>;
    }
  | undefined;

/** Pick any small file and return its raw contents (base64) + filename. Used to import a
 * compiled interval app the user downloaded from the compiler site. */
export async function pickFile(): Promise<{ base64: string; name: string }> {
  if (!Native) throw new Error('native-missing');
  return Native.pickFile();
}

export interface CatalogEntry {
  ruleId: number;
  name: string;
  categoryId: number;
  activityId: number;
  description: string;
  compatibleVariants: string[];
  binaryOffset: number;
  binaryLength: number;
}

export function isCatalogAvailable(): boolean {
  return !!Native;
}

export async function hasCatalog(): Promise<boolean> {
  if (!Native) return false;
  return Native.hasCatalog();
}

/** Pops the system file picker for index.json and stream-extracts it natively. Returns how
 * many apps + how many bytecode bytes were imported. */
export async function importCatalog(): Promise<{ count: number; bytes: number }> {
  if (!Native) throw new Error('native-missing');
  return Native.importIndex();
}

let _entries: CatalogEntry[] | null = null;

export async function getEntries(): Promise<CatalogEntry[]> {
  if (_entries) return _entries;
  if (!Native) return [];
  const path = await Native.catalogPath();
  const json = await RNFS.readFile(path, 'utf8');
  _entries = (JSON.parse(json).entries ?? []) as CatalogEntry[];
  return _entries;
}

/** Drop the in-memory cache (after a re-import). */
export function invalidateEntries(): void { _entries = null; }

/** The compiled bytecode for one app, sliced out of catalog.bin by offset/length. */
export async function getBinary(entry: CatalogEntry): Promise<Uint8Array> {
  if (!Native) throw new Error('native-missing');
  const path = await Native.binPath();
  // RNFS.read(path, length, position, encoding) - a windowed read, so the 9 MB blob is never
  // loaded whole. Base64 out, decoded to bytes.
  const b64 = await RNFS.read(path, entry.binaryLength, entry.binaryOffset, 'base64');
  return base64ToBytes(b64);
}
