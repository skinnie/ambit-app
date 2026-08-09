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
twice with openambit verified closed, so it isn't contamination).

**2026-08-08 (training_program_andre.md Finding 25): the Apps-region format is now SOLVED**,
from 4 real USBPcap captures of SuuntoLink actually installing apps (`assets/ambit3 pcap/v2/`)
plus a real live 11-entry region - see `apps.py`'s module docstring for the full derivation.
The whole region is a self-describing directory (`[u16 num_entries][u16 unknown2][u32
entry_offset]*N[u32 total_length]`, then fixed 32-byte `[header 3B][name 29B]` blocks + magic +
binary per entry) that gets **entirely rewritten** on every single install, not appended to -
this project's own writer used to append one raw entry with a guessed 12-byte header and no
directory at all, which is almost certainly the real cause of the "app error" chased across
Findings 16-19 (a structurally wrong format, not a wrong constant in an otherwise-right one).
Rewritten below to build the real directory + all existing entries + the new one, every time.
One field remains genuinely unknown: the per-entry `marker` byte - consistent for a given app
across every real capture checked, but its rule isn't determined, so new entries here use `0`
as a placeholder rather than a guess with false confidence.

**Apps region hash mode now confirmed too**: computed SHA256 over just the real written bytes
of the `appstopscreensunrisunset` capture (4300 bytes) matches the real captured `0x0b18` tail
hash exactly - `HASH_WRITTEN` (hash of only the written bytes, not the whole padded region) was
already what `ambit_format.py` assumed, now independently confirmed rather than reasoned by
analogy.

**Still NOT verified**: whether `CustomModes` needs a `CMD_NAV_COMMIT` afterward - still a
reasoned inference by analogy with Routes/Waypoints, not confirmed against these Apps captures
(that's a CustomModes question, not an Apps one). Use `--backup-to` before a real `--write` and
keep `--restore` in mind.

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


def build_apps_region(existing_entries, compiled):
    """Builds a full Apps-region write: the real directory format (apps.py's module
    docstring, Finding 25) - `[u16 num_entries][u16 count^0x02][u32 entry_offset]*N
    [u32 total_length]`, then one `[3-byte header][29-byte name]` block + magic + binary per
    entry, back to back. Confirmed the whole region is rewritten (directory + every existing
    entry) on every real install, not appended to - `existing_entries` should be
    `apps.decode(current_apps_bytes)` of what's there now, and the new one is always placed
    last (matching every real capture checked: new entries append to the end of the list, not
    inserted).

    Both formerly-unknown fields are now SOLVED (2026-08-09, Finding 29, via openambit's
    serialize_app_data prior art + verification against all 26 real entries this project has):
    - the header's second u16 is `num_entries ^ 0x02`, not an opaque value.
    - the per-entry `marker` byte is `apps.entry_checksum(binary)` (XOR of MAGIC+binary ^ len),
      no longer a guess left at 0.
    `activityId` is read from `compiled` (falls back to 0) - confirmed to match the app's real
    catalog activityId in every sample.

    Real edge case guarded against here that a real client apparently doesn't guard against
    (found live, Finding 25): a name over apps.NAME_LEN (29) bytes wouldn't leave room for its
    own null terminator and would run into the next field - truncated here instead."""
    binary = bytes(compiled["binary"])
    activity_id = compiled.get("activityId", 0) & 0xFF
    marker = apps.entry_checksum(binary)
    name = compiled.get("name", "App").encode("iso-8859-15", "replace")[:apps.NAME_LEN - 1]
    name_field = name + b"\0" * (apps.NAME_LEN - len(name))
    new_entry_bytes = (bytes([0, activity_id, marker]) + name_field
                       + apps.MAGIC + binary)

    all_bytes = [e["_raw_block"] for e in existing_entries] + [new_entry_bytes]
    num_entries = len(all_bytes)
    table_len = 4 + 4 * (num_entries + 1)

    offsets = []
    cursor = table_len
    for block in all_bytes:
        offsets.append(cursor)
        cursor += len(block)
    total_length = cursor

    header = struct.pack("<HH", num_entries, num_entries ^ 0x02) + struct.pack(
        f"<{num_entries + 1}I", *offsets, total_length)
    return header + b"".join(all_bytes)


def apps_entries_with_raw_blocks(apps_dump):
    """apps.decode() plus each entry's own raw bytes (header+name+magic+binary), needed to
    reassemble existing entries verbatim into a fresh build_apps_region() call without
    re-deriving marker/activityId by hand."""
    entries = apps.decode(apps_dump)
    for e in entries:
        start = e["entry_offset"]
        end = e["magic_offset"] + len(apps.MAGIC) + len(e["binary"])
        e["_raw_block"] = apps_dump[start:end]
    return entries


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


# Real, distinct field Types - confirmed 2026-08-08 (training_program_andre.md Finding 26)
# from a real bug: FT_RULE_ENGINE_0/1/2 (custom_modes.py's own FIELD_TYPE_LABELS: "Suunto App
# Slot 1/2/3"), not one single "51 means app result" sentinel. A first live test hardcoded 51
# for every field regardless of how many slots a mode already used, producing two duplicate
# "Slot 1" fields on Walk instead of Slot 1 + Slot 2 - caught by checking the field labels
# before asking for a second physical watch check. This is DISTINCT from
# SPORT_MODE_APP_LIMIT/5: a mode can have up to 5 apps *assigned* (real Apps-region entries,
# real RULES tags) but only up to 3 of them can ever be *visible* on a display field, because
# only 3 slot Types exist at all - matches a real observation on hardware this session
# (Trekking has 1 real assigned rule with zero fields of any of these 3 Types anywhere in its
# 11 displays - installed-but-not-shown is a real, normal state, not a bug).
APP_SLOT_TYPES = (51, 52, 53)  # FT_RULE_ENGINE_0, _1, _2 in that fixed order


def _used_app_slot_types(data, mode_content, mode_len):
    """Which of APP_SLOT_TYPES are already wired to a display field somewhere in this mode."""
    used = set()
    mode_end = mode_content + mode_len
    for tag_id, content, length, _ in _walk_children(data, mode_content, mode_end):
        if tag_id != cm.EXERCISE_MODES_DISPLAYS:
            continue
        for d_id, d_content, d_len, _ in _walk_children(data, content, content + length):
            if d_id != cm.EXERCISE_MODES_DISPLAY:
                continue
            for f_id, f_content, f_len, _ in _walk_children(data, d_content, d_content + d_len):
                if f_id != cm.EXERCISE_MODES_DISP_FIELD:
                    continue
                gg_id, gg_content, _, _ = next(_walk_children(data, f_content, f_content + f_len))
                if gg_id == cm.EXERCISE_MODES_DISP_FIELD_SETTING:
                    typ = struct.unpack_from("<H", data, gg_content + 2)[0]
                    if typ in APP_SLOT_TYPES:
                        used.add(typ)
    return used


def next_app_slot_type(data, mode_content, mode_len):
    """The next free FT_RULE_ENGINE_N Type for this mode - Slot 1 (51) if none are used yet,
    Slot 2 (52) if only Slot 1 is taken, etc. Raises once all 3 are used - there's no 4th slot
    Type to fall back to, regardless of SPORT_MODE_APP_LIMIT."""
    used = _used_app_slot_types(data, mode_content, mode_len)
    for slot_type in APP_SLOT_TYPES:
        if slot_type not in used:
            return slot_type
    raise RuntimeError(
        f"this mode already has all {len(APP_SLOT_TYPES)} Suunto App display slots in use "
        f"(Types {APP_SLOT_TYPES}) - no free slot Type to wire a new field to, even though "
        "more apps could still be assigned (see SPORT_MODE_APP_LIMIT)")


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

    slot_type = next_app_slot_type(data, mode_content, mode_len)
    field_setting_offset = _find_field_setting_offset(
        data, mode_content, mode_len, display_index, field_index)
    struct.pack_into("<H", data, field_setting_offset + 2, slot_type)

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
    ap.add_argument("--json", action="store_true",
                     help="print one final JSON line summarizing the result - for"
                          " backend/server.py. Human-readable progress lines still print"
                          " before it (server.py's own \"last JSON-parseable line\""
                          " convention, same as every other tool here)")
    args = ap.parse_args()

    if not args.restore and args.compiled is None:
        ap.error("either --restore FILE, or a compiled JSON")
    if not args.restore and not args.apps_only and (
            args.mode is None or args.display is None or args.field is None):
        ap.error("--mode/--display/--field are required unless --apps-only or --restore")

    # Real, 2026-08-09: considered changing this to match settings_write.py's own pattern
    # (Link opened for real unconditionally, only the actual write call gated on --write) so
    # a backend caller could get a real live-watch rehearsal without --write. Backed out -
    # this file's own CMD_DEVICE_INFO/memory-map check and its --restore/--from-apps/
    # --from-custom-modes offline paths all currently depend on dry_run's existing "no real
    # device touched at all" meaning in ways that would need real hardware to verify safely
    # for every flag combination, not something to change blind on real flash-write code.
    # Left as the original author had it - see backend/server.py's own _handle_apps_install
    # for how the rehearsal problem is solved instead (never calling this tool at all until
    # confirm:true, building the preview from already-safe read-only endpoints instead).
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
        # Write ONLY the used BXML extent, not the full padded region, and no 0x0b04
        # (Finding 28): this is exactly what real SuuntoLink does and what the watch's cold-
        # boot hash validation expects. Writing the full region produced a wrong hash and
        # 'err:62' on every mode after a restart.
        extent = cm.used_extent(new_custom_modes)
        payload = new_custom_modes[:extent]
        flash = FlashImage()
        flash.write(F.CUSTOM_MODES_BASE, payload)
        layout = [("CustomModes", F.CUSTOM_MODES_BASE, payload),
                  ("tail", F.CUSTOM_MODES_BASE, None)]
        send_plan(link, flash, layout, commit=False)
        print(f"\n{'wrote' if args.write else 'would write'} {extent} used bytes"
              f" (of {len(new_custom_modes)}) to CustomModes (restore)")
        return 0

    with open(args.compiled) as f:
        compiled = json.load(f)

    if args.from_apps:
        with open(args.from_apps, "rb") as f:
            current_apps = f.read()
    elif not link.dry_run:
        # Real, 2026-08-09: apps.read_apps_region()'s own probe-first fast path (the
        # region's real directory has an exact total_length boundary - see that
        # function's own docstring), not a blind full-200,000-byte read.
        current_apps = apps.read_apps_region(link)
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

    existing_apps_entries = apps_entries_with_raw_blocks(current_apps)
    new_region = build_apps_region(existing_apps_entries, compiled)
    if len(new_region) > F.APPS_REGION_SIZE:
        sys.exit(f"refusing to write: the rebuilt Apps region would be {len(new_region)} "
                 f"bytes, past the end of the {F.APPS_REGION_SIZE}-byte Apps region")
    print(f"Apps region: {len(existing_apps_entries)} existing entr"
          f"{'y' if len(existing_apps_entries) == 1 else 'ies'} + 1 new "
          f"(name={compiled.get('name')!r}) = {len(new_region)} bytes total")

    flash = FlashImage()
    flash.write(F.APPS_BASE, new_region)
    apps_layout = [("Apps region", F.APPS_BASE, new_region),
                   ("tail", F.APPS_BASE, None)]

    rule_idx = mode_name = None
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

        # Write ONLY the used BXML extent (Finding 28) - see custom_modes.used_extent(). The
        # full-region write was the confirmed cause of 'err:62' on every mode after a restart.
        cm_extent = cm.used_extent(new_custom_modes)
        cm_payload = new_custom_modes[:cm_extent]
        flash2 = FlashImage()
        flash2.write(F.CUSTOM_MODES_BASE, cm_payload)
        cm_layout = [("CustomModes", F.CUSTOM_MODES_BASE, cm_payload),
                     ("tail", F.CUSTOM_MODES_BASE, None)]

        # write the app itself first, then wire it in - so a failure partway through never
        # leaves CustomModes pointing at an app that isn't actually there.
        # commit=False for BOTH (no CMD_NAV_COMMIT / 0x0b04): confirmed 2026-08-09
        # (training_program_andre.md Finding 27) against all 4 real SuuntoLink app-install
        # captures in assets/ambit3 pcap/v2/ - not one of them EVER sends 0x0b04 for the
        # Apps or CustomModes regions. 0x0b04 is specifically the *navigation database*
        # commit (routes/waypoints); firing it after an Apps/CustomModes write was this
        # project's own addition, and is the single command we sent that real SuuntoLink
        # never does. The real per-region finalization is the 0x0b18 tail itself (a SHA256
        # of the written span, verified byte-exact against every real tail). Sending the
        # spurious nav-commit is the strongest suspect for the "connect to Moveslink" /
        # needs-restart / clock-reset state seen on real hardware after installs.
        send_plan(link, flash, apps_layout, commit=False)
        send_plan(link, flash2, cm_layout, commit=False)

    total = sum(len(payload) for _, payload, _ in link.sent)
    print(f"\n{len(link.sent)} messages, {total} payload bytes"
          + ("" if args.write else " — nothing was emitted"))

    if args.json:
        print(json.dumps({
            "ok": True, "written": bool(args.write), "ruleIdx": rule_idx,
            "modeName": mode_name, "name": compiled.get("name"),
            "messages": len(link.sent), "payloadBytes": total,
        }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
