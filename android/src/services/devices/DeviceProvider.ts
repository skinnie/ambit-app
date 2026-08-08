// ─── DeviceProvider ───────────────────────────────────────────────────────────
// Interface générique pour toute montre GPS connectée via USB OTG.
// Permet à SyncService et aux exports d'être indépendants du hardware.

import { SyncProgressEvent } from '../../native/AmbitUsbModule';

export interface DeviceInfo {
  name: string;
  vendorId: number;
  productId: number;
}

export interface DeviceProvider {
  /** Nom lisible du provider, ex. "Suunto Ambit" */
  readonly deviceName: string;

  /** Détecte la montre, demande la permission USB et initialise la connexion. */
  connect(): Promise<DeviceInfo>;

  /** Ferme la connexion proprement. */
  disconnect(): Promise<void>;

  /** Récupère tous les logs sous forme de strings GPX.
   *  knownIds : IDs déjà en DB (format YYYYMMDDTHHMMSS) — les logs correspondants sont skippés côté montre. */
  getLogs(knownIds?: string[]): Promise<string[]>;

  /** S'abonne aux événements de progression pendant getLogs(). Retourne une fonction de désinscription. */
  onSyncProgress(callback: (event: SyncProgressEvent) => void): () => void;

  /** Envoie le fichier SGEE (éphémérides GPS) à la montre. Optionnel selon le device. */
  updateSgee?(path: string): Promise<boolean>;
}
