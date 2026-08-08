#!/usr/bin/env python3
"""Real-hardware test: changes which data an existing display row shows - the `Index`
half of one `EXERCISE_MODES_DISP_FIELD_SETTING` leaf (a fixed 4-byte `[u16 Index][u16
Type]`, per custom_modes.py's own decode_disp_field()). Same real transport and same
"never assume, always re-derive the offset live" discipline as
custom_modes_rename_test.py/custom_modes_field_write_test.py: the field's real byte offset
is found by walking the actual tag tree (DEVICE_CUSTOM -> EXERCISE_MODES ->
EXERCISE_MODES_MODE -> EXERCISE_MODES_DISPLAYS -> EXERCISE_MODES_DISPLAY ->
EXERCISE_MODES_DISP_FIELD -> EXERCISE_MODES_DISP_FIELD_SETTING), addressed by (mode name,
display index, field index within that display) - never a hardcoded region offset.

**Scope**: only the `Index` value changes (which FIELD_TYPES entry is shown - e.g.
FT_HEART_RATE_CURR). `Type` (a format/subtype selector custom_modes.py's own docstring
already flags as not fully pinned down) and every other byte in the region are left
untouched. Fixed-width leaf, so this is a same-width in-place substitution - no BXml tag
length changes, same risk class as the earlier confirmed rename/field-value writes, not
the harder "add/remove a row" class of edit.

    ./tools/custom_modes_display_field_write_test.py --mode Walk --display 0 --field 1 --to FT_HEART_RATE_CURR
    ./tools/custom_modes_display_field_write_test.py --mode Walk --display 0 --field 1 --to FT_HEART_RATE_CURR --write
"""
import argparse
import datetime
import pathlib
import struct
import sys

import ambit_format as F
import custom_modes as CM
from ambit_pcap import FlashImage
from write_nav import Link, check_memory_map, read_flash, read_memory_map, send_plan

BACKUP_DIR = pathlib.Path.home() / "AmbitAppBackups" / "custom_modes"
NAME_TO_INDEX = {v: k for k, v in CM.FIELD_TYPES.items()}


def find_field_setting_offset(data, mode_name, display_index, field_index):
    """Real content offset of the DISP_FIELD_SETTING leaf at
    (mode_name, display_index, field_index) - walked live from the actual tag tree, the
    same structural approach custom_modes_rename_test.py/custom_modes_field_write_test.py
    already use. Returns (offset, current_index, current_type) or None if not found."""
    root = CM.read_tag(data, 0)
    if root is None or root[0] != CM.DEVICE_CUSTOM:
        raise ValueError(f"expected DEVICE_CUSTOM at offset 0, got {root}")
    _, root_len = root
    cursor, end = 4, 4 + root_len

    while cursor < end:
        tag = CM.read_tag(data, cursor)
        if tag is None:
            break
        tag_id, length = tag
        content = cursor + 4
        if tag_id != CM.EXERCISE_MODES:
            cursor = content + length
            continue

        sub_end, sub_cursor = content + length, content
        while sub_cursor < sub_end:
            sub_tag = CM.read_tag(data, sub_cursor)
            if sub_tag is None:
                break
            sub_id, sub_len = sub_tag
            sub_content = sub_cursor + 4
            if sub_id == CM.EXERCISE_MODES_MODE:
                name_tag = CM.read_tag(data, sub_content)
                if name_tag and name_tag[0] == CM.EXERCISE_MODES_SETTING_NAME_LEN64:
                    name = data[sub_content + 4:sub_content + 4 + 64].rstrip(b"\0").decode(
                        "iso-8859-15", "replace")
                    if name == mode_name:
                        return _find_in_mode(data, sub_content, sub_len, display_index, field_index)
            sub_cursor = sub_content + sub_len
        cursor = content + length
    return None


def _find_in_mode(data, offset, length, display_index, field_index):
    end = offset + length
    cursor = offset
    while cursor < end:
        tag = CM.read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == CM.EXERCISE_MODES_DISPLAYS:
            return _find_in_displays(data, content, tag_len, display_index, field_index)
        cursor = content + tag_len
    return None


def _find_in_displays(data, offset, length, display_index, field_index):
    end = offset + length
    cursor = offset
    idx = 0
    while cursor < end:
        tag = CM.read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if idx == display_index:
            return _find_in_display_fields(data, content, tag_len, field_index)
        idx += 1
        cursor = content + tag_len
    return None


def _find_in_display_fields(data, offset, length, field_index):
    end = offset + length
    cursor = offset
    idx = 0
    while cursor < end:
        tag = CM.read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == CM.EXERCISE_MODES_DISP_FIELD:
            if idx == field_index:
                setting_tag = CM.read_tag(data, content)
                if setting_tag and setting_tag[0] == CM.EXERCISE_MODES_DISP_FIELD_SETTING:
                    setting_content = content + 4
                    cur_idx, cur_typ = struct.unpack_from("<HH", data, setting_content)
                    return setting_content, cur_idx, cur_typ
                return None
            idx += 1
        cursor = content + tag_len
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", required=True, metavar="NAME")
    ap.add_argument("--display", required=True, type=int, metavar="N",
                     help="0-based display/screen index within this mode")
    ap.add_argument("--field", required=True, type=int, metavar="N",
                     help="0-based field/row index within that display (0=top, 1=middle, 2=bottom)")
    ap.add_argument("--to", metavar="FIELD_TYPE",
                     help="new Index value: a FIELD_TYPES name (e.g. FT_HEART_RATE_CURR) or "
                          "a raw 0xNNNN value. Real, live-confirmed 2026-08-08: Index alone "
                          "does NOT select what's rendered for every display slot - see "
                          "--type below and this file's own docstring update. Omit to leave "
                          "Index unchanged.")
    ap.add_argument("--type", dest="new_type", metavar="FIELD_TYPE_OR_INT",
                     help="new Type value - a FIELD_TYPES name or raw int. Real finding, "
                          "2026-08-08: for at least the common Index=FT_TIME 'numeric value "
                          "slot' case, Type (not Index) is what actually selects the "
                          "rendered content - confirmed by cross-referencing a real, "
                          "user-confirmed-working HR field (Type=21=0x15=FT_HEART_RATE_CURR "
                          "exactly) against custom_modes.py's own FIELD_TYPES table. Omit "
                          "to leave Type unchanged.")
    ap.add_argument("--write", action="store_true",
                     help="actually write; without this, only reads, locates the field, "
                          "and reports what would change")
    args = ap.parse_args()

    if args.to is None and args.new_type is None:
        print("ABORT: give --to and/or --type - nothing to change otherwise.")
        return 1

    def resolve(raw):
        if raw in NAME_TO_INDEX:
            return NAME_TO_INDEX[raw]
        try:
            return int(raw, 0)
        except ValueError:
            print(f"ABORT: {raw!r} is not a known FIELD_TYPES name and not a valid "
                  f"integer. Known names: {sorted(NAME_TO_INDEX)}")
            raise SystemExit(1)

    new_index = resolve(args.to) if args.to is not None else None
    new_type = resolve(args.new_type) if args.new_type is not None else None

    link = Link(dry_run=False, verbose=False)
    link.open()

    print("Checking memory map before touching anything...")
    found = read_memory_map(link)
    if not check_memory_map(found):
        print("ABORT: memory map does not match expectations, refusing to write.")
        return 1

    print("Reading CustomModes...")
    fresh = read_flash(link, F.CUSTOM_MODES_BASE, F.CUSTOM_MODES_REGION_SIZE, label="CustomModes")

    located = find_field_setting_offset(fresh, args.mode, args.display, args.field)
    if located is None:
        print(f"ABORT: {args.mode!r} display {args.display} field {args.field} not found "
              f"in the real parsed tree.")
        return 1
    offset, cur_idx, cur_typ = located
    cur_idx_name = CM.FIELD_TYPES.get(cur_idx, f"0x{cur_idx:04x}")
    cur_typ_name = CM.FIELD_TYPES.get(cur_typ, f"0x{cur_typ:04x}")
    final_index = new_index if new_index is not None else cur_idx
    final_type = new_type if new_type is not None else cur_typ
    final_idx_name = CM.FIELD_TYPES.get(final_index, f"0x{final_index:04x}")
    final_typ_name = CM.FIELD_TYPES.get(final_type, f"0x{final_type:04x}")
    print(f"Found {args.mode!r} display {args.display} field {args.field} at region "
          f"offset {offset} (0x{offset:x}): Index={cur_idx} ({cur_idx_name}), "
          f"Type={cur_typ} ({cur_typ_name})")
    print(f"Would change to: Index={final_index} ({final_idx_name}), "
          f"Type={final_type} ({final_typ_name})")

    if not args.write:
        print("Read-only (pass --write to actually send this).")
        return 0

    modified = bytearray(fresh)
    struct.pack_into("<HH", modified, offset, final_index, final_type)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    backup_path = BACKUP_DIR / f"before_dispfield_{stamp}.bin"
    backup_path.write_bytes(fresh)
    print(f"Backup written to {backup_path}")

    flash = FlashImage()
    flash.write(F.CUSTOM_MODES_BASE, bytes(modified))
    layout = [(f"CustomModes ({args.mode} display{args.display} field{args.field} -> "
               f"Index={final_idx_name} Type={final_typ_name})",
               F.CUSTOM_MODES_BASE, bytes(modified)),
              ("tail", F.CUSTOM_MODES_BASE, None)]

    print("Writing modified content + CMD_DATA_TAIL (padded-region SHA256) + CMD_NAV_COMMIT...")
    send_plan(link, flash, layout, commit=True)
    print("  send_plan returned without raising - no protocol-level rejection seen")

    print("Reading CustomModes back to verify...")
    after = read_flash(link, F.CUSTOM_MODES_BASE, F.CUSTOM_MODES_REGION_SIZE, label="CustomModes")

    if bytes(after) == bytes(modified):
        print(f"\nSUCCESS: region read back byte-for-byte matching the intended edit.")
        print(f"  {args.mode} display {args.display} field {args.field} is now "
              f"Index={final_idx_name} Type={final_typ_name}")
        return 0
    else:
        diffs = sum(1 for a, b in zip(after, modified) if a != b)
        print(f"\nMISMATCH: {diffs} bytes differ from what was intended.")
        mismatch_path = BACKUP_DIR / f"after_dispfield_{stamp}.bin"
        mismatch_path.write_bytes(after)
        print(f"Post-write state saved to {mismatch_path} for inspection. "
              f"Restore from {backup_path} if needed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
