import { NativeModules } from 'react-native';

// Thin TS wrapper over the native AmbitSmartSensor module (Phase 1). The Suunto Smart Sensor
// is a SEPARATE BLE peripheral (the HR belt) - standard GATT services, nothing to do with the
// watch or the USB cable: Device Information (0x180A), Battery (0x180F), Heart Rate (0x180D).
// Direct port of the desktop's smartsensorservice + tools/smart_sensor.py scope: identity /
// firmware / battery / a live HR reading, plus Forget (unpair). Read-only aside from Forget -
// it cannot brick anything.
//
// The native module ships in a later build; until then isSmartSensorAvailable() is false and
// the screen says so rather than throwing.

const Native = (NativeModules as any).AmbitSmartSensor as
  | {
      scan(): Promise<SmartSensorStatus>;
      forget(): Promise<boolean>;
    }
  | undefined;

export interface SmartSensorStatus {
  found: boolean;
  manufacturer?: string;
  model?: string;
  serial?: string;
  hwRevision?: string;
  fwRevision?: string;
  swRevision?: string;
  batteryPercent?: number; // -1 = not reported
  heartRateBpm?: number;   // -1 = no reading (belt not worn is the common case, not an error)
}

export function isSmartSensorAvailable(): boolean {
  return !!Native;
}

export async function scanSmartSensor(): Promise<SmartSensorStatus> {
  if (!Native) throw new Error('native-missing');
  return Native.scan();
}

export async function forgetSmartSensor(): Promise<boolean> {
  if (!Native) throw new Error('native-missing');
  return Native.forget();
}
