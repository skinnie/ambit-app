#!/usr/bin/env python3
"""Reads and writes a curated set of real, screenshot-confirmed Ambit3 `DeviceSettings`
fields, by name - never by a hardcoded entry ID. Entry IDs are assigned per schema
descriptor and are NOT portable across watches: a real bug, found and fixed 2026-08-08,
reused an entry ID read from Kailash's own (much smaller) schema against the Ambit3, and
silently wrote to a completely different field (`Units.Altitude` instead of `Time.Format`)
without any error - see `custom_modes_andre.md`'s "settings write" section for the full
story. This tool always re-derives the real entry ID from a fresh `--all`-equivalent read
of the SPECIFIC watch being written to, so that whole bug class cannot recur.

**Confirmed working end to end against real hardware, 2026-08-08**: flipped
`Display.Invert` (Dark/Light) on André's own connected Ambit3 Peak and he confirmed on the
watch's own screen that it visibly changed - the first real, independently-verified
confirmation in this project that a cable settings write (`0x1101`) actually takes live
effect, not just an accepted-and-echoed-but-inert write.

Two curated tables, one per real schema family - `AMBIT3_SETTINGS` (Ambit3/Traverse/
Ambit2) only includes fields visible in SuuntoLink's own real "General Settings" screen
(`assets/ambit3 pcap/v2/general ambit settings/`); `KAILASH_SETTINGS` only includes fields
visible in the real 7R iOS app's own settings screen (`assets/APK/kailash/IMG_2741.png`,
`IMG_2742.png` - a real screenshot pair, not the Ambit3's). `settings_table()` picks the
right one from a product_id, defaulting to the Ambit3 table for every non-Kailash ID (the
whole family shares that schema shape). Each field's real type/enum comes directly from the
schema itself (`<FRM>` tag), not hand-mapped - `describe_field()` turns that into a
JSON-friendly shape (enum choices, or a numeric range) for a UI to render generically.

    ./tools/settings_write.py                                    # read every known setting
    ./tools/settings_write.py --json                              # same, as one JSON line
    ./tools/settings_write.py --set display_dark=1 --write        # real write, confirmed by re-read
    ./tools/settings_write.py --set display_dark=1                # dry-run: shows what would change
    ./tools/settings_write.py --device kailash                    # Kailash's own curated table
"""

import argparse
import json
import re
import struct
import sys

import sbem_schema
from write_nav import CMD_SETTINGS_READ, Link, descriptor_for_product_id

CMD_SETTINGS_WRITE = 0x1101
KAILASH_PRODUCT_ID = 0x002A

# key -> a unique suffix of the real schema path (matched via .endswith(), so
# "Display.Invert" only ever matches sml.DeviceSettings.Display.Invert, not some other
# field that happens to contain "Invert" mid-path). Every one of these is visible in
# SuuntoLink's own real "General Settings" screen for the Ambit3 - see this file's own
# docstring for the screenshot source. `display_dark` is the only one live-hardware-
# confirmed to take visible effect so far; the rest share the exact same real 0x1100/0x1101
# mechanism and schema-driven encoding, so there's no principled reason to expect them to
# behave differently, but they haven't each individually been checked against the watch's
# own screen the way display_dark has.
AMBIT3_SETTINGS = {
    "language": "Units.Language",
    "date_format": "Date.Format",
    "time_format": "Time.Format",
    "gps_time_keeping": "Time.GPSTimeKeeping",
    "units_mode": "Units.Mode",
    # Real, 2026-08-09 ("check if meters or imperial or advanced, and how the watch deals
    # with it") - Units.Mode (above) is the real master switch (0=Metric, 1=Imperial,
    # 2=Advanced, schema-confirmed); this per-unit field only actually applies when
    # units_mode is Advanced - Metric/Imperial force every individual unit (this one
    # included) to follow the master choice. Added for Sport Modes' own real-unit Autolap
    # display, not because it's on the General Settings screenshot this table's other
    # entries were curated from - same real 0x1100/0x1101 mechanism regardless.
    "distance_unit": "Units.Distance",
    "gps_position_format": "GpsPositionFormat",
    "compass_declination": "Compass.Declination",
    "button_lock_time_mode": "ButtonLock.TimeMode",
    "button_lock_sport_mode": "ButtonLock.SportMode",
    "tones": "Audio.Mode",
    # Real, 2026-08-10: readable, NOT writable. Entry 0x1f is in the watch's own read
    # reply and in SuuntoLink's generic ServiceAdapter.xml, but appears in NONE of the
    # 134 captured writes, and André confirmed it is changed on the watch itself and is
    # on no SuuntoLink screen. It has no write template, so write_one() refuses it - see
    # AMBIT3_KEY_TEMPLATE.
    "display_contrast": "Display.Contrast",
    "display_dark": "Display.Invert",  # confirmed live, 2026-08-08 - see docstring
    "backlight_mode": "Display.Backlight.Mode",
    "backlight_brightness": "Display.Backlight.Brightness",
    "storm_alarm": "AltiBaro.StormAlarm",
    # Real, 2026-08-10 - the rest of SuuntoLink's own three Ambit3 settings screens,
    # every one of them confirmed present in the captured write templates (see
    # AMBIT3_WRITE_TEMPLATES). These were simply missing before: the General Settings
    # table above was curated from a screenshot that didn't scroll far enough, and the
    # Unit and Personal screens had no coverage at all.
    "alti_baro_profile": "AltiBaro.Profile",
    "units_orientation": "Units.Orientation",
    # Unit settings. Every one of these only actually applies when units_mode is
    # Advanced - Metric/Imperial force them all to follow the master switch, which is
    # why SuuntoLink re-sends the whole resolved block right after changing the mode.
    "air_pressure_unit": "Units.AirPressure",
    "altitude_unit": "Units.Altitude",
    "compass_unit": "Units.Compass",
    "heartrate_unit": "Units.Heartrate",
    "height_unit": "Units.Height",
    "temperature_unit": "Units.Temperature",
    "vertical_speed_unit": "Units.VerticalSpeed",
    "weight_unit": "Units.Weight",
    # Personal settings. Raw on-wire values, matching the rest of this table: body_weight
    # is kg*100 (7500 = 75,0 kg), activity_level is the activity class *10 (70 = "7.0"),
    # body_height is plain cm, and birth_date is the "YYYY-01-01" string the watch stores
    # (SuuntoLink only ever edits the year - month/day are always 01-01, never real).
    "gender": "Personal.Gender",
    "birth_date": "Personal.BirthDay",
    "body_height": "Personal.Height",
    "body_weight": "Personal.Weight",
    "max_hr": "Personal.MaxHR",
    "rest_hr": "Personal.RestHR",
    "activity_level": "Personal.ActivityLevel",
    # Real, 2026-08-09: entry 0x2c, uint8, schema path sml.DeviceSettings.Sports.Plans.Source -
    # the planned-moves ("training programs", section 3.39) source/enable flag. Added to test
    # whether re-writing it via 0x1101 is the app-triggered "refresh" that makes the watch
    # re-parse the TrainingProgram pmem region and surface a "Today" target (André: the refresh
    # is app-triggered; the watch has no restart). Not on the General Settings screen - same
    # real 0x1100/0x1101 mechanism regardless. See training_program_andre.md Findings 29-30.
    "plans_source": "Sports.Plans.Source",
}

# Kailash's own real, smaller schema (confirmed 41 entries total vs. the Ambit3's ~324) -
# every key here maps to its own real entry ID, independently confirmed live 2026-08-08
# (`settings_write.py --device kailash --all`), not assumed to match the Ambit3's numbering
# (it doesn't - e.g. Display.Invert is 0x27 here, 0x20 on the Ambit3). `date_format`
# through `storm_alarm` are exactly the fields the real 7R iOS app's own settings screen
# shows (see this file's own docstring for the screenshot source); `display_dark` is not
# shown in the 7R app's own UI at all, but is included anyway - it's the one field
# independently, live-hardware-confirmed on THIS watch (protocol re-read *and* André
# confirming on the Kailash's own screen that it visibly switched Light -> Dark), a
# stronger bar than everything else in this table has individually cleared.
KAILASH_SETTINGS = {
    "date_format": "Date.Format",
    "tones": "Audio.Mode",
    "vibration": "Vibration.Mode",
    "units_mode": "Units.Mode",
    "language": "Units.Language",
    "time_format": "Time.Format",
    "display_contrast": "Display.Contrast",
    "backlight_mode": "Display.Backlight.Mode",
    "backlight_brightness": "Display.Backlight.Brightness",
    "storm_alarm": "AltiBaro.StormAlarm",
    "display_dark": "Display.Invert",  # confirmed live, 2026-08-08 - see docstring above
    # Real, found 2026-08-08 from two real iOS PacketLogger BLE captures of the 7R app
    # (kailashsethome.pklg / kailashsnotificationsandsethome.pklg), then confirmed
    # byte-exact against this watch's own real schema descriptor: entry 0x36 is a GROUP,
    # sml.DeviceSettings.HomeLocation, packing two int32 sub-fields (Latitude 0x28,
    # Longitude 0x29), each with a real <MOD> tag confirming the degrees*1e7 encoding
    # this project's own POI format already uses. Confirmed absent from the Ambit3's own
    # descriptor entirely - Kailash-only. See ambit_app_kailash_home_location_field
    # memory. Unlike every other key in this table, these two are GROUP members, not
    # top-level entries - read_all()/write_one() below resolve that generically. Values
    # are decimal degrees (not the raw int32), range-checked before any write is sent;
    # write_one() also refuses if the group ever turns out to hold more than one record
    # (it doesn't for HomeLocation, but the check stays as a safety net for any other
    # GROUP-member field added here later). NOT YET hardware-confirmed - no watch
    # available in this environment to actually send the write; the read side is
    # schema-confirmed, the write side follows the same 0x1101 mechanism already proven
    # for every scalar field in this table.
    "home_latitude": "HomeLocation.Latitude",
    "home_longitude": "HomeLocation.Longitude",
    # Real, 2026-08-10 ("Kailash time-sync doesn't take effect over cable... crosscheck
    # everything with the name kaylash") - the real mechanism, found in SuuntoLink's own
    # log (assets/WIndows apps/Suuntolink/suuntoapp*.log): `NspEndDevice::setSmlData`
    # fires immediately before a real `EmuDevice::setDateAndTime succeeded`, and Kailash's
    # own schema descriptor confirms entry 0x34 sml.DeviceSettings.Time.TimeISO8601, a
    # utf8 field - not the standalone date/time command pair this project used for the
    # Ambit3 family (device_driver_common.c's date_time_set, ported to tools/set_time.py),
    # which acks over Kailash's cable connection but never actually takes effect. This is
    # the same 0x1101 settings-write mechanism already confirmed live for Home Location/
    # backlight/etc. above - see write_one()'s own new utf8-field support.
    "device_time": "Time.TimeISO8601",
}

# Real MOD conversion straight from the schema descriptor for these two fields
# (`PI*x/(10^7*180)` - radians for on-device math; dividing by 1e7 alone gives plain
# decimal degrees, the useful value for a human/UI). Not applied generically - no other
# curated field here has a <MOD> tag yet - just named explicitly for these two.
_DEGREES_X1E7_KEYS = {"home_latitude", "home_longitude"}


# ============================ Ambit3 write templates ============================
#
# Real, 2026-08-10, from the 21 SuuntoLink USBPcap captures in `assets/pcap/ambit3*`.
# SuuntoLink does NOT write the settings blob back the way this file used to: it never
# echoes the watch's own 0x1100 reply. It sends a small, purpose-built SBEM payload
# containing only the fields of the ONE settings screen being saved - 17/129/130/136/139
# bytes against a 438-589 byte read reply.
#
# That difference is not cosmetic. The full read reply contains
# `WhitelistedBleDevices.Device` - 8 records, one of them 147 bytes, holding the paired
# phone's IdentityResolvingKey, EncodingKey, EncodingRnd and IsAuthenticated - plus
# FirstBeatVariables, Status and the swimming calibration table. Echoing the whole blob
# back re-transmitted every one of those bytes on every settings change, so a single
# mis-copied byte in a region we never inspect could have silently destroyed the BLE
# bond. Sending SuuntoLink's own template cannot: those entries are simply not in it.
#
# The model below was verified by reconstructing all 134 real 0x1101 writes across those
# captures byte-for-byte from the preceding 0x1100 read - 134/134 exact, 0 ordering
# violations (see this file's own selftest hook, `verify_against_captures()`):
#
#     payload = <read reply's own 6-byte prefix, last byte 0x00 -> 0x01>
#               + "SBEM0102"
#               + the template's entries, ordered ALPHABETICALLY by full schema path,
#                 values copied verbatim from a fresh 0x1100 read, one field patched
#
# Entries are named by schema-path suffix, never by hardcoded entry ID, for exactly the
# reason this file's own docstring gives. `Pods.Pod.Type` resolves to the Pods GROUP
# (0x43), whose 8 records are emitted in read order - that group and Sports.Plans.Source
# ride along in every template, on every screen, in the real captures.
# `Pods+Pod.Type` - the descriptor marks a repeating group with `+` before the repeated
# element, so the real path is `sml.DeviceSettings.Pods+Pod.Type`, not `Pods.Pod.Type`.
_ALWAYS_IN_TEMPLATE = ["Pods+Pod.Type", "Sports.Plans.Source"]

AMBIT3_WRITE_TEMPLATES = {
    # SuuntoLink's "General settings" screen.
    "general": [
        "AltiBaro.Profile", "AltiBaro.StormAlarm", "Audio.Mode",
        "ButtonLock.SportMode", "ButtonLock.TimeMode", "Compass.Declination",
        "Display.Backlight.Brightness", "Display.Backlight.Mode", "Display.Invert",
        "GpsPositionFormat", "Time.GPSTimeKeeping", "Units.Language",
        "Units.Orientation",
    ] + _ALWAYS_IN_TEMPLATE,
    # SuuntoLink's "Unit settings" screen, minus the master switch below.
    "units": [
        "Date.Format", "Time.Format", "Units.AirPressure", "Units.Altitude",
        "Units.Compass", "Units.Distance", "Units.Heartrate", "Units.Height",
        "Units.Temperature", "Units.VerticalSpeed", "Units.Weight",
    ] + _ALWAYS_IN_TEMPLATE,
    # Units.Mode travels ALONE, in its own 17-byte write, with no Pods/Plans tail -
    # and SuuntoLink always follows it immediately with the full "units" template
    # above (see write_one()'s own two-step handling). Real: every unit-settings save
    # in `ambit3unitsettingschangeeachbackbegin` is that exact pair, even when nothing
    # changed.
    "units_mode": ["Units.Mode"],
    # SuuntoLink's "Personal settings" screen.
    "personal": [
        "Personal.ActivityLevel", "Personal.BirthDay", "Personal.Gender",
        "Personal.Height", "Personal.MaxHR", "Personal.RestHR", "Personal.Weight",
    ] + _ALWAYS_IN_TEMPLATE,
}

# Which template carries each curated key. A key with no entry here has no real
# SuuntoLink template that contains it, and write_one() refuses rather than inventing
# one - `display_contrast` is the real case (entry 0x1f is in the read reply and in
# SuuntoLink's own generic ServiceAdapter.xml, but appears in NONE of the 134 captured
# writes; André confirmed 2026-08-10 that it is changed on the watch itself and is not
# on any SuuntoLink screen).
AMBIT3_KEY_TEMPLATE = {
    "language": "general", "gps_time_keeping": "general",
    "gps_position_format": "general", "compass_declination": "general",
    "button_lock_time_mode": "general", "button_lock_sport_mode": "general",
    "tones": "general", "display_dark": "general", "backlight_mode": "general",
    "backlight_brightness": "general", "storm_alarm": "general",
    "alti_baro_profile": "general", "units_orientation": "general",
    "plans_source": "general",
    "date_format": "units", "time_format": "units", "distance_unit": "units",
    "air_pressure_unit": "units", "altitude_unit": "units", "compass_unit": "units",
    "heartrate_unit": "units", "height_unit": "units", "temperature_unit": "units",
    "vertical_speed_unit": "units", "weight_unit": "units",
    "units_mode": "units_mode",
    "gender": "personal", "birth_date": "personal", "body_height": "personal",
    "body_weight": "personal", "max_hr": "personal", "rest_hr": "personal",
    "activity_level": "personal",
}

# Real numeric bounds, from André's own SuuntoLink UI test 2026-08-10 (he confirmed the
# UI refuses to accept anything outside these). NOT taken from the captures: he was not
# always clicking the stops, so a captured value is evidence of an encoding, never of a
# range. Also NOT taken from SuuntoLink's `ServiceAdapter.xml`, whose min/max are the
# generic superset for the whole (newer) device family and are provably wider than what
# an Ambit3 accepts - that file's `max="15"` on GpsPositionFormat is exactly what let
# SuuntoLink write an out-of-range `SWEREF 99 TM` at this watch and strand the field.
# Values are the RAW on-wire integers, matching read_all()'s own reported value.
AMBIT3_RANGES = {
    "body_height": (89, 241),        # cm
    "body_weight": (3000, 25000),    # kg * 100
    "max_hr": (30, 240),             # bpm
    "rest_hr": (30, 240),            # bpm
    "activity_level": (10, 100),     # activity class * 10
    "backlight_brightness": (5, 100),
}


def settings_table(product_id):
    """Which curated table applies to `product_id` - Kailash's own smaller one for its real
    product ID, the Ambit3's table for everything else (Traverse/Ambit2 share that same
    schema family)."""
    return KAILASH_SETTINGS if product_id == KAILASH_PRODUCT_ID else AMBIT3_SETTINGS

_ENUM_RE = re.compile(r"^enum:(.+)$")


def _find_field(schema, path_suffix):
    """The one field whose real path ends with `.{path_suffix}` - raises if none or more
    than one match, rather than silently picking the wrong one (the exact failure mode
    this file exists to prevent)."""
    suffix = "." + path_suffix
    matches = [f for f in schema.fields.values() if f.path.endswith(suffix)]
    if not matches:
        raise KeyError(f"no field ending in {suffix!r} in this watch's own real schema")
    if len(matches) > 1:
        raise KeyError(f"{len(matches)} fields end in {suffix!r} - ambiguous: "
                        + ", ".join(m.path for m in matches))
    return matches[0]


def _group_containing(schema, fid):
    """The id of the GROUP entry that packs `fid` as one of its own sub-fields, or None
    if `fid` is itself a plain top-level scalar entry (true for every curated field until
    HomeLocation - see ambit_app_kailash_home_location_field memory). On the wire, a
    group's members never appear as their own top-level SBEM entries, only packed
    together inside their parent group's single entry."""
    for gid, members in schema.groups.items():
        if fid in members:
            return gid
    return None


def _field_offset_in_group(schema, group_id, target_fid):
    """Byte offset of `target_fid` within its own group's single-record layout (e.g.
    HomeLocation: Latitude at 0, Longitude at 4) - only meaningful for a group that
    always encodes exactly one record. write_one() itself verifies the real entry length
    matches before trusting this, so a repeating group (like
    WhitelistedBleDevices.Device, where "which record" would be ambiguous) fails closed
    instead of silently writing the wrong record."""
    off = 0
    for fid in schema.groups[group_id]:
        if fid == target_fid:
            return off
        off += schema.fields[fid].size
    return None


def _entry_value(schema, entry_id, data, target_fid):
    """The decoded value of `target_fid` within `entry_id`'s own wire entry - handles
    both a plain scalar entry (entry_id == target_fid, schema.decode_entry's own
    single-field path) and a field packed inside a GROUP entry (entry_id is the group's
    own id, target_fid one of its members) uniformly, via the same decode_entry() every
    other read in this project already trusts."""
    records = schema.decode_entry(entry_id, data)
    if not records:
        return None
    for record in records:
        for f, value in record:
            if f.fid == target_fid:
                return value
    return None



# Real, 2026-08-09 ("on the buttons always start with capital letter... gps time keeping
# => true, it should be True") - the watch's own descriptor spells several enum choice
# labels lowercase verbatim (confirmed via a real grep across both the Ambit3 and Kailash
# descriptors: GPSTimeKeeping/FusedAltitude/GpsBackgroundMode all use literal "true"/
# "false"). Fixed by name, not by blindly capitalizing every enum label's first letter -
# that same grep also found real unit-symbol choices ("hPa", "km", "kg", "bpm", "24h",
# "degree", "mil", "min", "hour") that are correct as-is; force-capitalizing those would
# turn "hPa" into the wrong "HPa". Only the confirmed real words get fixed.
_ENUM_LABEL_FIXES = {"true": "True", "false": "False"}


def describe_field(field):
    """JSON-friendly shape for a UI: {"kind": "enum", "choices": [[0, "Light"], ...]} or
    {"kind": "bool"} or {"kind": "number", "min":..., "max":...}."""
    m = _ENUM_RE.match(field.frm)
    if m:
        choices = []
        for part in m.group(1).split(","):
            value_str, _, label = part.partition("=")
            choices.append([int(value_str), _ENUM_LABEL_FIXES.get(label, label)])
        return {"kind": "enum", "choices": choices}
    if field.base == "bool":
        return {"kind": "bool"}
    if field.base in ("uint8", "uint16", "uint32"):
        return {"kind": "number", "min": 0, "max": (1 << (field.size * 8)) - 1}
    if field.base in ("int8", "int16", "int32"):
        half = 1 << (field.size * 8 - 1)
        return {"kind": "number", "min": -half, "max": half - 1}
    if field.base in ("float32", "float64"):
        return {"kind": "number"}
    # Real, 2026-08-10: a utf8 field is editable text, not an opaque blob - reporting it
    # as "raw" left a UI with nothing it could render for the Ambit3's own birth_date
    # (and Kailash's device_time). Both are short fixed-length strings the watch stores
    # NUL-padded; write_one() enforces the length.
    if field.base == "utf8":
        return {"kind": "text"}
    return {"kind": "raw"}


def read_all(payload, descriptor, product_id=None):
    """Every entry of the curated table for `product_id` (see settings_table()), decoded
    through the given descriptor. Returns {key: {"value": ..., "path": ..., **describe_field()}}.
    Skips (with a note, not a crash) any key whose field isn't in this watch's own schema."""
    schema = sbem_schema.load(descriptor)
    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        return {"ok": False, "error": "no SBEM0102 payload in the reply"}

    entries = dict(sbem_schema.entries(payload[head:]))
    out = {}
    for key, suffix in settings_table(product_id).items():
        try:
            field = _find_field(schema, suffix)
        except KeyError as exc:
            out[key] = {"ok": False, "error": str(exc)}
            continue
        group_id = _group_containing(schema, field.fid)
        entry_id = group_id if group_id is not None else field.fid
        data = entries.get(entry_id)
        if data is None:
            out[key] = {"ok": False, "error": f"entry 0x{entry_id:02x} not in this reply"}
            continue
        value = _entry_value(schema, entry_id, data, field.fid)
        desc = describe_field(field)
        if group_id is not None:
            # A GROUP member's own min/max (describe_field's, from its raw int width -
            # +-2^31 for a plain int32) is meaningless once the value is displayed in
            # its real, scaled unit (decimal degrees for HomeLocation) - drop it so a
            # generic "number" UI doesn't render a -2147483648..2147483647 slider for a
            # latitude. A UI that wants a real geo editor for these two keys should key
            # off `path` (ends in "HomeLocation.Latitude"/".Longitude"), not this range.
            desc = {"kind": desc["kind"]}
        if key in _DEGREES_X1E7_KEYS and value is not None:
            value = value / 10 ** 7
        # Real, 2026-08-10: tell a UI what it may actually offer, instead of leaving it
        # to guess from `kind`. `writable` is false for a field on no real SuuntoLink
        # screen (display_contrast), so the UI shows the value without an editor rather
        # than sending a write this project has no reference implementation for; and the
        # min/max here are the ranges SuuntoLink's own UI enforces, which are much
        # tighter than the raw integer width describe_field() derives (backlight
        # brightness is 5..100, not 0..255).
        writable = (product_id == KAILASH_PRODUCT_ID
                    or key in AMBIT3_KEY_TEMPLATE)
        if key in AMBIT3_RANGES and product_id != KAILASH_PRODUCT_ID:
            desc = dict(desc)
            desc["min"], desc["max"] = AMBIT3_RANGES[key]
        elif not writable:
            # No editor will be shown, so don't hand a UI a range to build one from -
            # describe_field()'s own is the raw integer width (0..255 for
            # display_contrast), which was never a real range for this field anyway.
            desc = {k: v for k, v in desc.items() if k not in ("min", "max")}
        # Which of SuuntoLink's own settings screens this field lives on, so a UI can
        # group the list the way the watch's owner already knows it (General / Unit /
        # Personal) instead of showing 30+ fields in one flat run. None for a field on
        # no screen (display_contrast) and for every Kailash field, whose own 7R app
        # groups differently and has no captured template.
        screen = AMBIT3_KEY_TEMPLATE.get(key) if product_id != KAILASH_PRODUCT_ID else None
        if screen == "units_mode":
            screen = "units"
        out[key] = {"ok": True, "value": value, "path": field.path,
                    "writable": writable, "screen": screen, **desc}
    return {"ok": True, "settings": out}


def _enum_value_set(field):
    """The set of integers this field's own descriptor enum actually allows, or None if
    it isn't an enum. This is the ONLY authority on what a value may be - deliberately
    not SuuntoLink's ServiceAdapter.xml, which is the generic mapping for the whole
    device family and lists values this firmware has never heard of."""
    m = _ENUM_RE.match(field.frm)
    if not m:
        return None
    values = set()
    for part in m.group(1).split(","):
        value_str, _, _label = part.partition("=")
        try:
            values.add(int(value_str))
        except ValueError:
            pass
    return values


def _representable(schema, entry_id, data):
    """Whether the watch's CURRENT value for this entry is one we can represent.

    Real, 2026-08-10: SuuntoLink drops a field from its write template entirely when the
    answer is no. Proven in the captures - `ambit3gpspositionformattowgs84HD.d_alldown_
    buggy.d` wrote GpsPositionFormat=15 ("SWEREF 99 TM", which ServiceAdapter.xml offers
    but this watch's own descriptor stops at 14), and from that moment on every later
    capture reads 15 back and SuuntoLink's General Settings write shrinks from 139 to 136
    bytes with entry 0x03 simply absent. Omitting is the safe behaviour and the one we
    copy: re-sending a value we cannot interpret, or silently substituting a legal one,
    would both be worse than leaving the field alone for the watch to keep owning."""
    if entry_id in schema.groups:
        return True
    field = schema.fields.get(entry_id)
    if field is None:
        return False
    values = _enum_value_set(field)
    if values is None:
        if field.base == "bool":
            return len(data) == 1 and data[0] in (0, 1)
        return True
    return len(data) >= 1 and data[0] in values


def _entry_sort_key(schema, entry_id):
    """Full schema path of the entry's first field - a GROUP sorts by its first member.
    SuuntoLink orders every template's entries alphabetically by this, verified across
    all 134 captured writes with zero violations, so the order never has to be written
    down by hand."""
    if entry_id in schema.groups:
        return schema.fields[schema.groups[entry_id][0]].path
    field = schema.fields.get(entry_id)
    return field.path if field else "￿%02x" % entry_id


def _split_entries(payload):
    """(prefix, [(entry_id, data)]) of an SBEM payload, entries in wire order. The prefix
    is whatever precedes the SBEM0102 magic - 6 bytes on a real 0x1100 reply."""
    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        return None, []
    off = head + 8
    out = []
    while off + 2 <= len(payload):
        eid, length = payload[off], payload[off + 1]
        off += 2
        if length == 0xFF:
            length, = struct.unpack_from("<I", payload, off)
            off += 4
        out.append((eid, payload[off:off + length]))
        off += length
    return payload[:head], out


def _encode_entry(entry_id, data):
    if len(data) >= 0xFF:
        return bytes([entry_id, 0xFF]) + struct.pack("<I", len(data)) + data
    return bytes([entry_id, len(data)]) + data


def build_write_payload(schema, read_payload, template, patches=()):
    """SuuntoLink's own 0x1101 payload shape, built from a fresh 0x1100 reply.

    `template` is a list of schema-path suffixes (one of AMBIT3_WRITE_TEMPLATES'). Every
    occurrence of each resolved entry is emitted - that is what turns the single
    "Pods.Pod.Type" suffix into the 8 Pods records the real captures carry. `patches` is
    [(entry_id, occurrence_index, new_bytes)].

    Returns (payload, omitted) where `omitted` lists the schema paths dropped because the
    watch's current value isn't representable (see _representable()). Verified byte-exact
    against all 134 real SuuntoLink writes in `assets/pcap/ambit3*`."""
    prefix, entries = _split_entries(read_payload)
    if prefix is None:
        raise ValueError("no SBEM0102 payload in the read reply")

    by_id = {}
    for eid, data in entries:
        by_id.setdefault(eid, []).append(data)

    wanted = []
    for suffix in template:
        field = _find_field(schema, suffix)
        group_id = _group_containing(schema, field.fid)
        wanted.append(group_id if group_id is not None else field.fid)
    wanted.sort(key=lambda eid: _entry_sort_key(schema, eid))

    patch_map = {(eid, n): data for eid, n, data in patches}
    # The write's prefix is the read's own with its last byte flipped 0x00 -> 0x01, the
    # single difference between a real reply and a real write header in every capture.
    out = bytearray(prefix[:-1] + bytes([0x01])) + sbem_schema.MAGIC
    omitted = []
    for eid in wanted:
        for n, data in enumerate(by_id.get(eid, [])):
            patched = patch_map.get((eid, n))
            if patched is not None:
                out += _encode_entry(eid, patched)
                continue
            if not _representable(schema, eid, data):
                field = schema.fields.get(eid)
                omitted.append(field.path if field else "entry 0x%02x" % eid)
                continue
            out += _encode_entry(eid, data)
    return bytes(out), omitted


def _locate_entry(payload, entry_id):
    """(start, length) of `entry_id` in an SBEM payload, or (None, None). Located fresh
    in whichever payload is being read rather than reusing an offset computed from an
    earlier reply - the layout is stable in practice, but a confirmation read has to
    stand on its own to be worth anything."""
    head = payload.find(sbem_schema.MAGIC)
    if head < 0:
        return None, None
    off = head + 8
    while off + 2 <= len(payload):
        eid, length = payload[off], payload[off + 1]
        off += 2
        if length == 0xFF:
            length, = struct.unpack_from("<I", payload, off)
            off += 4
        if eid == entry_id:
            return off, length
        off += length
    return None, None


def _validate_new_value(schema, key, field, raw_new_value):
    """Refuse - never clamp - a value this watch's own descriptor doesn't allow, or one
    outside the range SuuntoLink's own UI enforces.

    Real, 2026-08-10: this is the guard that would have prevented the GpsPositionFormat
    incident. SuuntoLink built its dropdown from the generic ServiceAdapter.xml
    (`max="15"`) instead of the connected watch's descriptor (`max 14`), wrote 15, and
    left the field in a state where the watch shows "connect to the app" and SuuntoLink
    itself can no longer offer the field at all - unrecoverable without a watch reset."""
    values = _enum_value_set(field)
    if values is not None and raw_new_value not in values:
        return (f"{key}={raw_new_value} is not a value this watch's own descriptor "
                f"allows for {field.path} - legal values: {sorted(values)}")
    if field.base == "bool" and raw_new_value not in (0, 1):
        return f"{key}={raw_new_value} is not a boolean (0 or 1) for {field.path}"
    bounds = AMBIT3_RANGES.get(key)
    if bounds is not None and not (bounds[0] <= raw_new_value <= bounds[1]):
        return (f"{key}={raw_new_value} is outside the range SuuntoLink's own UI "
                f"enforces for {field.path}: {bounds[0]}..{bounds[1]}")
    return None


def _field_bytes(field, raw_new_value, current):
    """On-wire bytes for one field's new value, keeping a utf8 field's own entry length
    (NUL-padded, hard error rather than truncation if it no longer fits)."""
    if field.base == "utf8":
        if not isinstance(raw_new_value, str):
            raise ValueError(f"{field.path} expects a text value")
        encoded = raw_new_value.encode("utf8") + b"\x00"
        if len(encoded) > len(current):
            raise ValueError(f"{raw_new_value!r} is {len(encoded)} bytes, this watch's "
                             f"own {field.path} field is only {len(current)} bytes")
        return encoded.ljust(len(current), b"\x00")
    return struct.pack(field.fmt, raw_new_value)


def _decode_field(field, data):
    if field.base == "utf8":
        return data.split(b"\x00", 1)[0].decode("utf8", "replace")
    return struct.unpack_from(field.fmt, data, 0)[0]


def _write_via_template(link, schema, key, field, raw_new_value, before):
    """SuuntoLink's own write path: send only the template of the screen this field lives
    on, values taken from `before`, this one field patched. See AMBIT3_WRITE_TEMPLATES."""
    problem = _validate_new_value(schema, key, field, raw_new_value)
    if problem:
        return {"ok": False, "error": problem}

    template_name = AMBIT3_KEY_TEMPLATE.get(key)
    if template_name is None:
        return {"ok": False, "error": f"{key} ({field.path}) is on no SuuntoLink settings "
                                       "screen - no real write template contains it, so "
                                       "this tool will not invent one"}

    entry_start, entry_len = _locate_entry(before, field.fid)
    if entry_start is None:
        return {"ok": False, "error": f"entry 0x{field.fid:02x} ({field.path}) not in "
                                       "this watch's current settings reply"}
    current = before[entry_start:entry_start + entry_len]
    try:
        patched = _field_bytes(field, raw_new_value, current)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    previous = _decode_field(field, current)

    # Units.Mode travels alone, and SuuntoLink always follows it with the whole resolved
    # Units block - the master switch forces every individual unit, so sending the switch
    # without the block would leave the watch's own units disagreeing with it.
    sequence = [template_name]
    if template_name == "units_mode":
        sequence.append("units")

    omitted_all = []
    for name in sequence:
        patches = [(field.fid, 0, patched)] if name == template_name else []
        try:
            payload, omitted = build_write_payload(
                schema, before, AMBIT3_WRITE_TEMPLATES[name], patches)
        except (KeyError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
        omitted_all += omitted
        link.command(CMD_SETTINGS_WRITE, payload)

    after = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
    start, length = _locate_entry(after, field.fid)
    confirmed = _decode_field(field, after[start:start + length]) \
        if start is not None else None

    return {
        "ok": confirmed == (raw_new_value if field.base != "utf8" else raw_new_value),
        "path": field.path,
        "template": template_name,
        "previous_value": previous,
        "requested_value": raw_new_value,
        "confirmed_value": confirmed,
        "omitted_fields": sorted(set(omitted_all)),
    }


def write_one(link, descriptor, key, new_value, product_id=None):
    """Real write: reads the current settings blob fresh, patches exactly the bytes for
    `key`'s real field (found in THIS watch's own schema, never a hardcoded ID - see this
    file's own docstring), writes it back via 0x1101, and re-reads to confirm. Returns a
    dict with `ok`, `previous_value`, `confirmed_value` - `ok` is only true if the re-read
    actually shows the new value, the same "prove it, don't just trust the ACK" standard
    this project's own live testing already established was necessary (see
    custom_modes_andre.md).

    `new_value` is always the *logical* value - the same one read_all() reports (an
    enum's raw integer, a plain number, or for a `_DEGREES_X1E7_KEYS` field, decimal
    degrees) - never the raw on-wire encoding; the degrees<->raw*1e7 conversion happens
    in here, symmetric with read_all()'s own."""
    table = settings_table(product_id)
    if key not in table:
        return {"ok": False, "error": f"unknown setting {key!r} - known: {sorted(table)}"}
    schema = sbem_schema.load(descriptor)
    try:
        field = _find_field(schema, table[key])
    except KeyError as exc:
        return {"ok": False, "error": str(exc)}
    is_text = field.base == "utf8"

    group_id = _group_containing(schema, field.fid)
    member_offset = 0
    if group_id is not None:
        member_offset = _field_offset_in_group(schema, group_id, field.fid)
        group_size = sum(schema.fields[m].size for m in schema.groups[group_id])

    if key in _DEGREES_X1E7_KEYS:
        if not isinstance(new_value, (int, float)):
            return {"ok": False, "error": f"{key} expects a decimal-degrees number"}
        if key == "home_latitude" and not (-90 <= new_value <= 90):
            return {"ok": False, "error": f"{key}={new_value} out of range [-90, 90]"}
        if key == "home_longitude" and not (-180 <= new_value <= 180):
            return {"ok": False, "error": f"{key}={new_value} out of range [-180, 180]"}
        raw_new_value = round(new_value * 10 ** 7)
    else:
        raw_new_value = new_value

    before = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
    head = before.find(sbem_schema.MAGIC)
    if head < 0:
        return {"ok": False, "error": "no SBEM0102 payload in the read-back"}

    # Real, 2026-08-10 - the Ambit3 family goes through SuuntoLink's own per-screen
    # template (see AMBIT3_WRITE_TEMPLATES for why that matters: the old path below
    # echoed the watch's entire settings blob back, BLE bond keys included, on every
    # single write). Kailash keeps the full-blob path unchanged: its own writes -
    # HomeLocation as a GROUP member, device_time as utf8 - were worked out and proven
    # against that path, and there are no Kailash write captures to derive templates
    # from, so switching it on a guess would trade a known-working path for an unproven
    # one. That stays open until a real 7R capture exists.
    if product_id != KAILASH_PRODUCT_ID:
        return _write_via_template(link, schema, key, field, raw_new_value, before)

    entry_id = group_id if group_id is not None else field.fid
    off = head + 8
    entry_start = None
    entry_len = None
    while off + 2 <= len(before):
        eid, length = before[off], before[off + 1]
        off += 2
        if length == 0xFF:
            length, = struct.unpack_from("<I", before, off)
            off += 4
        if eid == entry_id:
            entry_start = off
            entry_len = length
            break
        off += length
    if entry_start is None:
        return {"ok": False, "error": f"entry 0x{entry_id:02x} ({field.path}) not in "
                                       "this watch's current settings reply"}

    if group_id is not None and entry_len != group_size:
        return {"ok": False, "error": f"{field.path}'s group entry is {entry_len} bytes, "
                                       f"expected exactly {group_size} (one record) - "
                                       "writing a multi-record group isn't supported"}

    field_off = entry_start + member_offset

    # Real, 2026-08-10 ("Kailash time-sync doesn't take effect over cable") - the real
    # working mechanism turned out to be this exact 0x1101 settings-write path, not the
    # standalone date/time commands (see set_time.py's own docstring for the full story:
    # SuuntoLink's own log shows `NspEndDevice::setSmlData` immediately preceding a real
    # `EmuDevice::setDateAndTime succeeded`, and the schema confirms
    # sml.DeviceSettings.Time.TimeISO8601, a utf8 field - the one type this function never
    # supported before, since every previously-curated field is fixed-size numeric).
    # utf8 fields are NUL-terminated and their on-wire entry_len doesn't change here (no
    # blob restructuring needed) - the new string must fit within the watch's own current
    # entry_len, NUL-padded if shorter; a real, hard error (not silent truncation) if it's
    # longer, since truncating a date/time string would write plausible-looking garbage.
    if is_text:
        if not isinstance(new_value, str):
            return {"ok": False, "error": f"{key} expects a text value"}
        previous_raw = before[field_off:field_off + entry_len].split(b"\x00", 1)[0].decode("utf8", "replace")
        encoded = new_value.encode("utf8") + b"\x00"
        if len(encoded) > entry_len:
            return {"ok": False, "error": f"{key}={new_value!r} is {len(encoded)} bytes, "
                                           f"this watch's own field is only {entry_len} bytes"}
        packed = encoded.ljust(entry_len, b"\x00")
        modified = bytearray(before)
        modified[field_off:field_off + entry_len] = packed
    else:
        previous_raw = struct.unpack_from(field.fmt, before, field_off)[0]
        packed = struct.pack(field.fmt, raw_new_value)
        modified = bytearray(before)
        modified[field_off:field_off + field.size] = packed
    link.command(CMD_SETTINGS_WRITE, bytes(modified))

    after = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
    if is_text:
        confirmed_raw = after[field_off:field_off + entry_len].split(b"\x00", 1)[0].decode("utf8", "replace") \
            if len(after) >= field_off + entry_len else None
        return {
            "ok": confirmed_raw == new_value,
            "path": field.path,
            "previous_value": previous_raw,
            "requested_value": new_value,
            "confirmed_value": confirmed_raw,
        }

    # Real bug, found 2026-08-08 while verifying this exact new field: `>` here is an
    # off-by-one - a field occupying the very last bytes of the reply (home_longitude
    # does, real payload observed 2026-08-08) has field_off + field.size == len(after)
    # exactly, so the old `>` check always treated a perfectly good, in-bounds re-read as
    # "too short" and silently reported confirmed_value=None / ok=False even though the
    # write actually succeeded - a false negative on every prior field only by luck of
    # never sitting last. Needs `>=`.
    confirmed_raw = struct.unpack_from(field.fmt, after, field_off)[0] \
        if len(after) >= field_off + field.size else None

    scale = 10 ** 7 if key in _DEGREES_X1E7_KEYS else 1
    previous = previous_raw / scale if scale != 1 else previous_raw
    confirmed = (confirmed_raw / scale if scale != 1 else confirmed_raw) \
        if confirmed_raw is not None else None

    return {
        "ok": confirmed_raw == raw_new_value,
        "path": field.path,
        "previous_value": previous,
        "requested_value": new_value,
        "confirmed_value": confirmed,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--set", metavar="KEY=VALUE",
                     help="which setting to change and to what (raw numeric value - an "
                          "enum's own integer, not its label)")
    ap.add_argument("--write", action="store_true",
                     help="actually send the write; without this, --set only shows what "
                          "would change, nothing is sent")
    ap.add_argument("--device", metavar="NAME",
                     help="same as write_nav.py's own --device - which watch to open when "
                          "more than one is connected")
    ap.add_argument("--json", action="store_true", help="print one JSON line instead of "
                     "human-readable output")
    args = ap.parse_args()

    from write_nav import resolve_product_id
    product_id = resolve_product_id(args.device) if args.device else None
    link = Link(dry_run=False, verbose=not args.json, product_id=product_id)
    if not args.json:
        print("read-only unless --set --write is given")
    link.open()

    descriptor = descriptor_for_product_id(product_id) or sbem_schema.default_descriptor()
    if not descriptor.exists():
        msg = f"missing schema descriptor: {descriptor}"
        print(json.dumps({"ok": False, "error": msg})) if args.json else print(msg)
        return 1

    table = settings_table(product_id)
    if args.set:
        key, _, raw_value = args.set.partition("=")
        if not args.write:
            payload = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
            current = read_all(payload, descriptor, product_id)
            info = current.get("settings", {}).get(key)
            msg = {"ok": True, "dry_run": True, "key": key,
                   "current": info, "would_write": raw_value}
            print(json.dumps(msg)) if args.json else print(
                f"[dry-run] {key}: current={info}, would write {raw_value!r} "
                f"(pass --write to actually send it)")
            return 0
        schema = sbem_schema.load(descriptor)
        field = _find_field(schema, table[key]) if key in table else None
        is_float = (field and field.base.startswith("float")) or key in _DEGREES_X1E7_KEYS
        # Real bug, found 2026-08-10 auditing this file against the captures: a utf8
        # field (Kailash's `device_time`, and now the Ambit3's `birth_date`) went through
        # int() here and raised ValueError before write_one()'s own text path could ever
        # run - so that path was unreachable from the CLI it was written for.
        if field is not None and field.base == "utf8":
            new_value = raw_value
        else:
            new_value = float(raw_value) if is_float else int(raw_value)
        result = write_one(link, descriptor, key, new_value, product_id)
        print(json.dumps(result)) if args.json else print(result)
        return 0 if result.get("ok") else 1

    payload = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
    result = read_all(payload, descriptor, product_id)
    if args.json:
        print(json.dumps(result))
    else:
        for key, info in result.get("settings", {}).items():
            print(f"  {key:24} {info}")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
