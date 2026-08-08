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
    "gps_position_format": "GpsPositionFormat",
    "compass_declination": "Compass.Declination",
    "button_lock_time_mode": "ButtonLock.TimeMode",
    "button_lock_sport_mode": "ButtonLock.SportMode",
    "tones": "Audio.Mode",
    "display_contrast": "Display.Contrast",
    "display_dark": "Display.Invert",  # confirmed live, 2026-08-08 - see docstring
    "backlight_mode": "Display.Backlight.Mode",
    "backlight_brightness": "Display.Backlight.Brightness",
    "storm_alarm": "AltiBaro.StormAlarm",
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
}

# Real MOD conversion straight from the schema descriptor for these two fields
# (`PI*x/(10^7*180)` - radians for on-device math; dividing by 1e7 alone gives plain
# decimal degrees, the useful value for a human/UI). Not applied generically - no other
# curated field here has a <MOD> tag yet - just named explicitly for these two.
_DEGREES_X1E7_KEYS = {"home_latitude", "home_longitude"}


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


def describe_field(field):
    """JSON-friendly shape for a UI: {"kind": "enum", "choices": [[0, "Light"], ...]} or
    {"kind": "bool"} or {"kind": "number", "min":..., "max":...}."""
    m = _ENUM_RE.match(field.frm)
    if m:
        choices = []
        for part in m.group(1).split(","):
            value_str, _, label = part.partition("=")
            choices.append([int(value_str), label])
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
        out[key] = {"ok": True, "value": value, "path": field.path, **desc}
    return {"ok": True, "settings": out}


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
    if field.base == "utf8":
        return {"ok": False, "error": f"{key} is a text field - not supported by this tool"}

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

    previous_raw = struct.unpack_from(field.fmt, before, field_off)[0]

    packed = struct.pack(field.fmt, raw_new_value)
    modified = bytearray(before)
    modified[field_off:field_off + field.size] = packed
    link.command(CMD_SETTINGS_WRITE, bytes(modified))

    after = link.command(CMD_SETTINGS_READ, b"\0\0\0\0")
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
