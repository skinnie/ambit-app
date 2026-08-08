import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityRecord {
  id: string;
  synced_at: number;      // timestamp Unix (ms)
  gpx_path: string;
  date: string;           // ISO 8601, ex: "2024-06-15T09:30:00"
  duration_s: number;     // durée en secondes
  distance_m: number;     // distance en mètres
  d_plus: number;         // dénivelé positif cumulé (m)
  activity_type: string;  // ex: "Orienteering", "Running"…
}

// ─── Singleton DB ─────────────────────────────────────────────────────────────

let _db: SQLiteDatabase | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabase({ name: 'ambitsync.db', location: 'default' });
  await _db.executeSql(`
    CREATE TABLE IF NOT EXISTS activities (
      id            TEXT    PRIMARY KEY,
      synced_at     INTEGER NOT NULL,
      gpx_path      TEXT    NOT NULL,
      date          TEXT    NOT NULL DEFAULT '',
      duration_s    INTEGER NOT NULL DEFAULT 0,
      distance_m    INTEGER NOT NULL DEFAULT 0,
      d_plus        INTEGER NOT NULL DEFAULT 0,
      activity_type TEXT    NOT NULL DEFAULT ''
    )
  `);
  // Table liste noire : activités supprimées volontairement, ne jamais re-importer
  await _db.executeSql(`
    CREATE TABLE IF NOT EXISTS deleted_activities (
      id         TEXT    PRIMARY KEY,
      deleted_at INTEGER NOT NULL
    )
  `);
  // Migrations
  await _db.executeSql(
    `ALTER TABLE activities ADD COLUMN activity_type TEXT NOT NULL DEFAULT ''`
  ).catch(() => {});
  return _db;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/** Vérifie si un log a déjà été synchronisé ET n'est pas dans la liste noire. */
export async function isActivitySynced(id: string): Promise<boolean> {
  const db = await getDb();
  const [[synced], [deleted]] = await Promise.all([
    db.executeSql('SELECT 1 FROM activities WHERE id = ? LIMIT 1', [id]),
    db.executeSql('SELECT 1 FROM deleted_activities WHERE id = ? LIMIT 1', [id]),
  ]);
  return synced.rows.length > 0 || deleted.rows.length > 0;
}

/** Vérifie si un ID est dans la liste noire (supprimé volontairement). */
export async function isActivityDeleted(id: string): Promise<boolean> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT 1 FROM deleted_activities WHERE id = ? LIMIT 1', [id]
  );
  return result.rows.length > 0;
}

/** Enregistre une activité synchronisée dans la base. */
export async function markActivitySynced(record: ActivityRecord): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    `INSERT OR REPLACE INTO activities
       (id, synced_at, gpx_path, date, duration_s, distance_m, d_plus, activity_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.synced_at,
      record.gpx_path,
      record.date,
      record.duration_s,
      record.distance_m,
      record.d_plus,
      record.activity_type,
    ]
  );
}

/** Retourne toutes les activités triées par date décroissante. */
export async function getAllActivities(): Promise<ActivityRecord[]> {
  const db = await getDb();
  const [result] = await db.executeSql(
    'SELECT * FROM activities ORDER BY date DESC'
  );
  const activities: ActivityRecord[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    activities.push(result.rows.item(i));
  }
  return activities;
}

/** Retourne tous les IDs connus (synchro + liste noire) pour éviter re-import. */
export async function getAllSyncedIds(): Promise<string[]> {
  const db = await getDb();
  const [[synced], [deleted]] = await Promise.all([
    db.executeSql('SELECT id FROM activities'),
    db.executeSql('SELECT id FROM deleted_activities'),
  ]);
  const ids: string[] = [];
  for (let i = 0; i < synced.rows.length; i++) ids.push(synced.rows.item(i).id);
  for (let i = 0; i < deleted.rows.length; i++) ids.push(deleted.rows.item(i).id);
  return ids;
}

/** Met à jour uniquement le type d'activité d'un enregistrement existant. */
export async function updateActivityType(id: string, activityType: string): Promise<void> {
  const db = await getDb();
  await db.executeSql(
    'UPDATE activities SET activity_type = ? WHERE id = ?',
    [activityType, id]
  );
}

/** Supprime une activité de la base et l'ajoute à la liste noire pour ne pas la re-importer. */
export async function deleteActivity(id: string): Promise<void> {
  const db = await getDb();
  await db.executeSql('DELETE FROM activities WHERE id = ?', [id]);
  await db.executeSql(
    'INSERT OR IGNORE INTO deleted_activities (id, deleted_at) VALUES (?, ?)',
    [id, Date.now()]
  );
}
