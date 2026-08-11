#!/usr/bin/env python3
"""Check custom_modes.FIELD_TYPES against SuuntoLink's own desktop binary.

Our display-field numbering (FT_TIME=1, FT_ALTI=6, FT_TIMER=5 ...) was recovered from
libkomposti-ng.so and grown from captures. That is good evidence but it is OUR reading, and
a single wrong id writes the wrong value onto a watch display - the kind of near-miss that
already caused one scare over 0x1d (FT_DUAL_TIME vs FT_AVG_PACE).

SuuntoLink's own SDSApplicationServer.exe builds the same table, and the decompile in
assets/ still carries every name/id pair. This compares the two. It is a verifier, not a
generator: it never rewrites FIELD_TYPES, it just tells you whether the two agree.

The decompile registers the pairs in two different shapes, both handled here:

    FUN_004324a0(local_48,(int *)"FT_ALTI_GRAPH");   ...   local_18 = 0xf;
    FUN_004324a0(local_f4,(int *)"FT_AVG_PACE");     pbVar3 = FUN_00795150(local_30,local_f4,0x1d);

    ./tools/verify_field_types.py            # 0 if the tables agree
    ./tools/verify_field_types.py --list     # print every resolved pair
"""

import argparse
import os
import re
import sys

import custom_modes

DECOMPILE = os.path.join(
    os.path.dirname(__file__), "..", "assets", "WIndows apps", "Suuntolink",
    "suuntoapp_local", "decompiled", "SDSApplicationServer.exe.c")

# name, then the next `local_18 = N` that registers it
_REGISTER = re.compile(r'"(FT_[A-Z_0-9]+)"\)\;(.{0,600}?)local_18 = (0x[0-9a-f]+|\d+);', re.S)
# name, then a call taking the id as its third argument
_ARGUMENT = re.compile(
    r'"(FT_[A-Z_0-9]+)"\)\;(.{0,200}?)FUN_00795150\([^,]+,[^,]+,(0x[0-9a-f]+|\d+)\)', re.S)


def pairs_from_decompile(path):
    """{FT_NAME: id} as SuuntoLink's own binary registers them."""
    with open(path, errors="ignore") as fh:
        src = fh.read()
    found = {}
    for pattern in (_REGISTER, _ARGUMENT):
        for m in pattern.finditer(src):
            found.setdefault(m.group(1), int(m.group(3), 0))
    names = set(re.findall(r'"(FT_[A-Z_0-9]+)"', src))
    return found, names - set(found)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="print every resolved pair")
    args = ap.parse_args()

    path = os.path.normpath(DECOMPILE)
    if not os.path.exists(path):
        print(f"decompile not found: {path}")
        return 2

    found, unresolved = pairs_from_decompile(path)
    agree, unknown, disagree = [], [], []
    for name, fid in sorted(found.items(), key=lambda kv: kv[1]):
        ours = custom_modes.FIELD_TYPES.get(fid)
        if ours == name:
            agree.append((fid, name))
        elif ours is None:
            unknown.append((fid, name))
        else:
            disagree.append((fid, name, ours))

    if args.list:
        for name, fid in sorted(found.items(), key=lambda kv: kv[1]):
            ours = custom_modes.FIELD_TYPES.get(fid)
            flag = "  " if ours == name else ("+ " if ours is None else "! ")
            print(f"  {flag}{fid:#06x}  {name:<28} {'' if ours == name else f'ours={ours}'}")

    print(f"\n{len(found)} name/id pairs in SuuntoLink's binary, {len(unresolved)} unresolved")
    print(f"  agree with FIELD_TYPES : {len(agree)}")
    print(f"  we had no name for     : {len(unknown)}")
    print(f"  DISAGREE               : {len(disagree)}")
    for fid, theirs, ours in disagree:
        print(f"      {fid:#06x} SuuntoLink={theirs}  ours={ours}")
    for fid, name in unknown:
        print(f"      {fid:#06x} {name} - in SuuntoLink's table, missing from ours")
    if unresolved:
        print(f"  names whose id could not be located: {', '.join(sorted(unresolved))}")

    return 1 if (disagree or unresolved) else 0


if __name__ == "__main__":
    sys.exit(main())
