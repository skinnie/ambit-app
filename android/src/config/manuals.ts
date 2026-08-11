// Real, 2026-08-11 (André: "correlation between the devices we support and their manual
// link"). Same table as desktop's HomeViewModel.qml `_manualUrls` - one official Suunto
// user-guide PDF per codename, from `manualslinks` at the repo root (Suunto's own
// ns.suunto.com Userguides paths). Keyed by the codename AmbitDeviceInfo.model already
// carries (the same field isKailash() in HomeScreen.tsx checks), so a new supported model
// only ever needs adding once, here and in the desktop copy.
export const MANUAL_URLS: Record<string, string> = {
  Bluebird: 'https://ns.suunto.com/Manuals/Ambit/Userguides/Suunto_Ambit_UserGuide_EN.pdf',
  Duck: 'https://ns.suunto.com/Manuals/Ambit2/Userguides/Suunto_Ambit2_UserGuide_EN.pdf',
  Colibri: 'https://ns.suunto.com/Manuals/Ambit2_S/Userguides/Suunto_Ambit2_S_UserGuide_EN.pdf',
  Greentit: 'https://ns.suunto.com/Manuals/Ambit2_R/Userguides/Suunto_Ambit2_R_UserGuide_EN.pdf',
  Emu: 'https://ns.suunto.com/Manuals/Ambit3_Peak/Userguides/Suunto_Ambit3_Peak_UserGuide_EN.pdf',
  Finch: 'https://ns.suunto.com/Manuals/Ambit3_Sport/Userguides/Suunto_Ambit3_Sport_UserGuide_EN.pdf',
  Ibisbill: 'https://ns.suunto.com/Manuals/Ambit3_Run/Userguides/Suunto_Ambit3_Run_UserGuide_EN.pdf',
  Kaka: 'https://ns.suunto.com/Manuals/Ambit3_Vertical/Userguides/Suunto_Ambit3_Vertical_UserGuide_EN.pdf',
  Jabiru: 'https://ns.suunto.com/Manuals/Traverse/Userguides/Suunto_Traverse_UserGuide_EN.pdf',
  Loon: 'https://ns.suunto.com/Manuals/Traverse_Alpha/Userguides/Suunto_TraverseAlpha_UserGuide_EN.pdf',
  Hoopoe: 'https://ns.suunto.com/Manuals/Kailash/Userguides/Suunto_Kailash_UserGuide_EN.pdf',
};

/** Falls back to the Ambit3 Peak guide, this project's one reference watch. */
export function manualUrlFor(model: string | undefined | null): string {
  return (model && MANUAL_URLS[model]) || MANUAL_URLS.Emu;
}

// Real, 2026-08-11 (André: "I added etrex manuals to the files, can you link it to the
// supported devices?"). Same table as desktop's HomeViewModel.qml `garminManualUrl` - Garmin
// has no codename to key off (GarminModule's `model` is free text straight off the watch's
// own GarminDevice.xml <Model><Description>, e.g. "eTrex 30", "eTrex 32x"), and `manualslinks`
// only has two real eTrex guide PDFs covering whole sub-families each (Garmin's own manual
// page groups 10/20/20x/30/30x under one guide, 22x/32x under the other) - matched by family,
// not an exact key. "22x"/"32x" is the one substring that tells the two families apart.
const ETREX_22X_32X_URL = 'https://www8.garmin.com/manuals/webhelp/eTrex22x-32x/EN-US/eTrex_22x_32x_OM_EN-US.pdf';
const ETREX_10_20_30_URL = 'https://www8.garmin.com/manuals/webhelp/eTrex_10_20x_30x/EN-US/eTrex_10_20_20x_30_30x_OM_EN-US.pdf';

export function garminManualUrlFor(model: string | undefined | null): string {
  return model && /22x|32x/i.test(model) ? ETREX_22X_32X_URL : ETREX_10_20_30_URL;
}
