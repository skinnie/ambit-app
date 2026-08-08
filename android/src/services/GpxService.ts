import RNFS from 'react-native-fs';

const ACTIVITIES_DIR = `${RNFS.DocumentDirectoryPath}/activities`;

/** S'assure que le dossier activities/ existe. */
async function ensureDir(): Promise<void> {
  const exists = await RNFS.exists(ACTIVITIES_DIR);
  if (!exists) await RNFS.mkdir(ACTIVITIES_DIR);
}

/**
 * Écrit un fichier GPX sur le téléphone.
 * @param id      Identifiant unique du log (ex: "20240615_093000")
 * @param gpxXml  Contenu GPX en string
 * @returns       Chemin absolu du fichier écrit, ou null si déjà existant
 */
export async function writeGpxFile(id: string, gpxXml: string): Promise<string | null> {
  await ensureDir();
  const path = `${ACTIVITIES_DIR}/${id}.gpx`;
  if (await RNFS.exists(path)) return null; // doublon, ne pas écraser
  await RNFS.writeFile(path, gpxXml, 'utf8');
  return path;
}

/** Lit un fichier GPX depuis le stockage local. */
export async function readGpxFile(path: string): Promise<string> {
  return RNFS.readFile(path, 'utf8');
}

/** Supprime un fichier GPX du stockage local. */
export async function deleteGpxFile(path: string): Promise<void> {
  if (await RNFS.exists(path)) await RNFS.unlink(path);
}

/** Liste tous les fichiers GPX présents dans le dossier activities/. */
export async function listGpxFiles(): Promise<string[]> {
  await ensureDir();
  const items = await RNFS.readDir(ACTIVITIES_DIR);
  return items
    .filter(item => item.name.endsWith('.gpx'))
    .map(item => item.path);
}
