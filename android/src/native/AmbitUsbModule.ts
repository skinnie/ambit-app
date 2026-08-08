import { NativeModules, NativeEventEmitter } from 'react-native';
import type { DeviceConnector, DeviceInfo, SyncProgressEvent } from './DeviceConnector';

const { AmbitUsbModule: NativeAmbit } = NativeModules;

if (!NativeAmbit) {
  throw new Error(
    'AmbitUsbModule natif introuvable. ' +
    'Vérifiez que AmbitUsbPackage est bien enregistré dans MainApplication.kt ' +
    'et que le build NDK a réussi.'
  );
}

// ─── Re-export des types génériques ───────────────────────────────────────────

export type { DeviceInfo, SyncProgressEvent };

// ─── Implémentation DeviceConnector pour Suunto Ambit (USB OTG + libambit) ───

const emitter = new NativeEventEmitter(NativeAmbit);

/**
 * Connecteur Suunto Ambit — implémente DeviceConnector.
 * Supporte Ambit 1, 2, 2S, 2R, 3 Peak, 3 Sport, 3 Run, 3 Vertical.
 */
export const ambitConnector: DeviceConnector = {
  connect(): Promise<DeviceInfo> {
    return NativeAmbit.connect();
  },

  disconnect(): Promise<void> {
    return NativeAmbit.disconnect();
  },

  getLogs(knownIds: string[] = []): Promise<string[]> {
    return NativeAmbit.getLogs(knownIds);
  },

  updateSgee(path: string): Promise<boolean> {
    return NativeAmbit.updateSgee(path);
  },

  onSyncProgress(callback: (event: SyncProgressEvent) => void): () => void {
    const subscription = emitter.addListener('AmbitSyncProgress', callback);
    return () => subscription.remove();
  },
};

// ─── API fonctionnelle (rétro-compatibilité) ──────────────────────────────────

export const connect    = () => ambitConnector.connect();
export const disconnect = () => ambitConnector.disconnect();
export const getLogs    = (knownIds?: string[]) => ambitConnector.getLogs(knownIds);
export const updateSgee = (path: string) => ambitConnector.updateSgee!(path);
export const onSyncProgress = (cb: (e: SyncProgressEvent) => void) =>
  ambitConnector.onSyncProgress(cb);

export function shareFile(filePath: string, mimeType = 'application/gpx+xml'): Promise<void> {
  return NativeAmbit.shareFile(filePath, mimeType);
}

export function saveToDownloads(filePath: string, fileName: string, mimeType = 'application/gpx+xml'): Promise<void> {
  return NativeAmbit.saveToDownloads(filePath, fileName, mimeType);
}
