# CustomModes (sport modes): what's in the assets, searched in the requested order

Researched 2026-08-05, while waiting on the DailyActivity poll. André's hypothesis was right:
`CustomModes` (the flash region this project found earlier tonight - `0x2000`, 12288 bytes,
7522 non-`0xFF` bytes of real data) is the on-watch storage for **customizable sport modes**.
Searched in the requested order: SuuntoLink, openambit, Moveslink2, Movescount.

## 1. SuuntoLink - the full UI-facing data model, and the real device-write entry points

`assets/WIndows apps/suuntolink_roaming/app-4.1.15/resources/app/ambit/sport_mode.js` is the
complete JSON schema for a sport mode: `CustomModeID`, `Name`, `ActivityID`, `UseAccelerometer`,
`Triggers` (autolap), `UseHRBelt`/`UseCadencePOD`/`UseBikePOD`/`UseFootPOD`/`UsePowerPOD`,
`AltiBaroMode`, `GpsInterval`, `RecordingInterval`, `AutoPause`, `BacklightMode`,
`NavigationSelection`, `HeartRateLimits`, `IntervalTimer`, plus a `Displays` array (each with
`TemplateType`/`Fields`, matching the watch's actual screen layouts). Also has
`getMaxSportModes()` (5 for Traverse/Traverse Alpha, 10 for Ambit2/Ambit3), `getMaxSuuntoApps()`,
`getMaxNameLength()`, and a large per-activity-ID default-settings lookup table
(`getActivityDefaults`, ~100 entries). This file is purely the app-side model, though - no
device serialization in it.

`CustomModes` doesn't appear anywhere in the SBEM schema dictionary this project already has
(`descr+<SERIAL>+2.4.17` / `tools/sbem_schema.py`) - confirmed by grep, zero hits. **This means
CustomModes is not part of the `0x1100`/`0x1101` settings-tree mechanism at all** - it's a
dedicated flash region with its own NSP command family, matching the native task classes
found earlier: `Task::NSP::NspTaskEraseCustomModes` / `NspTaskWriteCustomModes` /
`NspTaskValidateCustomModes`.

The one file across all of SuuntoLink's JS that references `CustomModes` as a literal string
is `ui/sport_mode_editor.js`, via `Settings.CustomModes[0]` - confirming the app's own in-memory
model nests it under `Settings`, even though the wire protocol handles it completely separately
from `DeviceSettings`.

**The real write path is in `SDSApplicationServer.exe.c`** (`assets/WIndows apps/
suuntoapp_local/decompiled/`, 1.16M lines, already decompiled by this project previously - the
same file HANDOFF.md already cites for `EmuDevice::writeRoutesBinaryArea`):

- `EmuDevice::saveCustomModes` (`Emu\EmuDevice.cpp`) - the same three-step sequence already
  known from the class names: **Erase -> build binary -> Write -> Validate**, with real log
  lines (`"Erasing old custom modes"`, `"Erasing done, writing new modes"`, `"Validation ok,
  saving custom modes done"`).
- `Communist::BinaryAreaCustomModesConverter::convert` (`Laituri\BinaryAreaConverters.cpp`) -
  the generic "binary area" framework (shared scaffolding pattern, same shape as routes' own
  binary-area handling): zeroes the destination buffer to the flash region's fixed size, builds
  the payload, and explicitly checks it against the region size - confirmed live tonight,
  literally: `"CustomModes size larger than FLASH area"`, i.e. the 12288-byte limit this
  project already read from `0x0b21`.

## 2. openambit

Not present as a separate asset in this project - only this project's *own* C port
(`csrc/device_driver_ambit3_navigation.c`) exists, which doesn't implement CustomModes at all
yet. Nothing to search here beyond what's already known project-wide.

## 3. Moveslink2

`BLLWrapper.dll` (native PE32, the actual device-logic DLL behind the Mono/.NET
`Moveslink2.exe` shell) has real, rich symbols via plain `strings` (less stripped than the
Android `.so`), and turns up a **more specific** converter than SuuntoLink's generic one:

```
Communist::Bluebird::BluebirdCustomModeConverter::convertSubTreeCustomMode
Communist::Bluebird::BluebirdCustomModeConverter::convertSubTreeCustomModeSettings
Communist::Bluebird::BluebirdCustomModeConverter::convertSubTreeSportMode
..\Device\Laituri\Bluebird\BluebirdCustomMode.cpp
..\Device\Laituri\Bluebird\BluebirdCustomModeDisplay.cpp
BluebirdCustomModeConverter::addCustomModeFixedDisplays: did not add exercise compass for legacy support (%s)
```

Plus a local `Arrest::` REST-style API specifically for custom modes (`CustomModesContext`,
`GetCustomModesRules`, `HandleCustomModes`) - a local HTTP-ish interface Moveslink2's own UI
talks to, separate from the raw NSP layer. No decompiled pseudocode available for this specific
DLL (no existing Ghidra project for it, unlike `libkomposti-ng.so`), so this is symbol-level
evidence only - but it independently confirms the class names and source file paths
(`Laituri\Bluebird\BluebirdCustomMode.cpp`), and shows this SDK generation used "Bluebird"
naming distinct from `SDSApplicationServer.exe`'s "Emu"-prefixed classes.

**"Bluebird" is the internal codename for the original Ambit (Ambit1)** - confirmed elsewhere
in this project's own codename table (`obsolete/AMBIT3-SUUNTO-HANDOFF.md` (marked partly wrong at its own top - `HANDOFF.md` is current): "Bluebird=Ambit", USB ID
`1493:0011`), the same convention as "Emu"=Ambit3 Peak. So `BluebirdCustomModeConverter` (and
`BluebirdDevice::saveRoutes`, found earlier for routes) is Ambit1-era code, reused rather than
rewritten for Ambit2/Ambit3 - explaining why it's the class actually doing the work here despite
predating this project's reference watch by two device generations.

## 4. Movescount (the big one - full decompiled pseudocode, not just symbols)

`libkomposti-ng.so.c` has the **same** `Communist::Bluebird::BluebirdCustomModeConverter`
class as Moveslink2's DLL, but fully decompiled with real function bodies, not placeholders.
This is a large, complete, bidirectional conversion pipeline:

**Write direction:** `BluebirdCustomModeConverter::convertTreeToDevice`,
`convertDeviceTreeToBinary`, `convertSubTreeCustomMode`, `convertSubTreeSportMode`,
`convertSubTreeCustomModeDisplaysDisplay`, `convertSubTreeCustomModeSettings`,
`createCustomModeRuleConf`, `addCustomModeFixedDisplays` (+ a swimming-specific variant), and
per-display-type builders: `createCustomModeIntervalDisplay`, `createCustomModeCompassDisplay`,
`createCustomModeMapDisplay`, `createCustomModeNaviDisplay`, `createCustomModeAltiGraphOBDisplay`,
`createCustomModeBaroGraphOBDisplay`, `createCustomModeHuntDisplay`,
`createCustomModeMoonPhaseDisplay`, and more.

**Read-back direction (the watch -> app), also fully present:**
`convertDeviceCustomModeToTree`, `convertDeviceSportModeToTree`,
`convertDeviceCustomModeRulesToTree`, `convertDeviceCustomModeDisplaysToTree`,
`convertDeviceCustomModeSettingToTree`, `convertDeviceCustomModeDisplayToTree`. This means the
raw binary -> structured-data direction is also implemented here, not just the write side.

Checked one function body directly: the fully-qualified `Communist::Bluebird::
BluebirdCustomModeConverter::convertDeviceCustomModeToTree` (and several siblings) are thin
*thunks* - one-line wrappers calling an unqualified same-named function at a different address,
which holds the actual logic. Traced into the real one (below) - a genuinely large win.

## Traced further, 2026-08-05: the on-flash format is not SBEM0102 at all - it's a separate "BXml" binary format, and its full tag dictionary is sitting right there in the decompile

The real (non-thunk) `convertDeviceCustomModeToTree`
(`assets/APK/movescountapp/ghidra/libkomposti-ng.so.c:821361`) is called from
`convertDeviceToTree`, which does this first:

```
BXmlConverter::convertBinaryToTree(&tagMapping, param_1 /* raw bytes */, tree_out, 0x2800, utf8_flag)
```

`0x2800` = **10240 bytes** - out of `CustomModes`'s known 12288-byte flash region, meaning up
to 10240 bytes of it are this BXml-encoded tree (the remainder presumably header/checksum,
matching the same shape as Routes/Waypoints' own header-plus-body layout). The tree's root
path, confirmed as a literal string in the code: `"DEVICE_CUSTOM.EXERCISE_MODES"`.

**This means `CustomModes` uses a third, distinct on-device encoding** - not the fixed-stride
binary records this project already decoded for Routes/Waypoints, and not the SBEM0102
`[id][len][data]` entries used for `DeviceSettings`/POIs/`ActivityTracking` (confirmed earlier
tonight: `CustomModes` has zero hits anywhere in the SBEM schema dictionary). It's "BXml" -
Suunto's own binary-encoded XML-like tree format, with a tag dictionary mapping short numeric
IDs to path names, built by `BXmlTagMapping`/`BXmlIdMapping`.

**Both mapping tables are fully populated with real constants in the decompile, not opaque
placeholders - extracted programmatically, not by hand:**

`BXmlTagMapping` (26 entries, the container/structure tags):
```
0x02  DEVICE_DETAIL              0x100 EXERCISE_MODES              0x105 EXERCISE_MODES_DISPLAYS
0x10  FIRMWARE                   0x101 EXERCISE_MODES_MODE          0x106 EXERCISE_MODES_DISPLAY
0x11  FIRMWARE_DEVICE_INFO       0x102 EXERCISE_MODES_SETTING       0x107 EXERCISE_MODES_DISP_SETTING
0x20  HW_DETAILS                 0x103 EXERCISE_MODES_SETTING_NAME_LEN64
0x21  HW_DETAILS_SUPPORTED_DEVICES                                  0x108 EXERCISE_MODES_DISP_FIELD
0x22  HW_DETAILS_DEVICE                                             0x109 EXERCISE_MODES_DISP_FIELD_SETTING
0x03  DEVICE_CUSTOM                                                 0x10a EXERCISE_MODES_DISP_FIELD_SHORTCUT
                                                                     0x10b EXERCISE_MODES_TYPE
0x200 SPORT_MODES                                                   0x10c EXERCISE_MODES_RULES
0x210 SPORT_MODE                                                    0x10d EXERCISE_MODES_RULE
0x212 SPORT_MODE_SETTING_NAME
0x213 SPORT_MODE_ACTIVITY_ID
0x214 SPORT_MODE_EXERCISE
0x215 SPORT_MODE_SETTING_NAME_LEN64
```

`BXmlIdMapping` (98 entries - the leaf field-type and screen-template dictionary, matching
`sport_mode.js`'s `DisplayRow`/`DisplayType` enums exactly): `MT_MAIN`/`MT_EXERCISE`/`MT_NONE`
(record-type marker), then `FT_*` (field types shown on a display row - `FT_ALTI`, `FT_BARO`,
`FT_COMPASS`, `FT_HEART_RATE_AVG`, `FT_DISTANCE`, `FT_PACE`, `FT_BIKE_POWER_AVG`, ~15 distinct
`FT_SWIM_*` fields, `FT_NAVI_ARROW`/`FT_NAVI_DISTANCE`/`FT_NAVI_DIRECTION`, `FT_RECOVERY_TIME`,
`FT_TE`, etc. - 60+ values, IDs `0x00`-`0x6a`), then `PID_RUNNER_GPS_TEMPLATE_*` (22 screen
*template* layouts - `_1`/`_2`/... through `_22_NAVIGATION`, plus `_50_MAP_DRAW` and
`_100_DEBUG`, IDs `0x100`-`0x200`, terminated by `PID_..._NONE` = `0xfffe`).

This is close to a complete decode dictionary for the format - what's still needed is the
actual byte-level record structure (how these tag/field IDs get framed with lengths/values in
the BXml binary stream), which `BXmlConverter::convertBinaryToTree`/`convertTreeToBinary`
implement.

## The wire format itself, cracked and byte-verified against the real 12288-byte dump

`BXmlConverter::parseBinaryTag` (`libkomposti-ng.so.c:849186`) is the one primitive everything
else calls, and its body is short enough to read outright:

```c
if (cursor + 4 < total_size) {
    tag_id = buf[cursor] | (buf[cursor+1] << 8);   // u16 little-endian
    length = *(uint16_t *)(buf + cursor + 2);      // u16 little-endian
    return 1;  // success
}
```

**Every tag is a 4-byte header - `[u16 LE tag_id][u16 LE length]` - followed immediately by
`length` bytes of content**, which may itself be further nested tags. (There's a sibling
`parseBinaryNode`, 6 bytes - `[u16 tag_id][u16][u16]` - used for a container variant that
carries an extra field alongside the length; not yet pinned down exactly which callers need it
over the plain 4-byte tag.)

**Verified directly against the real `/tmp/dump_CustomModes.bin` captured earlier tonight**,
byte for byte, not just plausible-looking:

```
offset 0:  03 00 84 1d   -> tag=0x0003 DEVICE_CUSTOM      length=0x1d84=7556
offset 4:  00 01 1c 1a   -> tag=0x0100 EXERCISE_MODES      length=0x1a1c=6684
offset 8:  0b 01 02 00   -> tag=0x010b EXERCISE_MODES_TYPE length=2      value=2 (bytes 12-13)
offset 14: 01 01 66 02   -> tag=0x0101 EXERCISE_MODES_MODE length=0x0266=614   <- mode #1
offset 18: 03 01 8a 00   -> tag=0x0103 SETTING_NAME_LEN64  length=0x008a=138
offset 22: "Openwater swim\0\0\0..."  (the 64-byte name field starts here)
```

Mode #1's header is at offset 14 with content length 614, so it spans 14 to 14+4+614=632.
**Offset 632 is exactly where the next mode's header sits** - confirmed directly: bytes at
632-635 are `01 01 1e 02`, i.e. another `EXERCISE_MODES_MODE` tag, length `0x021e=542`, whose
`SETTING_NAME_LEN64` sub-tag and name (`"Transition"`) follow immediately after, exactly as
predicted before checking. This isn't a plausible-looking coincidence - the arithmetic predicts
an exact byte offset and the real data lands on it.

So the structure, fully confirmed:

```
DEVICE_CUSTOM (0x03)
  EXERCISE_MODES (0x100)
    EXERCISE_MODES_TYPE (0x10b)         - 2-byte value, format/version marker (=2 on this watch)
    EXERCISE_MODES_MODE (0x101)  x N    - one per configured sport mode, length = whole record
      EXERCISE_MODES_SETTING_NAME_LEN64 (0x103)  - 64-byte name field + ~74 more setting bytes
        [not yet decoded field-by-field: ActivityID, UseAccelerometer, PODs, Triggers ref, etc.
         - the fields sport_mode.js's defaultSettings() already names]
      [EXERCISE_MODES_DISPLAYS (0x105) and EXERCISE_MODES_RULES (0x10c) sub-blocks presumably
       fill the remainder of each mode's declared length - matches the tail bytes immediately
       before mode #2 decoding as EXERCISE_MODES_DISP_FIELD_SHORTCUT (0x10a) entries]
```

**All 11 real mode names on this watch decode correctly at their predicted offsets**, name by
name, mode by mode: `Openwater swim`, `Transition`, `Cycling`, `Running`, `Run a route`, `Pool
swimming`, `Trekking`, `Indoor training`, `Mountaineering`, `Alpine skiing`, `Triathlon` - a
completely plausible real-world setup (individual sports plus a multisport triathlon
combining swim/transition/bike/transition/run), extracted directly from raw flash bytes using
nothing but the dictionary and header format above.

## The settings fields, decoded and byte-verified, 2026-08-05

`BXmlConverter::addBinaryData` (`libkomposti-ng.so.c:849894`) is the single primitive every
field in a settings block goes through, and its `switch` gives the complete, explicit type
table - not inferred, the decompiled code literally names the type and shows the cursor
advancing by its exact width:

```
case 0: "uint8"    ->  1 byte   (cursor += 1)
case 1: "uint16"   ->  2 bytes  (cursor += 2)
case 2: "uint32"   ->  4 bytes  (cursor += 4)
case 3: "string16" -> 16 bytes  (cursor += 0x10)
case 4: "string24" -> 24 bytes  (cursor += 0x18)
case 5: "string64" -> 64 bytes  (cursor += 0x40)
```

`convertExerciseModesSettingBinaryToTree` (`:849467`) calls this once per field, in this exact
order, right after the `SETTING_NAME_LEN64` tag header: `EXERCISENAME` (type 5, 64 bytes -
type 3/`string16` instead on older non-UTF8 devices, a real generational difference between
early Ambit and later firmware), `ACTIVITYID`, `CMIDLOW`, `CMIDHIGH`, `USEHW`, `ALTIBAROMODE`,
`GPSPOWERMODE`, `RECORDINGINTERVAL`, `AUTOLAP`, `HRHIGH`, `HRLOW`, `HRLIMITSUSE`, `AUTOSTART`,
`AUTOPAUSE`, `AUTOSCROLLING`, `INT_TIMER_FLAGS`, `INT_TIMER_COUNT` (all `uint16`), then one
full interval-timer slot (`FLAGS` u8, `TYPE` u8, `MAXLIMIT`/`MINLIMIT`/`PADDING` u16, `LEN`
u32), then repeated slots of just `FLAGS`/`TYPE`/`MAXLIMIT`/`MINLIMIT` (6 bytes each).

Laid out with byte offsets (relative to the start of the `SETTING_NAME_LEN64` tag's content):

```
0-63    EXERCISENAME       string64
64-65   ACTIVITYID         uint16
66-67   CMIDLOW            uint16   <- CustomModeID, low half
68-69   CMIDHIGH           uint16   <- CustomModeID, high half
70-71   USEHW              uint16   <- POD/accessory bitmask
72-73   ALTIBAROMODE       uint16
74-75   GPSPOWERMODE       uint16
76-77   RECORDINGINTERVAL  uint16
78-79   AUTOLAP            uint16
80-81   HRHIGH             uint16
82-83   HRLOW              uint16
84-85   HRLIMITSUSE        uint16
86-87   AUTOSTART          uint16
88-89   AUTOPAUSE          uint16
90-91   AUTOSCROLLING      uint16
92-93   INT_TIMER_FLAGS    uint16
94-95   INT_TIMER_COUNT    uint16
96      INT_TIMER_1_FLAGS  uint8
97      INT_TIMER_1_TYPE   uint8
98-99   INT_TIMER_1_MAXLIMIT  uint16
100-101 INT_TIMER_1_MINLIMIT  uint16
102-103 INT_TIMER_1_PADDING   uint16
104-107 INT_TIMER_1_LEN       uint32
108-137 five more 6-byte slots (FLAGS u8 + TYPE u8 + MAXLIMIT u16 + MINLIMIT u16)
```

`64 + 16*2 + 12 + 5*6 = 138` - **exactly** the `SETTING_NAME_LEN64` length declared by every
single one of the 10 `EXERCISE_MODES_MODE` entries on this watch (checked directly: all ten
read `length=138`, a genuinely fixed-size struct, not a coincidence of this one mode).

**Verified against the real dump, field by field, all 10 modes:**

| Name | ActivityID | CustomModeID (CMIDLOW) | USEHW (hex) | AltiBaroMode |
|---|---|---|---|---|
| Openwater swim | 0x53 (83) | 60596 | 0x0003 | 1 |
| Transition | 0x01 (1) | 60597 | 0x0003 | 2 |
| Cycling | 0x04 (4) | 60598 | 0x08c3 | 0 |
| Running | 0x03 (3) | 60595 | 0x0107 | 0 |
| Run a route | 0x03 (3) | 60599 | 0x0107 | 0 |
| Pool swimming | 0x06 (6) | 60600 | 0x0003 | 1 |
| Trekking | 0x0b (11) | 60604 | 0x0107 | 2 |
| Indoor training | 0x5f (95) | 60601 | 0x0003 | 1 |
| Mountaineering | 0x4a (74) | 60602 | 0x0007 | 2 |
| Alpine skiing | 0x14 (20) | 60603 | 0x0003 | 0 |

`CustomModeID` values cluster tightly (60595-60604 - exactly a 10-wide span, matching
`getMaxSportModes()`'s known limit of 10 for Ambit2/Ambit3), confirming `CMIDLOW` really is the
persistent per-mode ID `sport_mode.js` calls `CustomModeID`. Note IDs aren't in flash-storage
order (`Running`=60595 sits lowest despite storing 4th) - consistent with IDs being assigned at
creation time while flash order reflects a separate display/menu order. `USEHW` looks like a
real capability bitmask, plausibly matching `sport_mode.js`'s
`UseHRBelt`/`UseCadencePOD`/`UseBikePOD`/`UsePowerPOD`/`UseFootPOD` booleans: `Cycling` gets the
distinct `0x08c3` (bike/power-pod-shaped bits), `Running`/`Run a route`/`Trekking` share
`0x0107` (a foot-pod-shaped bit), the rest default to `0x0003`. Exact bit meanings not yet
individually confirmed, but the pattern lines up with what each activity would plausibly need.

## `SPORT_MODES`: a separate, fixed 10-slot table, not part of `EXERCISE_MODES` at all

Scanning past the end of `EXERCISE_MODES` (offset 4, length 6684, ending at 6692) lands
immediately on `SPORT_MODES` (`0x200`, length 864) - a **separate** top-level section, sibling
to `EXERCISE_MODES` rather than nested inside it. Its content is a tight, regular array: ten
`SPORT_MODE` (`0x210`) entries, each exactly 84 bytes (4-byte header + 80 content: a
`SPORT_MODE_SETTING_NAME_LEN64` (`0x215`, 64 bytes) followed by `SPORT_MODE_ACTIVITY_ID`
(`0x213`) and `SPORT_MODE_EXERCISE` (`0x214`), each a 4-byte-header + 2-byte-value pair, plus a
few bytes of padding to round out 80). Confirmed by exact arithmetic, not guesswork: the tenth
slot's header sits at offset 7452, its name content starts at exactly 7460 - **the precise
offset "Triathlon" was found at** in the original string scan.

**Correction, once a real decoder replaced the manual scan: all 10 slots are populated, not
just one.** The original string scan seemed to show only `Triathlon` because it used
`bytes.find()`, which always returns the *first* match - it silently hid that `Running`,
`Cycling`, and the rest also appear a second time, inside `SPORT_MODES`, and just looked like
duplicates of the same first offset. Building the actual tool (below) exposed the bug and the
real structure at once.

**What `SPORT_MODES` actually is, now precisely confirmed:** a quick-selection catalogue
mapping every *independently selectable* activity to its `EXERCISE_MODES_MODE` entry -
`SPORT_MODE_EXERCISE` is the exercise's flash-storage index (0-based), confirmed exactly for
all 9 single-sport slots (`Cycling`'s `Exercise=2` matches its position as the 3rd
`EXERCISE_MODES_MODE` entry, `Alpine skiing`'s `Exercise=9` matches being the 10th, etc. - no
exceptions). The one `EXERCISE_MODES_MODE` entry with *no* `SPORT_MODES` counterpart is
`Transition` - which makes complete sense, since a transition is a helper leg within a
multisport combo, not something you'd select on its own.

**Resolved, 2026-08-05: `Triathlon`'s tenth slot is a real multisport combo, encoded as
*multiple* `SPORT_MODE_EXERCISE` tags rather than one.** André's own recollection ("triathlon
mode as far as I recall was 3 sports modes together") plus section 3.20 of
`Suunto_Ambit3_Peak_UserGuide_EN.pdf` (which describes Triathlon as a default multisport mode)
prompted a direct check of the raw bytes: Triathlon's `SPORT_MODE` entry declares a length of
104, not the 80 every single-sport slot uses. Dumping its content (offset 7456, length 104) and
walking it as a tag stream shows why:

```
offset 7456: tag=0x0215 length=64  (name: "Triathlon")
offset 7524: tag=0x0213 length=2   (ActivityID = 0x13)
offset 7530: tag=0x0214 length=2   (Exercise = 0)   Openwater swim
offset 7536: tag=0x0214 length=2   (Exercise = 1)   Transition
offset 7542: tag=0x0214 length=2   (Exercise = 2)   Cycling
offset 7548: tag=0x0214 length=2   (Exercise = 1)   Transition
offset 7554: tag=0x0214 length=2   (Exercise = 3)   Running
```

Five `SPORT_MODE_EXERCISE` tags, not one - the extra 24 bytes over the standard 80 are exactly
four extra tags (4-byte header + 2-byte value = 6 bytes each), matching 104 vs 80 precisely.
The sequence of flash indices (0, 1, 2, 1, 3) maps directly onto **Openwater swim -> Transition
-> Cycling -> Transition -> Running** - the standard swim/T1/bike/T2/run triathlon structure,
exactly matching both the manual and André's recollection.

This exposed a real bug in `tools/custom_modes.py`'s first version: `decode_sport_mode_slot()`
assigned `slot["Exercise"] = ...` inside the tag loop, which *overwrites* on every iteration -
so it silently reported only the last tag (`Exercise=3`, "Running") and discarded the other
four. Fixed by collecting all `SPORT_MODE_EXERCISE` values into a list (`slot["Exercises"]`)
instead of a single scalar; `show()` now prints the full leg sequence with each index resolved
back to its exercise-mode name. Re-verified against `/tmp/dump_CustomModes.bin` and
`tools/selftest.py` (24/24) after the fix - no regressions, and the other 9 single-sport slots
are unaffected (each still yields a one-element `Exercises` list matching its old single
`Exercise` value).

## Confirms André's theory directly: Suunto Apps are a genuinely separate mechanism, not part of this shared Ambit1-era format

Checked directly: **`SuuntoApp` has zero hits anywhere in `libkomposti-ng.so.c`** - not in the
BXml tag dictionary, not anywhere in the file. Despite `sport_mode.js` (the modern SuuntoLink
UI model) clearly having a first-class `SuuntoApp` concept (`getMaxSuuntoApps`,
`getSuuntoAppInfo`, `getSuuntoAppName`), the `Bluebird`-era native converter - the one actually
doing the CustomModes binary work, reused unchanged from the original Ambit - has no concept of
it at all.

That lines up exactly with two other things already found:
- `EmuDevice::saveCustomModes` (`SDSApplicationServer.exe.c`) logs **two separate** binary-build
  failures: `"failed to create apps binary"` *and* `"failed to create custom modes binary"` -
  two distinct build steps, not one.
- Tonight's live memory-map dump already showed **`Apps` as its own flash region**
  (`0x927c0`, 200000 bytes - all-`0xFF`/unwritten on this reference watch, i.e. no apps
  currently installed), entirely separate from `CustomModes` (`0x2000`, 12288 bytes, the one
  with real data).

So the theory is confirmed, precisely: Ambit3's "ability to run apps" is a genuinely additional
subsystem - its own flash region, its own binary converter, no shared tag ID space with the
inherited Bluebird/Ambit1 sport-mode format - layered on top of, not folded into, the same
CustomModes mechanism every generation back to the original Ambit already had. Custom **sport
modes** (the `SPORT_MODE`/`EXERCISE_MODES` BXml tags above) are the cross-generation-compatible
part; **apps** are the Ambit3-and-later addition, sitting in a completely separate part of the
format André's theory correctly predicted the shape of.

## Cross-checked against `SuuntoAppZoneDeveloperManual.pdf`, 2026-08-05: independent confirmation, no new binary detail

Read via `pdftotext -layout` (30 pages, dated Apr 2 2015 - contemporary with this watch). Two
things in it are directly relevant, both corroborating rather than adding to the byte-level work:

**1. Its `SUUNTO_ACTIVITY_TYPE` enum (page 29) matches every `ActivityID` this project decoded,
exactly, with zero exceptions:** Run=3, Cycling=4, Swimming=6, Trekking=11, Triathlon=19,
Alpine skiing=20, Open water swimming=83, Mountaineering=74, Indoor training=95 - each one equal
to the corresponding `ActivityID` byte found in `/tmp/dump_CustomModes.bin` (`0x03`, `0x04`,
`0x06`, `0x0b`, `0x13`, `0x14`, `0x53`, `0x4a`, `0x5f`). An independent, documentation-sourced
confirmation that `SPORT_MODE_ACTIVITY_ID`/`EXERCISE_MODES` `ActivityID` fields are decoded
correctly, not just self-consistent.

**2. It confirms "Suunto Apps" (App Zone/App Designer) are a wholly separate feature from
`CustomModes`, and clarifies what they actually are: a small user-programmable formula
language** (`RESULT = ...;`, own variables, ~200 `SUUNTO_*` watch variables, a handful of
`Suunto.*` math functions, a hard per-device compiled-size limit), authored on Movescount.com
and downloaded to the watch as a separately compiled binary. This is exactly the second,
distinct build artifact already inferred from `EmuDevice::saveCustomModes`'s two separate
failure strings and from the live memory-map dump's standalone `Apps` region (`0x927c0`,
200000 bytes, all-`0xFF`/empty on this reference watch) - the manual is effectively the
authoring-language spec for what fills that region, not a spec for its on-flash binary layout
(which isn't documented here and remains unexplored, since the region is empty on this
particular watch and there's nothing to byte-verify against).

## Overall assessment

**This is not a dead end requiring a live capture or a missing binary - unlike the steps/
`libmds.so` situation, everything needed is already sitting in already-decompiled assets, and
tracing has now gone well past "architecture confirmed" into "most of the decode dictionary is
in hand."** Confirmed end to end: dedicated flash region (`0x2000`, 12288 bytes, ~10240 of it
BXml-encoded) <-> `Erase`/`Write`/`Validate` NSP tasks <-> `BinaryAreaCustomModesConverter`
(area-size bookkeeping) <-> `BluebirdCustomModeConverter` + `BXmlConverter` (the real
tree<->binary serializer, both directions, fully decompiled) <-> a complete 124-entry tag/
field-type/template dictionary (`BXmlTagMapping` + `BXmlIdMapping`, extracted programmatically
from real constants, not guessed). Also settled, precisely, the variant question André raised:
sport modes are the shared, cross-generation (Ambit1/2/3/Traverse) part of this format; Suunto
Apps are a confirmed-separate later addition, own flash region and own converter, absent from
this dictionary entirely.

**Update: the wire format itself is now cracked and byte-verified, not just architecturally
understood.** `parseBinaryTag`'s body gives the header format directly (`[u16 LE tag_id][u16 LE
length]`, 4 bytes, content follows), and it's been checked against the real
`/tmp/dump_CustomModes.bin` with exact arithmetic, not pattern-matching: mode #1's declared
length predicts mode #2's header offset to the byte, and it's there. All 11 real sport-mode
names on this watch (`Openwater swim` through `Triathlon`) decode correctly at their predicted
positions using nothing but the dictionary and this header rule.

What's left, now much narrower: decode the ~74 bytes of actual settings following each name
(`ActivityID` and the rest of `sport_mode.js`'s `defaultSettings()` fields - ActivityID is
almost certainly one of the small integers sitting right after the 64-byte name, a short,
bounded task from here), and the `DISPLAYS`/`RULES` sub-structure. The header format and
top-level record layout - the hard, previously-unknown part - is done and verified. Exactly
what `obsolete/AMBIT3-SUUNTO-HANDOFF.md` (marked partly wrong at its own top - `HANDOFF.md` is current) already flagged as needed ("Sport-mode / custom-mode write...
needs confirming") for Deliverable C, and now considerably closer to finished than open.

## Built and verified: `tools/custom_modes.py`, a real decoder, 2026-08-05

Turned the reverse-engineering above into an actual tool, matching this project's existing
conventions (`ambit_format.py`-style dictionaries/structs, `write_nav.py`-style CLI/IO
separation). `python3 tools/custom_modes.py --from /tmp/dump_CustomModes.bin` (or with no
`--from`, reads the watch live via the same `read_flash`/`0x0b17` path `write_nav.py nav`
already uses) decodes the full settings struct for all 10 `EXERCISE_MODES_MODE` entries and
the `SPORT_MODES` table, using the tag dictionary and field layout established above.
`selftest.py` stays 24/24 - the new module is standalone, nothing existing was touched.

Building it surfaced two more things directly:

- **`Autolap` genuinely varies per mode** - every mode reads `0`, except `Run a route`, which
  reads `1000`. Real, meaningful per-mode data, not a static default - a good sign the decode
  is picking up actual settings correctly, not coincidentally-plausible zeros.
- **The manual string-scan understated `SPORT_MODES` earlier** (see the correction above) -
  caught immediately once a real, structural decoder existed instead of an ad hoc `bytes.find`
  scan. Worth noting as a general lesson: a quick manual check is fine for a first sanity pass,
  but a real parser is what actually exposes structure a flat string search can hide.

## `EXERCISE_MODES_DISPLAYS` and `EXERCISE_MODES_RULES`, decoded, 2026-08-05

Both fully traced via the actual binary-to-tree parsers in `libkomposti-ng.so.c`
(`Communist::Bluebird::BXmlConverter::convertExerciseModes{Displays,DisplayField,
DisplaySetting,Rules,Rule}BinaryToTree`, ~849672-850267) - not the friendlier
`BluebirdCustomModeConverter::convertDeviceCustomMode*ToTree` functions used earlier, which
turned out to operate one layer up, on an already-parsed generic tree, and so don't show byte
offsets at all.

**`DISPLAYS` - a real, nested BXml structure, every tag ID already in hand:**

```
EXERCISE_MODES_DISPLAYS (0x105)            one per exercise mode, container
  EXERCISE_MODES_DISPLAY (0x106)           one per screen (7-11 seen per mode on this watch)
    EXERCISE_MODES_DISP_SETTING (0x107)    leaf, 4 bytes: [u16 Template][u16 Type]
    EXERCISE_MODES_DISP_FIELD (0x108)      one per value slot on that screen (1-3 seen)
      EXERCISE_MODES_DISP_FIELD_SETTING (0x109)   leaf, 4 bytes: [u16 Index][u16 Type]
      EXERCISE_MODES_DISP_FIELD_SHORTCUT (0x10a)  leaf, 2 bytes: [u16], 0+ per field
```

`Template` and `Index` both resolve cleanly against the existing `FIELD_TYPES` dictionary
(itself unchanged, from `BXmlIdMapping`) - `Template` against its `PID_RUNNER_GPS_TEMPLATE_*`
range, `Index` against its `FT_*` range - and every single value seen in the real dump matches
a real dictionary entry, with zero unknowns, across all 10 exercise modes. Byte-verified by
exhaustion: `tools/custom_modes.py --displays` decodes every mode's full display list with no
leftover bytes and no `_warning`, and `selftest.py` stays 24/24.

Two fields are structurally decoded but not semantically pinned down: `Type` (present on both
`DISP_SETTING` and `DISP_FIELD_SETTING`) and the `DISP_FIELD_SHORTCUT` values. Source literally
calls both "TYPE" - not informative beyond confirming they're real, present uint16 fields, not
padding. A plausible guess (unconfirmed, not in any decompiled asset found so far) is that
these are raw indices into the ~200 `SUUNTO_*` watch variables enumerated in
`SuuntoAppZoneDeveloperManual.pdf`; the shortcut lists in particular behave like "alternate
values a button-press cycles this field slot through," which is consistent with that theory,
but there's no dictionary anywhere in these assets mapping index -> variable name, so it's
reported as a raw number rather than guessed further.

**`RULES` - structurally simple, but *empirically unverifiable on this reference watch*:**

```
EXERCISE_MODES_RULES (0x10c)               container, present only if a mode has app rules
  EXERCISE_MODES_RULE (0x10d)              one per rule-engine slot
    (flat 6-byte content: no further BXml tags - RULEIDX/USERULE/LOGRULE have zero entries
     in BOTH BXmlTagMapping and BXmlIdMapping, confirmed by grepping every string literal
     either constructor inserts)
    RULEIDX  u16   which rule-engine display slot (FT_RULE_ENGINE_0/1/2) this refers to
    USERULE  u16   whether a Suunto App is assigned/enabled for that slot
    LOGRULE  u16   whether that App's result gets logged as part of the recorded Move
```

This is the missing link between the separate "Suunto Apps" subsystem confirmed earlier (its
own flash region, own binary converter, own build-failure string) and a specific exercise
mode: the App itself lives in the `Apps` region, but *which* app-slot a given exercise mode
uses, and whether it's logged, is what `EXERCISE_MODES_RULES` records inside `CustomModes`.

Not byte-verified, and can't be on this hardware: **none of the 10 `EXERCISE_MODES_MODE`
entries in `/tmp/dump_CustomModes.bin` contain an `EXERCISE_MODES_RULES` tag at all** - every
mode's content ends right after `DISPLAYS`, confirmed by exact length arithmetic (each mode's
declared length equals exactly `4+138 (SETTING_NAME_LEN64) + 4+len (DISPLAYS)`, no remainder).
That's consistent with, and further confirms, the earlier finding that this reference watch's
`Apps` flash region is entirely unwritten (`0xFF`) - no apps are installed, so there's nothing
for any mode to reference. `tools/custom_modes.py`'s `decode_rule()` is implemented straight
from source and will decode a real `RULE` tag correctly if one ever appears (e.g. after
installing a Suunto App and assigning it to a sport mode), but that specific code path has not
been exercised against real bytes, unlike everything else in this file.

## `RULES` closed the loop: André installed a real Suunto App and it's confirmed byte-exact, 2026-08-05

The gap above didn't stay open long. André pointed out that Suunto bundles pre-compiled
Movescount-era Suunto Apps directly inside SuuntoLink itself - confirmed: `suunto-apps/
index.json` inside `assets/WIndows apps/suuntolink_roaming/app-4.1.15/resources/app/` contains
**13,104 pre-compiled apps**, entirely offline, no Movescount account needed. Each entry has
`ruleId`, `name`, `activityId`, `categoryId`, `compatibleVariants` (every single one lists
`"Emu"` - confirmed Ambit3-Peak-compatible), and a `binary` field: the actual compiled
bytecode, magic-stamped `"IAMRULE\0"` - the compiled form of the scripting language documented
in `SuuntoAppZoneDeveloperManual.pdf`.

André ran SuuntoLink 4.1.15 on his Mac, deleted one exercise mode (Alpine skiing - now 9
modes, not 10), and added the **"Climb counter"** Suunto App to a display screen on
**Cycling**. Dumping `CustomModes` fresh afterward and diffing against the original 10-mode
dump:

- **`EXERCISE_MODES_RULES` appeared for the first time, on Cycling only** - `tools/
  custom_modes.py` now reports `12 display(s), 1 rule(s)` for it, and `decode_rule()` (written
  straight from source, never previously exercised against real bytes) decoded it cleanly:
  `RuleIdx=0 UseRule=True LogRule=False`. First real confirmation of a function this project
  had only derived from `convertExerciseModesRuleBinaryToTree`, never seen fire.
- **A brand-new tag, `0x1ff`, appeared too** - not in `BXmlTagMapping` or `BXmlIdMapping`
  anywhere (this SuuntoLink build is newer than the Movescount APK libkomposti-ng.so.c was
  decompiled from - real protocol evolution past what the decompiled assets capture, not a
  gap in the dictionary-extraction). Its 8 bytes decode as two consecutive uint32 LE Unix
  timestamps, 2 seconds apart - and both land on **2026-08-05 07:54:5x UTC**, the literal
  moment André ran the sync. Clean, unforced known-plaintext confirmation. Named
  `EXERCISE_MODES_APP_META` (inferred, not sourced) and wired into the decoder.
- **A new screen template, `0x0127`**, appeared in Cycling's `DISPLAYS` for the app's own
  screen, with three fields whose `Type` values (160, 161, 162) are unlike anything on any
  other screen - consistent with, though not proven to be, the app's `prefix`/`RESULT`/
  `postfix` triple from the developer manual's display model. Not wired into the decoder as a
  named template (no source, only one data point) - reported as a raw ID like any other
  unrecognized value.

**Then the deeper confirmation: the `Apps` flash region itself, decoded for the first time.**
Previously all-`0xFF` (empty), it's now 476 non-`0xFF` bytes. `IAMRULE` appears once, preceded
by a wrapper: `[u16][u16][u32][u32 total_length]` then a 32-byte null-padded name buffer
(`"R-Climb counter"`), then the `IAMRULE` blob itself. **The blob is byte-for-byte identical to
catalog entry `ruleId=32` ("Climb counter")'s `binary` field** - confirmed by direct
comparison, not inference - and `total_length` (482) equals exactly `44 + len(blob)` (438).
This wrapper format is NOT in any decompiled asset this project has (grepped `IAMRULE` across
every `.c` decompile and every `.exe`/`.dll`/`.so` in `assets/` - zero hits anywhere) - it's the
one structure in this whole investigation derived purely empirically, verified-first rather
than source-first.

Built `tools/apps.py` to decode this region: finds every `IAMRULE` entry, reads its wrapper,
and (given a `suunto-apps/index.json` path) identifies it by exact binary match against the
public catalog. Confirmed: `./tools/apps.py --from /tmp/dump_Apps.bin --catalog ...` correctly
reports `ruleId=32 name='Climb counter' activityId=82 category=2` - the App Zone catalog's own
metadata for exactly the app André installed, recovered purely from raw flash.

## Overall assessment, updated

Everything reachable from this reference watch's actual captured data is now decoded and
byte-verified: settings, the sport-mode/multisport table (including the Triathlon leg
sequence), the full `DISPLAYS` screen/field structure, and - since André installed a real
Suunto App specifically to close this gap - `EXERCISE_MODES_RULES`/`EXERCISE_MODES_APP_META`
too, plus the previously-unreachable `Apps` region's own on-flash format. The only things left
un-pinned-down are cosmetic (the exact meaning of `DISP_FIELD_SETTING`'s "Type" field, and the
new `0x0127` template/160-162 `Type` values) rather than structural - every region this format
touches now has a working, byte-verified decoder.

## Two more BXml tags found and closed, 2026-08-07: `SPORT_MODE_ORDER`/`SPORT_MODE_APP_META`

Found by the strongest kind of check available: round-tripping the encoder
(`custom_modes_write.py`, built the same day) against a *live* re-read of the reference
watch's actual current `CustomModes`, not just synthetic test values. The rebuild was 96
bytes short of the real region - every `EXERCISE_MODES_MODE` matched exactly, but every
`SPORT_MODE` slot was 8-16 bytes short. Walking the raw bytes directly (bypassing the lossy
`decode_sport_mode_slot`, which had no `_raw_children`-style bookkeeping for unrecognized
tags, unlike `decode_exercise_mode`) found two real tags, present on every real slot, that
had been silently dropped since this format was first cracked on 2026-08-05:

- **`SPORT_MODE_ORDER` (`0x2fe`)**, a 4-byte uint32, present on every one of the 9 real
  slots. Values on this watch: 1,2,3,4,5,6,7,9,10 - a persistent per-slot ID that survives
  deletion (slot 8, "Alpine skiing", was deleted via SuuntoLink at some point - the
  numbering still skips 8 rather than renumbering the rest down). Confirms this is a real
  identity, not derived from flash position.
- **`SPORT_MODE_APP_META` (`0x2ff`)**, a 4-byte uint32 Unix timestamp, present only on the
  3 slots whose `EXERCISE_MODES_MODE` has a Suunto App assigned (Cycling, Indoor training,
  Mountaineering) - landing 2-6 seconds after that same mode's own
  `EXERCISE_MODES_APP_META` timestamps, every time, across all 3. Very likely a second
  clock reading taken later in the same install transaction, at the `SPORT_MODES`-table
  level rather than the `EXERCISE_MODES_MODE` level.

Both now decoded (`custom_modes.py`) and encoded (`custom_modes_write.py`, plus the C port
`csrc/device_driver_ambit3_sport_modes.c`). With these added, the encoder reproduces the
real watch's current `CustomModes` BXml body **byte-for-byte exactly** - confirmed by direct
comparison against a live read, not inferred. `V3_CHANGELOG.md` has the full account.

## The ~222-byte trailing block (offsets 7416-7637 on this watch), solved: stale flash residue, not a new format

With the BXml body now byte-perfect, the remaining gap between the declared `DEVICE_CUSTOM`
length (7416 bytes) and the real region size (12288 bytes) was checked directly rather than
assumed blank. It isn't: 222 bytes there are non-`0xff`, decoding into fragments that don't
parse as a clean tag stream from their start offset - but shifting the read start by 4 bytes
makes them parse perfectly using tags this project already has: `SPORT_MODE_ORDER=10`
(Triathlon's real, current Order value) and `SPORT_MODE_EXERCISE` values 3,2,1,3,2,1,3
repeated in fragments, followed by a **complete, valid, self-consistent 104-byte
`SPORT_MODE` record for Triathlon** - name, `ActivityID=0x13`, and the exact same 0-1-2-1-3
leg sequence it has today - plus a small fragment of Trekking's `ActivityID`/`Exercise`
(`0x0b`/`6`, matching its real current values too).

104 bytes is exactly the length Triathlon's entry had *before* `SPORT_MODE_ORDER` was found
- i.e. this is a literal leftover copy of Triathlon's own entry from an earlier state of the
region, most likely from around when Alpine skiing was deleted (a shorter rewrite doesn't
erase flash bytes past the new declared length, it just leaves them in place). Not device
metadata, not a third on-device format, not anything live: `openambit`'s own
`UNKNOWN_DISPLAYES` constant (a hardcoded blob its authors admit they never parsed, just
copied verbatim from one sample) was very likely the same phenomenon, misread as meaningful
structure instead of write-history garbage. Confirmed, not merely plausible: the offset-4
realignment parses cleanly straight through to exactly byte 7638, the same boundary already
established as where real content stops and true `0xff` padding begins - no coincidence.

Practical upshot: nothing here needs to be reproduced by a writer, and the current encoder's
`0xff`-padding of everything past the BXml body is fine going forward. The conservative
policy already used for the real write test (read the region fresh, only replace bytes the
writer actually controls, leave everything else exactly as read) remains the right default
regardless - not because this residue turned out to be precious, but because it's cheap
insurance against the next thing turning out not to be.

## Cross-checked against openambit's live upstream source, 2026-08-07: struct fields reconciled field-by-field, and a real question re-opened about the trailing-block residue

Prompted by a pass through `tools/NewSources.md` (external community links André asked to be
checked against this project's own findings). Two of them, github.com/openambitproject/openambit
issues #256 and #257, pointed at files this project had never actually pulled and read: the
*live* upstream `src/libambit/libambit.h`, `src/libambit/sport_mode_serialize.c`/`.h`,
`src/libambit/device_driver_ambit.c`, `src/libambit/device_driver_ambit3.c` and
`src/libambit/pmem20.c` - distinct from whatever stale/partial copy of openambit this project's
own `csrc/` vendors, which is missing this file entirely. Cross-reading it against this
project's own decode (the settings-field table above, decoded independently from
`libkomposti-ng.so.c`) is a genuine second, fully independent source for the same format.

**Confirms the tag dictionary exactly.** `sport_mode_serialize.h`'s constants -
`SPORT_MODE_START_HEADER=0x0100`, `SPORT_MODE_HEADER=0x0101`, `SETTINGS_HEADER=0x0102`,
`DISPLAYS_HEADER=0x0105`, `DISPLAY_HEADER=0x0106`, `DISPLAY_LAYOUT_HEADER=0x0107`,
`ROWS_HEADER=0x0108`, `ROW_HEADER=0x0109`, `VIEW_HEADER=0x010a`,
`SPORT_MODE_GROUP_START_HEADER=0x0200`, `SPORT_MODE_GROUP_HEADER=0x0210`, `NAME_HEADER=0x0212`,
`ACTIVITY_ID_HEADER=0x0213`, `MODES_ID_HEADER=0x0214` - match this project's own dictionary
tag-for-tag everywhere they overlap. Two independent decompilations of two different binaries
(a Windows desktop tool here, an Android native library there) landing on the same tag numbers
is strong confirmation neither is coincidence.

**Confirms the 138-byte settings struct is the same struct, just a different firmware
generation.** openambit's own `ambit_sport_mode_settings_t` (`libambit.h:477`) is
`activity_name[16]` + 74 bytes of fixed fields = 90 bytes total (`SETTINGS_SIZE`, `pmem20.c`).
This project's own decode above is `EXERCISENAME[64]` + the same 74 bytes = 138. `138 - 90 ==
64 - 16` exactly: the only difference is the activity-name width, already flagged above as a
real early-Ambit-vs-later-firmware difference (`string16` vs `string64`) - not two different
structs, the same one at two points in Suunto's own firmware history.

**Resolves three fields this project's table above only guessed at:**
- `hrbelt_and_pods` (openambit's name for the field at this project's `USEHW` offset) is
  commented in their source as *"bit pattern representing usage of hr belt or pods"* - matches
  this project's own guess exactly. Individual bit meanings remain unconfirmed on both sides.
- `autolap`, openambit's name for `AUTOLAP` (offset 78-79), is commented `/* m */` - **confirms
  the unit is meters**, and lines up with this project's own live value of `1000` on "Run a
  route" (a 1 km autolap, a plausible real setting).
- `auto_scroll`, their name for `AUTOSCROLLING` (offset 90-91), is commented `/* s */` -
  confirms the unit is seconds.

**A real discrepancy worth checking against a capture, not yet resolved:** at the offset this
project's table calls `INT_TIMER_1_FLAGS`/`INT_TIMER_1_TYPE` (two separate `uint8` fields,
offsets 96-97), openambit's struct instead declares a single `uint16_t
interval_timer_max_unit /* m or s */`. A unit selector and two independent flag/type bytes are
materially different interpretations of the same two bytes - worth re-checking against the real
dump the next time this format is touched, rather than assuming either side is right.

**A real re-interpretation worth checking, of the "five more 6-byte slots" (offsets 108-137):**
openambit's struct doesn't describe that span as a repeated array at all. Instead it has three
named scalar fields there - `backlight_mode`, `display_mode`, `quick_navigation` - matching
real UI concepts `sport_mode.js` also exposes (`BacklightMode`, `NavigationSelection`), plus an
`interval_timer_min_unit`/`interval_timer_min` pair and two `unknown[6]` runs. If that mapping
is right, this project's "5 repeated interval-timer slots" reading of that span needs revising
to specific named fields plus padding - genuinely unconfirmed either way without checking real
byte values against both interpretations, but a concrete, actionable alternative where before
there was only "five more slots, purpose unclear."

**Confirms the `EXERCISE_MODES_RULES`/`RULE` decode independently.** openambit's
`serialize_apps_index()` writes tag `0x010c`/`0x010d` with content `[u16 index][u16
constant=1][u16 logging]` - exactly this project's own `RULEIDX`/`USERULE`/`LOGRULE` layout,
and their hardcoded middle constant of `1` independently confirms this project's own
"Climb counter" real-world decode of `UseRule=True`.

**Confirms the flash addresses exactly.** `pmem20.c` declares `PMEM20_SPORT_MODE_START =
0x00002000` and `PMEM20_APP_START = 0x000927c0` - an exact match to this project's own live
`0x0b21` reads.

**A real, concrete data point for the still-open "app error" question** (see
`training_program_andre.md` Finding 19 and `unresolved_questions_for_devs.md` #4):
`device_driver_ambit3.c`'s vtable has `sport_mode_write: NULL` and `app_data_write: NULL` -
**openambit has never actually implemented writing custom modes or apps to an Ambit3 at all**,
only declared the struct and the serializer. The only real write implementation lives in
`device_driver_ambit.c` (the Ambit1/2 "Bluebird" path), and both its `sport_mode_write` and
`app_data_write` bottom out in the same generic `libambit_pmem20_data_write(addr, data, len)`
helper this project already reuses for routes - no dedicated wrapper, no extra checksum, no
commit beyond what that generic helper already does. Both call sites also hardcode
`include_sha256_hash = false`, despite the function signature taking that parameter. Read
plainly: either this is genuinely dead/never-finished code upstream, or the write path for this
specific feature was never fully closed out there either, even pre-Ambit3 - which means this
project's own hardware-verified `HASH_PADDED`-plus-commit sequence for `CustomModes` (Finding
16, `training_program_andre.md`) already goes further than anything openambit itself ever
proved. Not a fix for the open "app error" bug, but it rules out "copy what openambit does" as
a shortcut - there is nothing there to copy for this specific write.

**Worth re-opening, not yet confirmed either way:** the section above concluded this watch's
own 222-byte trailing-block residue is stale flash left over from an earlier write (confirmed
byte-exact against this watch's real Triathlon/Trekking history - that finding stands on its
own and is not in question). It went on to guess, by analogy and explicitly hedged as "very
likely" rather than checked, that openambit's own separate `UNKNOWN_DISPLAYES` constant (a
different blob, hardcoded in *their* source, which their own authors admit they never parsed)
was probably the same phenomenon. Actually running openambit's literal `UNKNOWN_DISPLAYES`
bytes through this project's own tag parser complicates that guess: its header bytes (`06 01
3e 00` / `07 01 04 00` / `08 01 08 00` / `09 01 04 00` / `0a 01 02 00` ...) read as five
well-formed `DISPLAY`(`0x0106`)→`DISPLAY_LAYOUT`(`0x0107`)→`ROWS`(`0x0108`)→`ROW`(`0x0109`)→
`VIEW`(`0x010a`) tag headers with plausible little-endian lengths, not as noise. That doesn't
overturn this watch's own residue finding, but it does mean the *extension* of that reasoning to
openambit's constant was never actually checked - worth properly decoding
`UNKNOWN_DISPLAYES` with `tools/custom_modes.py`'s own parser before citing it as a second
example of the same stale-residue phenomenon.

Sources for this section: github.com/openambitproject/openambit, issues #256 and #257, and the
files linked from them (`src/libambit/libambit.h`, `src/libambit/sport_mode_serialize.c`/`.h`,
`src/libambit/device_driver_ambit.c`, `src/libambit/device_driver_ambit3.c`,
`src/libambit/pmem20.c`), all fetched 2026-08-07 from `tools/NewSources.md`'s link list.

## 2026-08-08: real captures resolve every open question above, byte-exact

André captured ~50 targeted SuuntoLink syncs (`assets/ambit3 pcap/v2/`), each one a single
known settings change with a descriptive filename (e.g. `autopausefromofftoon`), plus reference
screenshots of the real UI (`v2/screens/`). Reconstructed each capture's `CustomModes` region
with `tools/ambit_pcap.py`'s `FlashImage.from_pcap()` and decoded it with `tools/custom_modes.py`
(both already existed, no new tooling needed - see that file's own `decode_settings()` for the
field table this section confirms). Real chronological order (not filename order) recovered via
file mtimes where syncs were part of a sequence, since consecutive real syncs give the cleanest
diffs. Methodology throughout: decode both sides of a known transition, diff every field,
confirm exactly the expected field changed and nothing else - and where possible, cross-check
against SuuntoLink's own JS source (`assets/WIndows apps/suuntolink_roaming/app-4.1.15/
resources/app/ambit/{sport_mode,settings}.js`) for the real enum names/values rather than
inferring from behavior alone.

**Resolves the "five more 6-byte slots" question definitively - openambit's reinterpretation
was right, and the exact packing is now known.** The offset-96-137 span is genuinely `1 full +
5 short` interval-timer slots exactly as this project's own struct already declares - but the
*last* short slot (absolute offset 132-137) is never used for a real interval timer at all.
Real per-mode "advanced settings" (backlight/display/quick-navigation) are packed into that
slot's own three sub-fields instead, confirmed both by isolated before/after byte diffs *and*
independently by SuuntoLink's own source enums, which match exactly, value for value:

- **`Flags` (offset 132) = `BacklightMode`.** Full 5-state cycle captured and closed
  (`normal->off->night->toggle->default->normal`, back to the starting value): `0=NORMAL,
  1=OFF, 2=NIGHT, 3=TOGGLE, 255=DEFAULT` (255/`0xff` is a sentinel outside the JS enum's own
  4 values, meaning "not explicitly set"). Matches `settings.js`'s own `BacklightMode` enum
  byte-for-byte: `NORMAL=0x0, OFF=0x1, NIGHT=0x2, TOGGLE=0x3`.
- **`MaxLimit` (offset 134-135) = `Display`** (light/dark theme). Captured
  `default->dark->light->default`: `dark=1, light=0, default=255`. Matches `settings.js`'s own
  `Display` enum exactly: `LIGHT=0x0, DARK=0x1`.
- **`MinLimit` (offset 136-137) = `NavigationSelection`/quick-navigation shortcut.** Captured
  `off->selectpoi->selectroute->default`: `selectpoi=1, selectroute=2, default=0`. Matches
  `sport_mode.js`'s own `QuickNavigation` enum exactly: `OFF=0x0, POI=0x1, ROUTE=0x2` (the doc's
  earlier guess of "off" also being 0, same as default, is consistent with this but not
  independently re-tested here since no capture returned to `off` from a non-zero state).

  André confirmed separately: this is a real per-*mode* setting (not a device-global one
  copied into whichever mode happens to be first) - it only shows up changing on "Cycling" in
  these captures because Cycling was the mode selected in SuuntoLink each time, not because
  other modes are exempt from carrying it.

**Resolves `hrbelt_and_pods` (this project's `UseHw` field) bit-for-bit**, via isolated
enable/disable captures for each pod type in real chronological order (recovered via mtime,
not filename order - the filenames alone diff inconsistently against each other since they
weren't captured as a single linear sequence). Every individual pod's bitmask ORs together
into the "enable all pods" capture's own value (`0x0943`), confirming the isolation is real:
- `0x0001` = HR belt
- `0x0002` = present on every single enabled pod type tested - a shared "external sensor
  search" master bit, not a pod of its own
- `0x0040` = Power pod
- `0x0100` = Foot pod
- `0x0800` = Bike pod
- `0x0004` - seen set on the reference watch's real Running/Trekking/Walk baseline, but no
  capture in this set isolated it alone - still unconfirmed which pod/sensor this is.

**Confirms `Autolap`, `AutoScrolling`, `AutoPause`, `HrHigh`/`HrLow`/`HrLimitsUse`,
`GpsPowerMode` are each exactly the field this project's table already names them, with real
values, not just plausible guesses:**
- `Autolap`: `1000` (1 km) -> `10000` (10 km max) -> `0` (disabled) - confirms meters, matching
  openambit's own `/* m */` comment and this project's earlier "Run a route" live value.
- `AutoScrolling`: `10 -> 2`, exactly matching the capture's own filename
  (`changeautoscrollfrom10to2`) - confirms seconds, matching openambit's `/* s */` comment.
- `AutoPause`: real captured values are `56` (on) and `0` (off) - **not** a plain boolean 0/1
  the way SuuntoLink's own `AutoPause` UI enum (`OFF=0, ON=1`) might suggest at a glance; the
  watch firmware stores a specific nonzero encoded value for "on" rather than a literal `1`.
  Exact meaning of `56` (a detection-sensitivity parameter, in some firmware-internal unit)
  not pinned down further here.
- `HrHigh`/`HrLow`/`HrLimitsUse`: capturing "enable, min 60 max 210" then disabling gave
  `HrHigh: 210->0, HrLow: 60->0, HrLimitsUse: 1->0` - all three exactly as named, bpm units,
  plain enable flag.
- `GpsPowerMode`: four real values captured across the "20h/30h/200h/off" battery-life presets:
  `1, 5, 60, 0`. Confirms this is the right field; the exact mapping from these stored values to
  the displayed battery-hour figures isn't derived here (not an obvious linear or hour-based
  encoding) - what matters for a writer is that these 4 real values are now known-good
  round-trippable presets, whether or not the "why 60 means 200h" internals are ever pinned down.

**Resolves the interval-timer `Type`/`Flags` ambiguity the doc above flagged as unconfirmed.**
Captured a full enable/disable cycle for both interval-timer modes (pace-based:
`intervaltimerhigh02'05low06'30`, then disabled; distance-based: `intervaltimerkmlow3high5`,
then disabled) and diffed each against real chronological neighbors:
- `IntTimerFlags` (SETTING_FIELDS, offset 92-93) is a plain enable flag: `0=off, 1=on` - true
  for *either* pace or distance mode, it does not itself select which.
- The full interval slot's own `Type` byte is the actual pace-vs-distance selector:
  `0=distance (km), 1=pace (min/km)` - confirmed because the pace capture set `Type=1` on both
  the full slot and the next short slot, while the distance capture left `Type=0` (the
  default) throughout.
- The **values themselves** land exactly where the struct's own field names already say, once
  the units are worked out: full slot's `Len` (a real uint32, not just padding) holds the
  "high" threshold, and the *second* short slot's `MaxLimit` holds the "low" threshold - pace
  in whole seconds (`125` = the captured "02'05", `390` = "06'30"), distance in meters (`5000`
  = "high 5" km, `3000` = "low 3" km) - the same meters convention as `Autolap` above, not a
  new unit.

**Resolves what `ambit3changetopscreensportmode`/`...middlescreenactivity`/
`...bottomscreenactivity` actually are - structurally, not just "probably displays."** The
filenames say "activity," but per `v2/screens/8displaysmax.JPG` ("EDIT SPORT MODE" ->
"Displays 8/8" -> a watch face showing three stacked row labels "1"/"2"/"3" inside *one*
display-screen circle, with 8 such screens swipeable below) and André's own confirmation:
position 1/2/3 are the **top/middle/bottom rows of a single display screen**, each with its
own data-field picker (`datarow1.JPG`=row 1's options: Speed/Distance/GPS/Heart rate;
`datarow2.JPG`=row 2's: Altitude/Environment/Time; presumably `datarow3.JPG`=row 3's own set),
plus a separate `suuntoapps1/2/3.JPG` path for assigning a Suunto App to a row instead (max 3
apps active at once, per André). This directly identifies the byte diffs found earlier as
real, not coincidental: `Fields[0]` = row 1/top, `Fields[1]` = row 2/middle (the `FT_TIME`
`Type` change, `51 -> 12`, between the "top" and "middle" captures), `Fields[2]` = row 3/bottom
(the `FT_TIME_SEC` `Shortcuts` change between "middle" and "bottom") - each capture changed
exactly the row its filename named, confirming `EXERCISE_MODES_DISPLAY`'s `Fields` array index
*is* the row position, no new mechanism needed beyond what `decode_display()`/
`decode_disp_field()` already parse. **Not yet resolved:** the exact per-value dictionary for
`Type` (i.e. which specific metric `51` vs `12` selects) - real but lower-priority than the
structural finding, since assigning a row to a *known-good, already-captured* Type value is
already possible without the full dictionary.

**A real discrepancy surfaced by `8displaysmax.JPG`, worth tracking:** the UI caps a sport
mode at 8 display screens ("8/8"), but the reference watch's own live `Cycling` mode decodes
to **15** `Displays` entries throughout this whole capture set. Not investigated further here
- either the raw format allows more than the UI ever writes, or some of those 15 aren't real
swipeable screens (a hidden/system template, matching the still-open "222-byte trailing
residue" question elsewhere in this document). Flagging rather than guessing.

**Sport-mode/multisport creation - real confirmation of `SPORT_MODE_APP_META`'s semantics,
scoped but not exhaustive.** Comparing `ambit2createsportmode` (10 exercise modes including a
"Transition" entry; `Triathlon` slot: `ActivityID=19`, 5-leg `Exercises=[0,1,2,1,3]`) against
the very next real sync `ambit3createmultisportmode` (9 exercise modes, no "Transition";
`Triathlon` slot rebuilt to `ActivityID=2`, 3-leg `Exercises=[1,2,0]`, and - this is the real
confirmation - a **freshly-set `AppMeta` timestamp landing exactly on this sync's own
wall-clock moment**, where the first capture's `Triathlon` slot had none) directly confirms
`SPORT_MODE_APP_META`'s own docstring guess ("inferred, not sourced") - it really does update
when that specific multisport combo is what just got edited/saved, the same pattern already
established for `EXERCISE_MODES_APP_META`. **Suunto App install, resolved cleanly - `EXERCISE_MODES_APP_META` +
`EXERCISE_MODES_RULES`/`RULE` together are exactly the "this mode has a real Suunto App
attached" signal, confirmed across 3 independent captures.** Compared `Trekking` before/after
`installappontrekking` (no prior app) and `Cycling` across `ambit3addapptoexistingsportmode`/
`installcyclingappmiddlescreenheartzone1-5` (already had one from an earlier real session).
Every capture where a mode gains an app shows `AppMeta` going from `None` to a real
`{Timestamp1, Timestamp2}` pair landing on that sync's own wall-clock moment (confirming the
doc's own earlier "inferred, not sourced" guess) *and* a `Rules` entry appearing alongside it
(`UseRule=True, LogRule=False`) - never one without the other in this capture set.
`RuleIdx` is not tied to app type or activity - it's a plain incrementing per-mode slot
number, confirmed by real cross-mode values: `Trekking=1`, `Cycling=0` (twice, in two separate
captures), matching the reference watch's own pre-existing `Run a route=0`/`Indoor
training=1` pattern documented earlier in this file. One real side-effect worth flagging, not
fully explained: `Trekking`'s `HrHigh`/`HrLow` reset from `165`/`125` to `0` in the same sync
that installed its app, and its `IntTimerCount` jumped `0 -> 99` - `HrLimitsUse` stayed `0`
throughout (the feature was never actually enabled), so this may just be SuuntoLink clearing
stale/unused fields on a full-mode rewrite rather than a real interaction between apps and HR
limits, but it's a real observed change, not assumed.

**Kailash ("Hoopoe") device compatibility - real scoping from `assets/ambit3 pcap/v2/kailash`,
not CustomModes-specific.** This one capture is a plain connect + GPS-orbit sync, not a
sport-mode edit, so it says nothing about whether Kailash's `CustomModes` region matches the
Ambit3's format (`HANDOFF.md` already flags Kailash's settings schema as meaningfully smaller -
165 entries against the Ambit3's 324 - so real, unconfirmed risk that it doesn't). What it does
confirm: the wire protocol itself is shared. `0x0000 device_info`'s exact request payload
(`02 48 03 00`) - already what `write_nav.py`/`device_info.py` send - gets a real, valid reply,
starting with `"Hoopoe\0..."` (confirming the codename match to `HANDOFF.md`'s own reference
directly, not just by firmware-zip-name inference). The reply is tagged command `0x0002`
instead of echoing `0x0000` back, a real protocol quirk - but harmless in practice, since
`Link._read_reply()` (`write_nav.py`) never actually checks the reply's own command tag, only
USB HID framing; `device_info.py`'s `read_device_info()` only requires >=40 reply bytes and
this one is 48, so the existing parser would already produce a `model`/`serial`/`fw_version`/
`hw_version` result unmodified, no Kailash-specific code needed for this specific call.
`ambit3_get_compact_serial` (`0x0b1e`) and `status` (`0x0306`) both round-tripped normally too,
same commands as Ambit3. GPS orbit write landed at `0x0704e0` (not the Ambit3's own address) -
not a blocker on its own, since neither `sgee.py` nor this trace hardcodes that address; it's
discovered from the `gps_orbit_head` (`0x0b15`) reply at connect time either way.

**Real answer to "does Kailash have sport modes / does the Ambit3 activity-download protocol
work for it," from the device's own memory map, not guessed:** the same capture's `0x0b21`
(`ambit3_memory_map`) reply is self-describing - a real, `write_nav.py`
`read_memory_map()`-style list of `[name]\0[hash]\0[u32 start][u32 size]` entries - and parsing
it directly (same regex approach `read_memory_map()` already uses, just widened past its
current `Waypoints|Routes|GpsSGEE`-only pattern) gives the real, complete picture:

| Region | start | size | present? |
|---|---|---|---|
| Waypoints | `0x005000` | 16384 | yes |
| Routes | `0x14c080` | 130000 | yes |
| GpsSGEE | `0x0704e0` | 140000 | yes (matches the write address above exactly) |
| GlonassSGEE | `0x1339e0` | 100000 | yes - a **second**, separate orbit region Ambit3 doesn't have at all |
| BlePairingInfo | `0x000546` | 450 | yes |
| EventLog | `0x0c3500` | 400000 | yes - **not a region name this project has ever seen on Ambit3** |
| TrackLog | `0x48a1c0` | 1310713 | yes - also never seen on Ambit3; the largest real region on the device |
| Apps | `0xffffffff` | 0 | **no** |
| CustomModes | `0xffffffff` | 0 | **no - confirms André's own recollection directly, from the hardware itself** |
| ExerciseLog | `0xffffffff` | 0 | **no - the Ambit3's own activity-log mechanism plainly doesn't exist here** |

Real conclusion, not assumed: **Kailash needs its own activity-download implementation, not a
reuse of `exercise_log.py`'s `EXERCISE_LOG_BASE`/`EXERCISE_LOG_SIZE`.** That mechanism reads a
region this device reports as absent. The real data almost certainly lives in `TrackLog`
(GPS/exercise samples, by name and size - over a million bytes, the same order of magnitude as
Ambit3's own multi-megabyte `ExerciseLog`) and/or `EventLog` (400000 bytes - plausibly lap/
event markers, a smaller, different-shaped record than raw samples) - genuinely new formats,
neither one decoded here, real follow-up work. Orbital update (`GpsSGEE`) is unaffected by any
of this and already confirmed working end-to-end with the existing `sgee.py`, address and all.

**First real attempt at both, 2026-08-08 - built, tested against synthetic data, *not* yet run
against a real Kailash.** Two new tools, one per region, both reusing existing real parsers
wholesale rather than reimplementing anything:

- `tools/kailash_tracklog.py` - reads `TrackLog` (`0x48a1c0`, 1,310,713 bytes) via the same
  generic `0x0b17` flash-read every other region uses, then hands the raw bytes to
  `exercise_log.py`'s own `parse_master_header()`/`walk_entries()`/`to_gpx()`/`to_fit()`
  completely unmodified - the literal "try the Ambit3 ExerciseLog method" André asked for.
  Verified the failure path is honest, not silent: fed it random bytes and an all-zero
  buffer, both correctly reported "doesn't look like this format" / "empty" rather than
  crashing or fabricating fake entries.
- `tools/kailash_eventlog.py` - reads `EventLog` (`0x0c3500`, 400,000 bytes) the same way,
  then walks it as a flat array of 52-byte `WaypointDescriptor` records (this project's own
  real lat/lon/name/route_name/tail struct, already hardware-verified for Ambit3's own
  Waypoints/POI region) - the closest real analogue to "same as POI," since EventLog has no
  Ambit3 equivalent of its own to copy exactly. A plausibility filter (real lat/lon range,
  mostly-printable decoded name, `decode_name()` never raises so this is load-bearing, not
  decorative) keeps only slots that look like real records, and reports the hit rate plainly -
  verified against both random bytes (0% hit rate, correctly flagged as "wrong hypothesis")
  and a synthetic 100-record buffer of real Paris coordinates (100% hit rate, decoded
  correctly, real GPX `<wpt>` output). Kailash's own real memory map places its *Waypoints*
  region at the exact same address as Ambit3's (`0x005000`) - real evidence the two devices
  share at least some struct layouts, not just a hopeful guess to reuse this one for EventLog
  too.

**Both were real hypotheses, not confirmed decodes** - and both got tested for real,
2026-08-08, against André's actual connected Kailash. One real bug found and fixed along the
way: `write_nav.py`'s own `PRODUCT_IDS` whitelist (and the system's `/etc/udev/rules.d/
libambit.rules`, a separate per-product-ID whitelist at the OS permission level) never had
Kailash's own real product ID (`0x002a`, confirmed via `lsusb`, "Hoopoe" already matched the
device_info reply) - `Link.open()` reported "no Ambit3 on the USB bus" with the watch plugged
in and working, because it was never in either list. Both now updated.

**`EventLog` - hypothesis falsified, and the real content explains why.** The
`WaypointDescriptor`-shaped scan did find a real 13.2% hit rate (1018/7692 slots) against real
bytes - but the decoded "names" are literal C source filenames (`hwGpsComm.c`, `psComm.c`,
`ppBattery.c`, `appUsb.c`), not place names. This region is not a POI/places-visited log at
all - it reads like an internal firmware diagnostic/event log (GPS comm, battery, USB
subsystem events), which is a completely different, and arguably more literal, reading of
"EventLog" than the working hypothesis assumed. Real information, not a dead end - just not
the one this session set out to find. Decoding it properly is real follow-up work of its own.

**`TrackLog` - hypothesis about the *format* was wrong, but the *data* is real and now
decoded - and the first decode attempt was itself wrong in a real, instructive way.**
`parse_master_header()`/`walk_entries()` failed cleanly exactly as designed (no PMEM magic,
implausible master-index numbers) - the Ambit3 `ExerciseLog` shape genuinely doesn't apply
here. Direct byte analysis of the real dump found something better: a clean, perfectly regular
20-byte fixed-stride record. The *first* attempt at reading it got every field's identity
right but the record boundary wrong by exactly one byte - and the misaligned read still
produced smoothly-varying, plausible-*looking* GPS coordinates (a coherent-seeming track
through the Canadian Arctic) purely by coincidence, because shifting a mostly-numeric record
by one byte doesn't turn it into obvious garbage. **"Varies smoothly" is not the same as
"correct"** - the actual bug only surfaced when André pointed out the real location should be
Lille, France, not the Arctic. Corrected by searching the raw bytes directly for Lille's own
real coordinates (~50.63N, ~3.06E) rather than trusting the earlier alignment, which is what
pinned the true record start. Confirmed, real layout:

    record stride: 20 bytes, starting at region offset 1 (not 0 - the region's own first byte
    is a real, currently-unexplained leading byte, not part of any record)

    offset  size  field
    0       4     lat, int32 LE, degrees*1e7 (same convention as this project's own
                   WaypointDescriptor/exercise_log.py samples)
    4       4     lon, int32 LE, degrees*1e7
    8       4     "third" field - clusters tightly (roughly 2,000-9,000 across every real
                   record) - unit/meaning not confirmed (accuracy/HDOP is plausible)
    12      2     year, u16 LE (`0x07ea` = 2026, exact)
    14      1     month
    15      1     day
    16      1     hour
    17      1     minute
    18      2     two more real bytes, no clear pattern found yet - reported raw, not
                   asserted

**56 real GPS points decoded and exported to a real GPX track** (`tools/kailash_tracklog.py`,
rewritten twice around this format - once for the initial 20-byte-stride discovery, again for
the one-byte alignment correction), spanning 2026-08-02 through 2026-08-07, coordinates
matching André's own real, independently known location (Lille, France) closely and
consistently across every real record - lat clustering at ~50.624N, lon drifting smoothly
~3.045-3.060E record to record, exactly like a real short walked/hiked track around a single
real place, not noise. One earlier record (index 0) has a completely different byte shape
(`third` field `3,735,608`, well outside the real ~2,000-9,000 cluster, even though its own
date fields alone happen to look valid too) - almost certainly a header/init record, not a GPS
fix; the decoder's plausibility filter bounds the `third` field specifically because that's
the one thing that actually tells the two apart. Past record 56, the same fields degrade into
implausible values - the exact same "real data, then unused flash" shape already established
for Ambit3's own `ExerciseLog`, not a new phenomenon.

**Complete, independent ground-truth confirmation found afterward - not just "matches a known
place," a real row-for-row match.** André pointed at `assets/APK/kailash/Suunto 7R/` (a real
iOS app container extraction, the actual "7R" app he described as the Traverse-family's own
history/log viewer). Two real finds in it:

- `Container/Documents/descr+79DC39510E000100+2.0.5` - a real SBEM0102 schema descriptor for
  *this exact watch* (serial and firmware match precisely), parseable with this project's own
  already-existing `tools/sbem_schema.py` unmodified. Confirms `sml.DeviceHistory.Histories.
  History` has `VisitedCities`/`VisitedCountries` (float32 lat/lon, a genuinely different
  encoding from everything else in this schema, which is otherwise all int32*1e7) and
  `LogHeaders` (per-move `DateTime`/`Duration`/`Distance`/`Speed.Max` summaries) - real
  confirmation that "cities you visited" is a real, named on-device concept, distinct from
  plain GPS samples (`sml.DeviceLog.Samples.Sample.Latitude/Longitude`, the same int32*1e7
  convention `TrackLog` uses). `EventLog`'s raw bytes were checked directly against this -
  no `SBEM0102` magic anywhere in it, ruling out that encoding for this specific region
  outright, not just leaving it unconfirmed. Combined with the real embedded C filenames
  already found in it, `EventLog` firmly reads as a low-level firmware diagnostic log, and
  `VisitedCities` most likely lives elsewhere - probably computed phone-side (it needs
  reverse geocoding, which needs the phone's own connectivity, not something a watch would
  do standalone) rather than stored on the watch's own flash at all.
- `Container/Library/Application Support/7r-trackLog.db` - a real SQLite database, the app's
  own already-parsed history: `track_logs` (`unix_date, latitude, longitude, altitude, speed`
  - 58 real rows) and `device_history` (`visited_cities=1, visited_countries=1,
  travelling_days=0, travelled_distance=0, furthest_from_home=0` - a real, small, recent-use
  device, consistent with everything else confirmed here). Compared directly against the
  56-point decode above, row for row: **the two oldest DB rows (2026-03-15, 2026-03-16)
  aren't in the current `TrackLog` flash dump at all** (already synced and rotated out of the
  small on-device buffer, the same "real data, then it's gone" lifecycle already seen
  elsewhere in this project for on-watch logs) - the remaining **56 DB rows match this
  decoder's 56 accepted records exactly, in the same order, lat/lon agreeing to 5+ decimal
  places** (e.g. DB row 4: `50.6246684, 3.0453514`; this decoder's record 1:
  `50.62467, 3.04535`). This is the real confirmation the earlier "matches a known place"
  framing was reaching for - not approximate, a genuine one-to-one match against ground truth
  independently computed by the real phone app, field by field. The `third`/trailer bytes
  still don't map cleanly to the DB's own real `altitude`/`speed` columns by any simple linear
  scale tried so far - open, not resolved, but no longer the blocking question for a working
  decode, since `lat`/`lon`/`timestamp` (the fields that actually matter for a GPX track) are
  now fully confirmed.

**The real user guide (`assets/manuals/Suunto_Kailash_UserGuide_EN.pdf`) confirms the whole
picture precisely, and clarifies what's still missing.** Real, official text, not inferred:
"Cities visited: 1,000 steps in the same city is required to consider the city visited" -
`VisitedCities` is step-count-gated, not a raw GPS-track derivation, which is exactly why it
wasn't found as a simple lat/lon array anywhere in `TrackLog` or `EventLog`. More directly
useful: "GLONASS is only used in activity mode. **Normal tracking for 7R statistics** uses
[GPS alone]" and "every time you use **activity mode**, your watch stores a log of the
recording in the **logbook**... distance, duration, average speed, maximum [speed]." Real
confirmation of two genuinely separate tracking systems, not one: **passive "normal tracking"
(low precision, always-on, feeds cities/countries/step stats) is what `TrackLog` actually is**
- a flat rolling buffer of periodic samples with no per-session start/stop shape, exactly
matching what was decoded above - while explicit **"activity mode" recordings go into a
separate "logbook"** (matching the SBEM schema's own `LogHeaders` group:
`DateTime`/`Duration`/`Distance`/`Speed.Max`) that hasn't been located in flash yet - real,
scoped follow-up work, not part of `TrackLog`/`EventLog` at all.

**Firmware dump - corrected, was wrong above.** An earlier draft of this section called this
"genuinely unconfirmed" after checking only for a device-side flash mechanism (there's no
"Firmware" region in the memory map above, and `firmware_check.py`'s own function names don't
mention "download" or "Hoopoe" - a narrow `grep`, not an actual read of the file). That was the
wrong place to look: `firmware_check.py` doesn't touch the watch's flash for this at all - it
queries Suunto's own live cloud firmware-distribution service
(`devices.suunto-operations.com`, keyed by model codename + hw_version, App-Zone-unrelated,
already confirmed working for the Ambit3 reference watch 2026-08-07) and downloads the
resulting `.zip`. Since it's keyed by the plain model *codename*, and this same capture already
confirmed Kailash's codename is literally `Hoopoe`, this needed nothing new - just calling
`check_firmware("Hoopoe", "72.1.0")` (the `hw_version` this same capture's `device_info` reply
decoded to earlier). **Confirmed live, real HTTP round trip, 2026-08-08:** returns
`LatestFirmwareVersion: "2.0.5"` - an exact match to `HANDOFF.md`'s own existing reference
("Suunto Kailash + cable... fw 2.0.5"), and a real download URL
(`.../firmwares/Hoopoe-fw_2.0.5-72.1.0.zip`). André confirmed separately this has already been
used successfully in practice. So: firmware dump for Kailash already works, today, with zero
code changes - the same tool as Ambit3, just pointed at a different model name.

**`appstopscreensunrisunset` - a real data point, deliberately not turned into a claim.**
Chronologically the last capture in this whole batch, right after
`installcyclingappmiddlescreenheartzone1-5` (`Cycling`'s own `AppMeta` timestamp confirms the
ordering). Diffing `Cycling`'s displays between the two shows `Display[0]`'s `Fields[0]`
(`FT_SHORTCUT`, the "top" row) `Type` going `1 -> 51` - plausibly the sunrise/sunset
assignment - but `Fields[1]` (`FT_TIME`, "middle," not the row this action should have
touched) *also* shifted, `51 -> 52`, in the same sync. That rules out a clean
"`Type` is an independent per-field value" model without more evidence: either assigning one
row has a real side effect on another (a shared counter/index, a display-wide recompute), or
this pair of captures isn't as isolated as the `backlight`/`display`/`quicknav` ones were.
Recorded as-is rather than picking one interpretation - the `Type` value dictionary stays an
open question, not a guessed one.

**`sml.DeviceHistory` read live and working, `tools/kailash_history.py` - real, direct answer
to "import the 7R button's own data into our app," and a real bug found and fixed along the
way.** André's own real 7R-button description ("last city visit, 7 days Lille... 0km furthest
from home... 1 city, 1 country... 0km travelled, 0 travel days") maps exactly onto
`sml.DeviceHistory`, entry `0x67` - queryable live through `write_nav.py`'s existing `0x1200`
object-by-identifier mechanism (already used there for `sml.DeviceLogBook`, entry `0x8d` -
`DeviceHistory` answers the same way, just a different entry ID, found via this exact watch's
own real schema descriptor). Confirmed byte-exact against both the watch's own screen (via
André's description) and the `7R` app's local `device_history` table:
`NumberOfVisitedPlaces`/`NumberOfVisitedCountries`=1/1, `TravellingDays`/`TravelledDistance`/
`FurthestFromHome`=0/0/0, country code `FR`.

**Real bug found live**: `sbem_schema.default_descriptor()` globs for
`descr+*+{REFERENCE_FW}` where `REFERENCE_FW` is hardcoded to the *Ambit3's* own reference
firmware (`"2.4.17"`) - silently wrong for Kailash, and it doesn't fail cleanly: since a real
Ambit3 descriptor exists in `assets/`, it loads that one instead and applies *its* field-ID
meanings to Kailash's real reply bytes. Most fields happened to still decode by coincidence;
two (`0x55`, `0x56`/`0x5e` region) didn't, throwing real `struct.error`/`ValueError`
exceptions from a byte-width mismatch between the two schemas' own differing definitions for
those IDs - silent corruption, not an obvious crash, until the mismatched ones happened to hit
a hard error. Fixed by pointing `kailash_history.py` at Kailash's own real descriptor
explicitly (`assets/APK/kailash/Suunto 7R/Container/Documents/descr+79DC39510E000100+2.0.5`)
rather than the generic Ambit3-reference lookup - any other Kailash-querying tool built later
should do the same, not reuse `default_descriptor()` as-is.

**A real, second discovery in the same reply**: entry `0x66`
(`DeviceHistory.Histories.History.LogHeaders.Header`) is the "activity mode" logbook this
document's own earlier section said "hasn't been located in flash yet" - it isn't in flash at
all, or at least not *only* there; it comes back live in this same `DeviceHistory` query,
bundled alongside the visited-cities summary. Four real sessions confirmed, `Duration` (raw/10
seconds, matching the schema's own `<MOD>x/10,y*10`) and `Speed.Max` (raw/360, matching
`<MOD>x/360,y*360`) applied since `sbem_schema.py`'s generic decoder deliberately doesn't
evaluate `<MOD>` formulas itself: two very short (1.2s/3.2s, 0m - button-press tests, not real
activities), one real ~28-minute session on 2026-08-03 (2249m, max speed ~4.07 - unit
unconfirmed, plausibly m/s), and one 25-second session live during this same investigation
(2026-08-08, 15m) - the watch was actively being used while this was being reverse-engineered,
not a stale fixture.

One more real, separate unit confirmed here: `VisitedCities...Location.Longitude/Latitude`
are plain `float32`, genuinely different from every *other* lat/lon field in this schema (all
`int32`, degrees*1e7) - decoding them as degrees directly gives implausible values (~0.05,
~0.88); as radians (`value * 180 / pi`), they land almost exactly on Lille, matching
`TrackLog`'s own already-confirmed coordinates.

Sources for this section: `assets/ambit3 pcap/v2/` (~50 real USBPcap captures + reference
screenshots, captured 2026-08-08), cross-checked against `assets/WIndows apps/
suuntolink_roaming/app-4.1.15/resources/app/ambit/sport_mode.js` and `.../ambit/settings.js`,
`assets/APK/kailash/Suunto 7R/` (a real iOS app container extraction - its own real SBEM
schema descriptor, `7r-trackLog.db` SQLite database, and `assets/manuals/
Suunto_Kailash_UserGuide_EN.pdf`), and a live, working `sml.DeviceHistory` query against
André's real connected Kailash, 2026-08-08.
