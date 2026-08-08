#!/usr/bin/env python3
"""Installs a compiled Suunto App (workout.py's --compile output, or any entry from
SuuntoLink's bundled catalog) onto the watch: appends it into the Apps flash region, and wires
it into one exercise mode's display so it actually shows up - the writer half of
`training_program_andre.md`'s Finding 13/15 GUI -> generator -> compiler -> *install* pipeline.

DRY-RUN BY DEFAULT, same convention as every other writer in this project: without --write
nothing is emitted, only the exact bytes are logged.

**What's verified and what isn't.** The tag-level encoding is verified byte-exact against two
clean, isolated, real before/after captures (custom_modes.py --save, 2026-08-05 - see
`training_program_andre.md`'s writeup): the real tag order inside an exercise mode is
`SETTINGS, APP_META, DISPLAYS, RULES` (not append-everything-at-the-end, which was tried first
and failed); a `DISP_FIELD_SETTING`'s `Type` field set to 51 is the real sentinel for "this
field shows an app's result"; `RuleIdx` is a global, monotonically increasing counter across
the whole watch, not per-mode or per-field; and assigning an app also resets `HrHigh`/`HrLow`
to 0 and sets `IntTimerCount` to 99 as a real, reproducible side effect (confirmed identical
twice with openambit verified closed, so it isn't contamination). The Apps-region wrapper
format (`apps.py`) is verified against one real sample only - `field_a`/`field_b`/`field_c`'s
meaning isn't known, so new entries replicate that sample's values verbatim rather than guess.

**What's NOT verified**: the write mechanism itself for either region - hash mode
(`ambit_format.py`'s `HASH_WRITTEN`/`HASH_PADDED` choice for `Apps`/`CustomModes`) and whether
`CustomModes` needs a `CMD_NAV_COMMIT` afterward are both reasoned inferences (by analogy with
GpsSGEE/TrainingProgram and Routes/Waypoints respectively), not confirmed against any real
capture - no capture of a real write to either region exists; every real install seen was done
by SuuntoLink itself, never on the wire. Use `--backup-to` before a real `--write` and keep
`--restore` in mind.

    ./tools/workout_install.py compiled.json --mode 2 --display 0 --field 0 --write
    ./tools/workout_install.py --restore backup_CustomModes.bin --write

Offline planning against a real capture, no watch needed (`Link` opens no connection at all
in dry-run, so reading the watch specifically requires --write; these let you dry-run the
*planning* logic against a previously-saved dump instead):

    ./tools/workout_install.py compiled.json --mode 2 --display 0 --field 0 \\
        --from-apps dump_Apps.bin --from-custom-modes dump_CustomModes.bin
"""

import argparse
import json
import struct
import sys
import time

import apps
import ambit_format as F
import custom_modes as cm
from ambit_pcap import FlashImage
from build_route import emit_packs
from write_nav import (CMD_DEVICE_INFO, Link, check_memory_map, read_flash,
                        read_memory_map, send_plan)


def build_apps_entry(compiled, field_a=1, field_b=3, field_c=12):
    """Wraps a compiler response in the Apps-region wrapper `apps.py` decoded empirically from
    the one real install this project has seen ("Climb counter"): [u16 field_a][u16 field_b]
    [u32 field_c][u32 total_length] + a 32-byte null-padded name + the raw IAMRULE binary.
    field_a/field_b/field_c's meaning isn't known - replicated verbatim from that one real
    sample (1, 3, 12) rather than guessed, the safest available choice with a single example."""
    binary = bytes(compiled["binary"])
    name = compiled.get("name", "App").encode("iso-8859-15", "replace")[:31]
    name_field = name + b"\0" * (32 - len(name))
    total_length = 44 + len(binary)
    header = struct.pack("<HHII", field_a, field_b, field_c, total_length)
    return header + name_field + binary


def find_apps_free_offset(apps_dump):
    """Where to append a new entry: right after the true end of real data.

    NOT `apps.decode()`'s own entry arithmetic - a real 3-entry dump (2026-08-05) proved that
    wrong. Each entry's `total_length` field turned out not to be that entry's own size at
    all: it's a running watermark of *total bytes used in the whole region so far*, updated on
    every install (confirmed: the region's very first entry's `total_length` exactly equalled
    the true end of all real data). `apps.py` was only ever verified against one entry and
    trusted `total_length` as per-entry size - harmless there, actively wrong with more than
    one entry, and it caused a real out-of-bounds write. This instead finds the boundary
    directly and empirically: the last non-0xFF byte in the whole dump, independent of
    trusting any header field's meaning. Raises if the region doesn't look like a clean
    real-data/blank-padding split (defense in depth - never silently trust a weird region)."""
    last_real = len(apps_dump) - 1
    while last_real >= 0 and apps_dump[last_real] == 0xFF:
        last_real -= 1
    free_offset = last_real + 1
    tail = apps_dump[free_offset:]
    if tail.count(0xFF) != len(tail):
        raise RuntimeError(
            "Apps region doesn't look like clean real-data-then-blank-padding - "
            "refusing to guess a free offset")
    return free_offset


def _read_tag(data, offset):
    return struct.unpack_from("<HH", data, offset)


def _walk_children(data, content, end):
    """Yields (tag_id, tag_content_offset, tag_len, tag_offset) for each direct child."""
    cursor = content
    while cursor < end:
        tag_id, length = _read_tag(data, cursor)
        yield tag_id, cursor + 4, length, cursor
        cursor = cursor + 4 + length


def _find_mode(data, mode_index):
    root_id, root_len = _read_tag(data, 0)
    if root_id != cm.DEVICE_CUSTOM:
        raise ValueError(f"expected DEVICE_CUSTOM at offset 0, got 0x{root_id:x}")
    for tag_id, content, length, offset in _walk_children(data, 4, 4 + root_len):
        if tag_id == cm.EXERCISE_MODES:
            em_content, em_len, em_offset = content, length, offset
            idx = 0
            for m_id, m_content, m_len, m_offset in _walk_children(data, content, content + length):
                if m_id == cm.EXERCISE_MODES_MODE:
                    if idx == mode_index:
                        return {"em_offset": em_offset, "em_content": em_content,
                                "em_len": em_len, "mode_offset": m_offset,
                                "mode_content": m_content, "mode_len": m_len}
                    idx += 1
    raise ValueError(f"mode index {mode_index} not found")


def _find_field_setting_offset(data, mode_content, mode_len, display_index, field_index):
    mode_end = mode_content + mode_len
    for tag_id, content, length, _ in _walk_children(data, mode_content, mode_end):
        if tag_id != cm.EXERCISE_MODES_DISPLAYS:
            continue
        d_idx = 0
        for d_id, d_content, d_len, _ in _walk_children(data, content, content + length):
            if d_id != cm.EXERCISE_MODES_DISPLAY:
                continue
            if d_idx == display_index:
                f_idx = 0
                for f_id, f_content, f_len, _ in _walk_children(data, d_content, d_content + d_len):
                    if f_id != cm.EXERCISE_MODES_DISP_FIELD:
                        continue
                    if f_idx == field_index:
                        gg_id, gg_content, gg_len, _ = next(
                            _walk_children(data, f_content, f_content + f_len))
                        if gg_id != cm.EXERCISE_MODES_DISP_FIELD_SETTING:
                            raise ValueError("expected DISP_FIELD_SETTING first in DISP_FIELD")
                        return gg_content
                    f_idx += 1
            d_idx += 1
    raise ValueError(f"display {display_index} field {field_index} not found in this mode")


SPORT_MODE_APP_LIMIT = 5  # The real, manual-documented limit (3.35 Suunto Apps: "up to five
                          # Suunto Apps to each sport mode") - per MODE, not a whole-watch total.
                          # RULE_ENGINE_SLOTS (a small global slot-count model) is retired
                          # entirely as of training_program_andre.md Finding 23: it was based on
                          # custom_modes.py's FIELD_TYPES dictionary and Finding 17's now-explained
                          # "RuleIdx=3 -> app error" test, neither of which was ever a real cap.


def next_rule_idx(current_apps_bytes):
    """RuleIdx = the new entry's own 0-based position in the Apps region's physical entry
    listing - NOT a small enumerated global slot. Confirmed 2026-08-08 (Finding 23) against a
    real 11-entry Apps region cross-referenced with CustomModes: all 6 real RuleIdx assignments
    in use (0, 1, 7, 8, 9, 10) matched their app's own index in apps.decode()'s entry list
    exactly, no exceptions - e.g. the app at apps.decode()[7] is the one wired with RuleIdx=7.
    This supersedes the earlier "lowest free global slot" model entirely - RuleIdx grows with
    the whole region's install history, it doesn't reset or get reused when a low index frees
    up (that had only ever been tested with 3 entries, too few to see the real pattern)."""
    return len(apps.decode(current_apps_bytes))


def check_mode_app_limit(decoded, mode_index):
    """The real limit is per sport mode (SPORT_MODE_APP_LIMIT), not a global count. Raises
    before install_app_into_mode() would silently add a 6th app past what the manual documents
    as supported."""
    existing = len(decoded["exercise_modes"][mode_index]["Rules"])
    if existing >= SPORT_MODE_APP_LIMIT:
        raise RuntimeError(
            f"mode[{mode_index}] already has {existing} Suunto Apps assigned - the manual's "
            f"documented limit is {SPORT_MODE_APP_LIMIT} apps per sport mode")


def install_app_into_mode(custom_modes_bytes, mode_index, display_index, field_index, rule_idx):
    """Returns new CustomModes region bytes with the app wired into
    (mode_index, display_index, field_index). See module docstring for what's verified."""
    data = bytearray(custom_modes_bytes)
    loc = _find_mode(data, mode_index)
    mode_content, mode_len = loc["mode_content"], loc["mode_len"]
    mode_content_end = mode_content + mode_len

    # SETTINGS is always the first child in every real mode seen - located generically anyway.
    settings = next(c for c in _walk_children(data, mode_content, mode_content_end)
                     if c[0] == cm.EXERCISE_MODES_SETTING_NAME_LEN64)
    _, settings_content, settings_len, _ = settings
    app_meta_insert_at = settings_content + settings_len

    field_setting_offset = _find_field_setting_offset(
        data, mode_content, mode_len, display_index, field_index)
    struct.pack_into("<H", data, field_setting_offset + 2, 51)  # Type -> "shows app result"

    for name in ("HrHigh", "HrLow"):
        off = settings_content + 64 + 2 * [f for f, _ in cm.SETTING_FIELDS].index(name)
        struct.pack_into("<H", data, off, 0)
    it_off = settings_content + 64 + 2 * [f for f, _ in cm.SETTING_FIELDS].index("IntTimerCount")
    struct.pack_into("<H", data, it_off, 99)

    def tag(tag_id, content):
        return struct.pack("<HH", tag_id, len(content)) + content

    t1 = int(time.time())
    app_meta = tag(cm.EXERCISE_MODES_APP_META, struct.pack("<II", t1, t1 + 2))
    rule = tag(cm.EXERCISE_MODES_RULE, struct.pack("<HHH", rule_idx, 1, 0))
    rules = tag(cm.EXERCISE_MODES_RULES, rule)
    inserted = len(rules) + len(app_meta)

    original_size = len(data)
    tail = bytes(data[original_size - inserted:])
    if tail.count(0xFF) != len(tail):
        raise RuntimeError(
            "not enough 0xFF padding left in CustomModes to grow by "
            f"{inserted} bytes - refusing to silently discard real trailing data")

    data[mode_content_end:mode_content_end] = rules       # higher offset first
    data[app_meta_insert_at:app_meta_insert_at] = app_meta
    data = data[:original_size]

    def bump(len_offset, delta):
        old = struct.unpack_from("<H", data, len_offset)[0]
        struct.pack_into("<H", data, len_offset, old + delta)

    bump(loc["mode_offset"] + 2, inserted)
    bump(loc["em_offset"] + 2, inserted)
    bump(2, inserted)  # DEVICE_CUSTOM
    return bytes(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("compiled", nargs="?", help="a workout.py --compile --out JSON file")
    ap.add_argument("--mode", type=int, help="EXERCISE_MODES_MODE index to install into"
                     " (see custom_modes.py's printed order)")
    ap.add_argument("--display", type=int, help="which of that mode's displays (0-based)")
    ap.add_argument("--field", type=int, help="which field on that display (0-based, 0=top)")
    ap.add_argument("--write", action="store_true",
                     help="actually emits; without this option nothing is sent")
    ap.add_argument("--backup-to", metavar="FILE",
                     help="save the current CustomModes region here before writing")
    ap.add_argument("--restore", metavar="FILE",
                     help="write a raw CustomModes dump back verbatim (e.g. a --backup-to"
                          " file) instead of installing an app")
    ap.add_argument("--from-apps", metavar="FILE",
                     help="use this raw Apps dump instead of reading the watch (offline"
                          " testing - a real connection can't be read from without --write)")
    ap.add_argument("--from-custom-modes", metavar="FILE",
                     help="use this raw CustomModes dump instead of reading the watch")
    ap.add_argument("--apps-only", action="store_true",
                     help="append to the Apps region only - skip CustomModes entirely (e.g."
                          " when it's already correctly wired from a previous run)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not args.restore and args.compiled is None:
        ap.error("either --restore FILE, or a compiled JSON")
    if not args.restore and not args.apps_only and (
            args.mode is None or args.display is None or args.field is None):
        ap.error("--mode/--display/--field are required unless --apps-only or --restore")

    link = Link(dry_run=not args.write, verbose=args.verbose)
    if args.write:
        print("!! REAL WRITE requested")
        link.open()
    else:
        print("dry-run mode: not a byte will be emitted")

    link.command(CMD_DEVICE_INFO, b"\x02\x48\x03\x00")
    check_memory_map(read_memory_map(link))

    if args.restore:
        with open(args.restore, "rb") as f:
            new_custom_modes = f.read()
        if len(new_custom_modes) != F.CUSTOM_MODES_REGION_SIZE:
            sys.exit(f"'{args.restore}' is {len(new_custom_modes)} bytes, expected "
                     f"{F.CUSTOM_MODES_REGION_SIZE}")
        flash = FlashImage()
        flash.write(F.CUSTOM_MODES_BASE, new_custom_modes)
        layout = [("CustomModes", F.CUSTOM_MODES_BASE, new_custom_modes),
                  ("tail", F.CUSTOM_MODES_BASE, None)]
        send_plan(link, flash, layout, commit=True)
        print(f"\n{'wrote' if args.write else 'would write'} {len(new_custom_modes)} bytes"
              " to CustomModes (restore)")
        return 0

    with open(args.compiled) as f:
        compiled = json.load(f)

    if args.from_apps:
        with open(args.from_apps, "rb") as f:
            current_apps = f.read()
    elif not link.dry_run:
        current_apps = read_flash(link, F.APPS_BASE, F.APPS_REGION_SIZE, label="Apps")
    else:
        ap.error("reading the watch needs --write (Link opens no connection in dry-run) - "
                 "pass --from-apps for an offline plan against a real capture instead")

    current_custom_modes = None
    if not args.apps_only:
        if args.from_custom_modes:
            with open(args.from_custom_modes, "rb") as f:
                current_custom_modes = f.read()
        elif not link.dry_run:
            current_custom_modes = read_flash(
                link, F.CUSTOM_MODES_BASE, F.CUSTOM_MODES_REGION_SIZE, label="CustomModes")
        else:
            ap.error("reading the watch needs --write (Link opens no connection in dry-run) - "
                     "pass --from-custom-modes for an offline plan against a real capture"
                     " instead")

        if args.backup_to:
            with open(args.backup_to, "wb") as f:
                f.write(current_custom_modes)
            print(f"backed up current CustomModes to {args.backup_to}")

    apps_offset = find_apps_free_offset(current_apps)
    entry = build_apps_entry(compiled)
    if apps_offset + len(entry) > F.APPS_REGION_SIZE:
        sys.exit(f"refusing to write: offset 0x{apps_offset:x} + {len(entry)} bytes would "
                 f"land past the end of the {F.APPS_REGION_SIZE}-byte Apps region")
    print(f"Apps entry: {len(entry)} bytes at offset 0x{apps_offset:x}"
          f" (name={compiled.get('name')!r})")

    flash = FlashImage()
    flash.write(F.APPS_BASE, entry)
    apps_layout = [("Apps entry", F.APPS_BASE + apps_offset, entry),
                   ("tail", F.APPS_BASE, None)]

    if args.apps_only:
        print("--apps-only: leaving CustomModes untouched")
        send_plan(link, flash, apps_layout, commit=False)
    else:
        decoded_modes = cm.decode(current_custom_modes)
        check_mode_app_limit(decoded_modes, args.mode)
        rule_idx = next_rule_idx(current_apps)
        mode_name = decoded_modes["exercise_modes"][args.mode]["Settings"]["Name"]
        print(f"CustomModes: mode[{args.mode}]={mode_name!r} display[{args.display}]"
              f" field[{args.field}] -> RuleIdx={rule_idx}")

        new_custom_modes = install_app_into_mode(
            current_custom_modes, args.mode, args.display, args.field, rule_idx)

        flash2 = FlashImage()
        flash2.write(F.CUSTOM_MODES_BASE, new_custom_modes)
        cm_layout = [("CustomModes", F.CUSTOM_MODES_BASE, new_custom_modes),
                     ("tail", F.CUSTOM_MODES_BASE, None)]

        # write the app itself first, then wire it in - so a failure partway through never
        # leaves CustomModes pointing at an app that isn't actually there
        send_plan(link, flash, apps_layout, commit=False)
        send_plan(link, flash2, cm_layout, commit=True)

    total = sum(len(payload) for _, payload, _ in link.sent)
    print(f"\n{len(link.sent)} messages, {total} payload bytes"
          + ("" if args.write else " — nothing was emitted"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
