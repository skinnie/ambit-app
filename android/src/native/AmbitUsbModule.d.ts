// Re-export des types depuis AmbitUsbModule.ts
export type { AmbitDeviceInfo, SyncProgressEvent } from './AmbitUsbModule';
export { connect, disconnect, getLogs, updateSgee, onSyncProgress } from './AmbitUsbModule';