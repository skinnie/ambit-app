# Changelog

All notable changes to the AmbitApp Android app (fork of `guiguoz/opensportsync`) are
recorded here, newest first.

## 2.5.11 (2026-08-08)

Real feature work, sourced from this file's own git history rather than reconstructed from
memory - intermediate version numbers between 2.3.4-beta and this one were not individually
itemized in this file, this entry covers the whole real gap. Same day, this repo's own
`android/` also absorbed `guiguoz/opensportsync`'s real upstream git history via a `git
subtree` import (internal repo housekeeping, not a user-facing change - see
`V3_CHANGELOG.md`'s own dated entry for that).

- **Kailash (7R) support, real and hardware-confirmed**: USB product ID recognition
  (`0x002a`), travel-history and TrackLog sync (visited cities/countries, last known
  location, logbook), and a device-aware Settings screen sharing the same UI as the Ambit3
  (its own separately-curated field table, since the two watches' schemas don't share entry
  IDs even for identically-named fields).
- **Ambit3 Settings UI**: real cable settings read/write (`0x1100`/`0x1101`), confirmed on
  real hardware.
- **Kailash Home Location**: a real settings field (`sml.DeviceSettings.HomeLocation`,
  `Latitude`/`Longitude`) found from real BLE captures and confirmed against the watch's own
  schema descriptor - read+write, range-checked, confirmed-by-reread. See
  `custom_modes_andre.md`'s "Kailash Home Location" section for the full derivation. Not yet
  hardware-tested for the write side specifically.
- **Sport Modes screen (Ambit3-only, CustomModes)**: rename, autolap, HR limits, sensor
  pods, and per-display field type editing - the same real, hardware-confirmed mechanism the
  desktop app already has, ported to native/JNI/TypeScript. The native write path itself is
  not yet hardware-confirmed on this platform specifically (every prior write re-reads to
  confirm; a broken composition would show up as a write that doesn't stick, not a silent
  false "done").

## V2.3.4 beta - 2.3.4-beta (2026-08-07)

- Fixed "activities disappear after unplugging the device": they never actually did — the
  local SQLite DB and on-disk GPX files are untouched by device connection state, and
  LogListScreen already rebuilds its list from disk on every visit regardless. The real bug
  was a navigation dead-end: unplugging a device sends Home back into its
  searching/timeout/connect-error states, none of which had a way to reach "View
  activities" — only "Connect device later" did. Added a direct View Activities link to
  all three of those states so it's always reachable, not just after that one specific tap.

## V2.3.3 beta - 2.3.3-beta (2026-08-07)

- Ambit firmware Backup screen now opens the system "Save as" picker for the downloaded
  file instead of silently writing it to app-private storage — Downloads is the picker's
  default location, but any folder can be chosen. New generic `saveFileAs()` native call
  (Storage Access Framework `ACTION_CREATE_DOCUMENT`).
- Investigated "Garmin and Suunto both ask for USB permission every time" — this is
  Android's own device-access security prompt, not something this app added, and there is
  no supported way for a regular app to skip it entirely. In normal use it should only
  appear once per device: the system's own permission dialog has a "use by default for
  this device" option, and once granted, reconnecting the same device won't prompt again
  until the app is uninstalled or the grant is revoked. No code change — during this
  session's frequent uninstall/reinstall testing cycle, every reinstall wipes that stored
  grant, which is why it looked like it was prompting "every time."

## V2.3.2 beta - 2.3.2-beta (2026-08-07)

**Automatic connecting flow** — Home no longer has manual "Connect"/"Garmin" buttons.
Plugging in a watch or Garmin device now drives a single flow: "Searching for your
device…" → real connect (with Garmin's up-to-45s mount wait shown live) → device info
and the right menu, automatically. A 15s no-device timeout and a "Connect device later"
option (view activities + settings only) cover the no-hardware case.

**Ambit device info + firmware backup** — Home now shows the watch's name, battery
level, firmware version, and hardware version, same as Garmin already did. New
`getDeviceInfo()` native call (`CMD_STATUS`/0x0306 for battery, on top of the existing
device-info reply) backs this. A new Backup screen checks Suunto's live firmware-update
service and can save the firmware file locally — clearly marked backup-only: the file is
a proprietary Suunto container (not a real zip despite the name), so this app has no way
to flash it back onto the watch.

**Renamed menu buttons** — Ambit: Activities / Routes / POIs / Backup. Garmin: Sync
Activities / Routes / POIs.

**Garmin menus split to mirror the Ambit ones** — the three Garmin buttons used to all
open the same combined screen. Now: "Sync Activities" reads and logs activities directly
from Home, no sub-screen, same as Ambit's Activities button. "Routes" opens a screen with
just Send a route (GPX → SD card) and Export routes (reads saved GPX files from
`Garmin/GPX` on both internal memory and SD card, saves to Downloads, with a per-file
Share… for choosing another destination). "POIs" is its own screen with Send a POI (same
SD-card GPX mechanism) and Retrieve POIs (reads BaseCamp's `Waypoints*.gpx` files the same
way). New native `listGpxDirFiles`/`readGpxDirFile` calls back this.

- Garmin mass-storage mount can take up to ~40s after the USB link comes up; `connect()`
  now retries for up to 45s with live progress instead of failing on the first attempt
- Removed the "Test Bluetooth connection" debug button from the Route screen (BLE
  connect/pairing is exercised directly through Send/Export now, no separate probe needed)

## V2.3 beta - 2.3.0-beta (2026-08-07)

**Garmin support (new device family)** — detects whether a connected USB device is an
Ambit/Traverse or a Garmin (eTrex series) and routes to a separate, purpose-built feature
set for Garmin, since it works completely differently (plain GPX files on a FAT filesystem
via USB Mass Storage, not the Ambit3's NSP flash protocol):
- Device identification: model, firmware version, part number, read from the device's own
  `GarminDevice.xml` descriptor — no hardcoded lookup table
- Import recorded activities (reads the device's resolved GPX/Current-equivalent folder);
  imported activities join the same local activity list as Ambit-sourced ones, so FIT
  export and all existing 3rd-party sync (Strava/Runalyze/Livelox/Intervals.icu) work
  identically, with no new sync code
- Upload a GPX file (route or POI — same file format either way) to the device — **SD card
  only, by design: never writes to the device's internal memory**, with an explicit in-app
  warning; the feature is disabled entirely if no SD card is detected
- Built on `libaums` (Apache 2.0) for USB Mass Storage access, since stock Android has no
  built-in support for arbitrary USB-OTG mass storage devices
- See `GARMIN_USB_IMPORT_SPEC.md` for the full research trail (real hardware: a Garmin
  eTrex 30) and open items (SD-card-write behavior on a real populated card, and other
  eTrex generations' folder conventions, are not yet verified on hardware)

**Bluetooth support for Ambit3/Traverse (from v0.3.0, carried into this build)** — send/
read route, POI, orbital data, activity sync. Experimental, gated behind a clear in-app
disclaimer. Protocol layer (frame format, command set, Service Changed handling) is
confirmed against a real hardware capture; the BLE connect/pairing step itself is still
being debugged on real hardware and not yet fully reliable. See `HANDOFF.md` in the
ambit-app research project for the detailed status.

## V2 - 0.2.1

- Orbital (AGPS) data download and update
- POI import (GPX file and manual coordinates)
- POI export
- Activity export as FIT file
- Third-party sync to intervals.icu
- Route import via GPX, sent to the watch
- Route export: read routes/waypoints from the watch, save as GPX
- Forced English translation (removed inconsistent partial French)
- New adaptive app icon
- `armeabi-v7a` and `x86_64` build targets added, alongside `arm64-v8a`

## V1

- Ambit3 family support added: retrieve recorded activities over USB OTG

## V0

- Fixed the fork so it launches at all (upstream `opensportsync` shipped a debug-only build
  with no JS bundling step, crashing on start)
