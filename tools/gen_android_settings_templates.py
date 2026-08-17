#!/usr/bin/env python3
"""Generate android/src/services/AmbitSettingsTemplates.ts from settings_write.py's own tables.

WHY. Android used to hardcode ONE Ambit3 entry-id table and apply it to every watch. That is
wrong: each schema family assigns its OWN entry ids (the Traverse's Personal.Weight is 0x1b,
the Ambit3's is 0x19; nearly every Traverse id is shifted from the Ambit3's). Reading a
Traverse with Ambit3 ids decodes the wrong bytes - which is exactly why the desktop derives
every id from the connected watch's own schema descriptor instead of hardcoding.

This generator does that derivation once per device, offline, and emits per-device TypeScript
tables: the field list (entry id, width, kind, choices, scaling, label, control, screen,
range) AND the per-screen write templates / enum-value sets Android's writer needs. Both apps
now render and write settings off the same source of truth (settings_write.py + the schema
descriptors), so they cannot drift.

    ./tools/gen_android_settings_templates.py            # writes the .ts
    ./tools/gen_android_settings_templates.py --check    # exit 1 if stale, write nothing
"""

import argparse
import json
import math
import os
import sys

import sbem_schema
import settings_write as S

OUT = os.path.join(os.path.dirname(__file__), "..", "android", "src", "services",
                   "AmbitSettingsTemplates.ts")

# device key -> descriptor path. Ambit3 is the reference firmware (2.4.17); Traverse is the
# real fw the connected watch runs (2.0.22); Kailash its own smaller schema.
DESCRIPTORS = {
    "ambit3":   sbem_schema.default_descriptor(),
    "traverse": sbem_schema.ASSETS / "WIndows apps" / "Suuntolink" / "descr+A30E115119001200+2.0.22",
    "kailash":  sbem_schema.ASSETS / "APK" / "kailash" / "Suunto 7R" / "Container" / "Documents"
                / "descr+79DC39510E000100+2.0.5",
}

_WIDTH = {"uint8": 1, "int8": 1, "bool": 1, "enum": 1,
          "uint16": 2, "int16": 2, "uint32": 4, "int32": 4, "float32": 4, "utf8": 1}


def resolve(schema, suffix):
    field = S._find_field(schema, suffix)
    gid = S._group_containing(schema, field.fid)
    return gid if gid is not None else field.fid


def field_meta(schema, key, suffix, product_id):
    """Everything Android's SettingField needs for one key on one device's schema, derived the
    same way read_all() derives it - just without a live value."""
    field = S._find_field(schema, suffix)
    gid = S._group_containing(schema, field.fid)
    entry_id = gid if gid is not None else field.fid
    byte_offset = S._field_offset_in_group(schema, gid, field.fid) if gid is not None else 0
    base = field.base
    desc = S.describe_field(field)

    is_kailash = product_id == S.KAILASH_PRODUCT_ID
    disp = {} if is_kailash else (S.AMBIT3_DISPLAY.get(key) or {})

    # kind
    if key in S._YEAR_KEYS:
        kind = "year"
    elif key in S._DEGREES_X1E7_KEYS:
        kind = "coord"
    elif base == "bool":
        kind = "bool"
    elif desc.get("kind") == "enum":
        kind = "enum"
    else:
        kind = "number"

    out = {"key": key, "entryId": entry_id, "byteWidth": _WIDTH.get(base, 1), "kind": kind}
    if byte_offset:
        out["byteOffset"] = byte_offset
    if base.startswith("int"):
        out["signed"] = True
    if base == "float32":
        out["float"] = True

    # scale
    scale = disp.get("scale")
    if key in S._DEGREES_FROM_RADIANS_KEYS:
        scale = math.pi / 180
    elif key in S._DEGREES_X1E7_KEYS:
        scale = 1e7
    if scale:
        out["scale"] = scale

    # choices (enum), with SuuntoLink's overrides + numeric-dropdown lists + bool-as-choice
    choices = desc.get("choices")
    if not is_kailash:
        if disp.get("bool_labels") and kind == "bool":
            out["kind"] = "enum"
            kind = "enum"
            choices = [[i, lbl] for i, lbl in enumerate(disp["bool_labels"])]
        ov = S.AMBIT3_CHOICE_LABELS.get(suffix)
        if choices and ov:
            choices = [[v, ov.get(v, lbl)] for v, lbl in choices]
        if disp.get("control") == "dropdown" and not choices:
            listed = S.AMBIT3_NUMERIC_CHOICES.get(suffix)
            if listed:
                choices = [[v, lbl] for v, lbl in listed]
    if choices:
        out["choices"] = [{"value": v, "label": lbl} for v, lbl in choices]

    # label / control / screen / unit / step (SuuntoLink presentation; Kailash stays generic)
    if disp.get("label"):
        out["label"] = disp["label"]
    if disp.get("control"):
        out["control"] = disp["control"]
    if disp.get("unit"):
        out["unit"] = disp["unit"]
    if disp.get("step"):
        out["step"] = disp["step"]
    if not is_kailash:
        screen = S.AMBIT3_KEY_TEMPLATE.get(key)
        if screen == "units_mode":
            screen = "units"
        if key == "plans_source":
            screen = None
        if screen:
            out["screen"] = screen
        rng = S._display_range(key)
        if rng is not None:
            out["min"], out["max"] = rng[0], rng[1]

    return out


def device_tables(device, product_id):
    schema = sbem_schema.load(DESCRIPTORS[device])
    table = S.KAILASH_SETTINGS if device == "kailash" else S.AMBIT3_SETTINGS
    fields = []
    for key, suffix in table.items():
        # plans_source ("Use training program") is on none of SuuntoLink's own settings screens
        # - the planned-moves source flag, set by that feature, not a user toggle. Hidden from
        # the settings UI on every device, current and future (André 2026-08-17). It stays in
        # writeTemplates/keyScreen below, so writes still carry it.
        if key == "plans_source":
            continue
        try:
            fields.append(field_meta(schema, key, suffix, product_id))
        except KeyError:
            # A key not present in this device's schema is simply skipped (missing != broken).
            continue

    if device == "kailash":
        return {"fields": fields}

    # Ambit3-family write plumbing: per-screen ordered entry ids, key->screen, enum value sets.
    screens = {}
    for name, template in S.AMBIT3_WRITE_TEMPLATES.items():
        ids = sorted({resolve(schema, suffix) for suffix in template},
                     key=lambda eid: S._entry_sort_key(schema, eid))
        screens[name] = ids
    key_screen = {key: S.AMBIT3_KEY_TEMPLATE.get(key) for key in S.AMBIT3_SETTINGS}
    enums, bools = {}, []
    for eid, field in schema.fields.items():
        values = S._enum_value_set(field)
        if values is not None:
            enums[eid] = sorted(values)
        elif field.base == "bool":
            bools.append(eid)
    return {"fields": fields, "writeTemplates": screens, "keyScreen": key_screen,
            "enumValues": enums, "boolEntries": sorted(bools)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the file is out of date")
    args = ap.parse_args()

    ambit3 = device_tables("ambit3", 0x001B)
    traverse = device_tables("traverse", 0x002B)
    kailash = device_tables("kailash", S.KAILASH_PRODUCT_ID)

    def js(obj):
        return json.dumps(obj, indent=2)

    body = f"""// GENERATED by tools/gen_android_settings_templates.py - do not edit by hand.
//
// Per-device settings tables, each derived from that watch's OWN schema descriptor through the
// desktop's settings_write.py - the same source of truth the desktop renders and writes from,
// so the two apps cannot drift. Entry ids differ per schema family (the Traverse shifts nearly
// every id off the Ambit3's), which is why these are per-device and never hardcoded once.

import type {{ SettingField }} from './AmbitSettingsReader';

/** Field tables, one per schema family. Kailash carries no write plumbing (it writes one entry
 *  at a time over 0x1201, not the Ambit3 family's per-screen 0x1101 templates). */
export const AMBIT3_FIELDS: SettingField[] = {js(ambit3["fields"])};

export const TRAVERSE_FIELDS: SettingField[] = {js(traverse["fields"])};

export const KAILASH_FIELDS: SettingField[] = {js(kailash["fields"])};

/** Entry ids each screen's write carries, in the order the watch expects - per device. */
export const WRITE_TEMPLATES: Record<string, Record<string, number[]>> = {{
  "ambit3": {js(ambit3["writeTemplates"])},
  "traverse": {js(traverse["writeTemplates"])}
}};

/** Which screen owns a setting (null = no write template, refuse the write) - per device. */
export const KEY_SCREEN: Record<string, Record<string, string | null>> = {{
  "ambit3": {js(ambit3["keyScreen"])},
  "traverse": {js(traverse["keyScreen"])}
}};

/** Legal values per enum entry id - per device (entry ids differ, so this must be too). */
export const ENUM_VALUES: Record<string, Record<number, number[]>> = {{
  "ambit3": {js(ambit3["enumValues"])},
  "traverse": {js(traverse["enumValues"])}
}};

/** Entry ids that are plain booleans (0/1 only) - per device. */
export const BOOL_ENTRIES: Record<string, number[]> = {{
  "ambit3": {js(ambit3["boolEntries"])},
  "traverse": {js(traverse["boolEntries"])}
}};

/** The seven unit fields the watch owns while units_mode is Metric or Imperial - shown but not
 *  editable then (only "Advanced" frees them), the same rule settings_write.py enforces. */
export const MODE_OWNED_UNITS: string[] = {js(list(S._MODE_OWNED_UNITS))};
"""

    path = os.path.normpath(OUT)
    if args.check:
        current = open(path).read() if os.path.exists(path) else ""
        same = current == body
        print("AmbitSettingsTemplates.ts is up to date" if same
              else "AmbitSettingsTemplates.ts is STALE - re-run without --check")
        return 0 if same else 1

    with open(path, "w") as fh:
        fh.write(body)
    print(f"wrote {os.path.relpath(path)}: ambit3={len(ambit3['fields'])} fields, "
          f"traverse={len(traverse['fields'])} fields, kailash={len(kailash['fields'])} fields")
    return 0


if __name__ == "__main__":
    sys.exit(main())
