// ─── DemoDevices ──────────────────────────────────────────────────────────────
// Testing mode ("pretend a device is connected, look around the app without one") for Android
// - port of the desktop feature (André, 2026-08-16). Desktop gets its device list from the
// Python backend's capability table; Android has no backend, so the catalogue of watches the
// app already understands is a static list here. Picking one makes Home show it as connected.
//
// Each entry is shaped like AmbitDeviceInfo (so Home can use it directly) plus the demo variant
// codename + whether it's a Kailash (the app keys some UI off that). Firmware/hardware/serial
// are representative sample values - Testing mode never touches a real watch.

import { AmbitDeviceInfo } from '../native/AmbitUsbModule';

export interface DemoDevice extends AmbitDeviceInfo {
  variant: string;    // codename, e.g. "Emu"
  isKailash: boolean;
}

// The watches Testing mode can pretend to be - the ones this app has figured out: the Ambit3
// family, Traverse / Traverse Alpha, and Kailash (André's list). Names/models match the real
// device-info strings; the model string is what Home's isKailash()/manual lookup keys off.
export const DEMO_DEVICES: DemoDevice[] = [
  { variant: 'Emu',      name: 'Suunto Ambit3 Peak',     model: 'Ambit3 Peak',     serial: 'A30E115119001200', fwVersion: '2.5.11', hwVersion: '71.2.0', battery: 87, isKailash: false },
  { variant: 'Finch',    name: 'Suunto Ambit3 Sport',    model: 'Ambit3 Sport',    serial: 'A30F215220002100', fwVersion: '2.5.11', hwVersion: '71.2.0', battery: 64, isKailash: false },
  { variant: 'Ibisbill', name: 'Suunto Ambit3 Run',      model: 'Ambit3 Run',      serial: 'A30R315321003200', fwVersion: '2.5.11', hwVersion: '71.2.0', battery: 72, isKailash: false },
  { variant: 'Kaka',     name: 'Suunto Ambit3 Vertical', model: 'Ambit3 Vertical', serial: 'A30V415422004300', fwVersion: '2.5.11', hwVersion: '72.1.0', battery: 55, isKailash: false },
  { variant: 'Jabiru',   name: 'Suunto Traverse',        model: 'Traverse',        serial: 'A50J515523005400', fwVersion: '2.0.22', hwVersion: '73.1.0', battery: 91, isKailash: false },
  { variant: 'Loon',     name: 'Suunto Traverse Alpha',  model: 'Traverse Alpha',  serial: 'A50L615624006500', fwVersion: '2.0.22', hwVersion: '73.2.0', battery: 40, isKailash: false },
  { variant: 'Hoopoe',   name: 'Kailash',                model: 'Kailash',         serial: 'A70H715725007600', fwVersion: '1.6.30', hwVersion: '80.1.0', battery: 78, isKailash: true },
];

export function demoDeviceFor(variant: string): DemoDevice {
  return DEMO_DEVICES.find(d => d.variant === variant) ?? DEMO_DEVICES[0];
}
