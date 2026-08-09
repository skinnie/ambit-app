import { NativeModules } from 'react-native';

const { AmbitBleModule: NativeAmbitBle } = NativeModules;

if (!NativeAmbitBle) {
  throw new Error(
    'AmbitBleModule native module not found. ' +
    'Check that AmbitBlePackage is registered in MainApplication.kt ' +
    'and that the NDK build succeeded.'
  );
}

/**
 * EXPERIMENTAL — BLE connect for AmbitApp, v0.3.0. Ambit3/Traverse series,
 * plus the Kailash (added 2026-08-09 — driven internally as an Ambit3 Peak,
 * see AmbitBleModule.kt's COMPATIBLE_NAME_PREFIXES and KAILASH-BLE-FINDINGS.md
 * Finding 8; the Kailash has no Routes/POI feature at all though, see
 * KAILASH-SCOPING-NOTE.md — only Sync/Backup make sense for it here).
 * Real-hardware-tested as of 2026-08-09: pairing itself now works
 * (see HANDOFF.md Milestone 7's dated entries that day for the two real bugs
 * found and fixed — an unhandled PAIRING_VARIANT_PASSKEY, and a
 * BLUETOOTH_PRIVILEGED permission wall on setPairingConfirmation()).
 *
 * Deliberately thin: once connected, every other watch operation
 * (writeRoute, readRegion, addPoi, ...) is imported from AmbitUsbModule.ts
 * as usual and works unchanged — they operate on the same native g_device
 * regardless of which transport connected it. Only connection setup is
 * BLE-specific.
 */

/** Scans for an advertising Ambit3/Traverse/Kailash and connects. The watch's
 * "Sync now" action must have just been triggered — its advertising window
 * is short, so call this right after, not any earlier (see RouteScreen.tsx's
 * waitForSyncNowTap). Resolves once the watch's device info has been read
 * back and confirmed (see protocol_ble.c) — from here on, writeRoute()/
 * readRegion()/etc. from AmbitUsbModule.ts work
 * the same as over cable. */
export function scanAndConnect(): Promise<boolean> {
  return NativeAmbitBle.scanAndConnect();
}

export function disconnectBle(): Promise<void> {
  return NativeAmbitBle.disconnectBle();
}
