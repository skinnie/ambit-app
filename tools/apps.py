#!/usr/bin/env python3
"""Decodes the Ambit3 "Apps" flash region - where a Suunto App's compiled bytecode gets
written once assigned to a sport mode's display via SuuntoLink. Confirmed live, 2026-08-05,
after installing "Climb counter" (ruleId 32) onto Cycling: the same event also populates
CustomModes' EXERCISE_MODES_RULES/EXERCISE_MODES_APP_META tags - see custom_modes.py and
custom_modes_andre.md for that side of it.

Unlike everything else this project has reverse-engineered, this wrapper format was NOT found
in any decompiled asset - grepped for "IAMRULE" across every .c decompile and every .exe/.dll/
.so in assets/, zero hits. It's derived purely empirically, from one real installed app,
by comparing the watch's actual flash bytes against SuuntoLink's own bundled catalog
(suunto-apps/index.json, 13,104 pre-compiled apps bundled offline - no Movescount account
needed). Confirmed byte-for-byte: the watch's on-flash blob position [44:] matches catalog
entry ruleId=32's "binary" field exactly, and the u32 at offset 8 equals 44 + that blob's
length exactly, for that one entry.

**Correction, 2026-08-05, from a real 3-entry region**: `total_length` is NOT that entry's own
size - it's a running watermark of total bytes used in the *whole* region so far, updated on
every install (confirmed: the region's first entry's `total_length` exactly equalled the true
end of all real data once two more apps had been added after it). Harmless with one entry
(where "this entry's size" and "total used so far" are the same number), actively wrong with
more than one - and this project trusted it blindly once, in `workout_install.py`, causing a
real out-of-bounds flash write (see `training_program_andre.md`). That code now finds the
region's free offset by scanning for the true end of real data directly, not through this
decoder. Per-entry boundaries in a multi-app region (where one entry's bytecode actually ends
and the next one's header begins) are NOT reliably determined by this decoder - flagged below
rather than guessed at a second time from three examples that aren't enough to pin the real
rule down. `decode()` still reports each entry it finds and its name (both confirmed reliable
across all three real entries), just not a trustworthy individual `binary`/`total_length` once
more than one entry is present.

**2026-08-08 (training_program_andre.md Finding 22), from a real 6-entry region**: the "44 bytes
back from magic" header this module assumes is confirmed WRONG for real SuuntoLink-installed
entries - it only happens to produce sane field_a/field_b/field_c/total_length for an entry this
project's own `workout_install.py` wrote itself (self-consistent, not independent evidence). Real
entries instead have, immediately before the name: a 1-byte marker (undecoded) preceded by a
2-byte value matching the app's real `activityId`, and further back what looks like
floating-point data that differs between two installs of the *same* binary (per-mode config?,
undecoded). `build_apps_entry()` in `workout_install.py` doesn't emit any of this - a more likely
cause of the standing "app error" than anything guessed at previously. Not yet fixed here.

    ./tools/apps.py --from /tmp/dump_Apps.bin --catalog ".../suunto-apps/index.json"
"""

import argparse
import json
import struct

APPS_BASE = 0x0927C0
APPS_SIZE = 200000  # confirmed live via 0x0b21, 2026-08-05

MAGIC = b"IAMRULE\x00"
HEADER_LEN = 12  # [u16][u16][u32][u32 total_length]
NAME_LEN = 32  # null-padded, observed exactly filling offset 12..44
PREAMBLE_LEN = HEADER_LEN + NAME_LEN  # 44: everything before the IAMRULE blob itself


def _find_all_magic(data):
    offsets = []
    idx = data.find(MAGIC)
    while idx != -1:
        offsets.append(idx)
        idx = data.find(MAGIC, idx + len(MAGIC))
    return offsets


def _real_data_end(data):
    """The true end of all real (non-0xFF) content, scanned directly - independent of
    trusting any header field. See the module docstring's 2026-08-05 correction."""
    end = len(data)
    while end > 0 and data[end - 1] == 0xFF:
        end -= 1
    return end


def _name_before(data, magic_offset):
    """The name is a variable-length, null-padded string immediately before the IAMRULE
    magic - NOT reliably at a fixed PREAMBLE_LEN offset once more than one entry is packed
    into the region (confirmed 2026-08-05: the gap between header and magic differs per
    entry). Found directly instead: walk back through the null padding, then back through
    the printable name itself. Verified clean against all three real entries in a packed
    region ("R-Climb counter"/"Current incline"/"Downhill Stats"), unlike the fixed-offset
    slice, which picks up a stray byte or two of whatever precedes the name for entries
    after the first."""
    j = magic_offset - 1
    while j >= 0 and data[j] == 0:
        j -= 1
    name_end = j + 1
    k = j
    while k >= 0 and 32 <= data[k] < 127:
        k -= 1
    name_start = k + 1
    return data[name_start:name_end].decode("iso-8859-15", "replace")


def decode(data):
    """Finds every IAMRULE-tagged app entry. Name and magic offset are reliable for any
    number of entries (verified against three real ones, 2026-08-05). `total_length` is only
    trustworthy as *this entry's own size* when it's the sole entry in the region (see the
    module docstring) - with more than one entry present, `binary`/`total_length` are left
    unset and flagged rather than guessed a second time."""
    magic_offsets = _find_all_magic(data)
    real_end = _real_data_end(data)
    entries = []
    for idx in magic_offsets:
        entry = {"magic_offset": idx, "name": _name_before(data, idx)}
        pre_start = idx - PREAMBLE_LEN
        if pre_start >= 0 and data[pre_start:pre_start + PREAMBLE_LEN].count(0xFF) < PREAMBLE_LEN:
            field_a, field_b, field_c, total_length = struct.unpack_from(
                "<HHII", data, pre_start)
            entry.update({
                "entry_offset": pre_start, "field_a": field_a, "field_b": field_b,
                "field_c": field_c, "total_length": total_length,
            })
            blob_end = pre_start + total_length
            if len(magic_offsets) == 1 and blob_end <= real_end:
                entry["binary"] = data[idx:blob_end]
            else:
                entry["_warning"] = (
                    "total_length is a whole-region watermark with more than one entry "
                    "present, not this entry's own size - binary/total_length not reliable "
                    "here (see module docstring)")
        else:
            entry["_warning"] = "no wrapper preamble found before IAMRULE (or it's all 0xFF)"
            entry["binary"] = data[idx:idx + 4]  # just the header, unknown extent
        entries.append(entry)
    return entries


def match_catalog(binary, catalog):
    for e in catalog:
        if bytes(e["binary"]) == binary:
            return e
    return None


def show(entries, catalog=None):
    if not entries:
        print("no IAMRULE entries found - Apps region is empty (no apps installed)")
        return
    print(f"{len(entries)} app entry(ies) found:")
    for e in entries:
        print(f"  offset 0x{e['magic_offset']:x}: name={e.get('name', '?')!r}"
              f"  total_length={e.get('total_length', '?')}"
              + (f"  binary_length={len(e['binary'])}" if "binary" in e else "  binary_length=?"))
        if "_warning" in e:
            print(f"    WARNING: {e['_warning']}")
        if catalog is not None and "binary" in e:
            match = match_catalog(e["binary"], catalog)
            if match:
                print(f"    catalog match: ruleId={match['ruleId']} name={match['name']!r}"
                      f" activityId={match['activityId']} category={match['categoryId']}")
            else:
                print("    no exact catalog match (private/custom app, or catalog snapshot"
                      " doesn't include it)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="from_file", metavar="FILE",
                     help="decode a raw Apps dump (200000 bytes) instead of the watch")
    ap.add_argument("--catalog", metavar="FILE",
                     help="suunto-apps/index.json from a SuuntoLink install, to identify"
                          " apps by exact binary match against the public catalog")
    args = ap.parse_args()

    if args.from_file:
        with open(args.from_file, "rb") as f:
            data = f.read()
    else:
        from write_nav import Link, read_flash
        link = Link(dry_run=False, verbose=False)
        print("read-only: 0x0b17 reads flash, nothing is written")
        link.open()
        data = read_flash(link, APPS_BASE, APPS_SIZE, label="Apps")

    catalog = None
    if args.catalog:
        with open(args.catalog) as f:
            catalog = json.load(f)

    show(decode(data), catalog=catalog)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
