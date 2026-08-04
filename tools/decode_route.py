#!/usr/bin/env python3
"""Decodes the navigation database of a SuuntoLink capture and self-checks the format.

    ./tools/decode_route.py "assets/ambit3 pcap/route12km"
    ./tools/decode_route.py --sequence "assets/ambit3 pcap/routedelete"
"""

import argparse
import struct
import sys

import ambit_format as F
from ambit_pcap import FlashImage, messages, tails, write_packs


def show_sequence(msgs):
    print("== chronological sequence")
    for m in msgs:
        arrow = "<-" if m.incoming else "->"
        detail = ""
        if m.command == 0x0B16 and not m.incoming and len(m.payload) >= 8:
            addr, length, seq = struct.unpack("<IHH", m.payload[:8])
            detail = f"addr=0x{addr:06x} len={length} seq={seq}"
        elif m.command == 0x0B18 and not m.incoming and len(m.payload) >= 8:
            addr, extra = struct.unpack("<II", m.payload[:8])
            detail = f"addr=0x{addr:06x} extra=0x{extra:08x} +hash"
        elif m.payload:
            head = m.payload[:16].hex()
            detail = f"[{len(m.payload)}] {head}{'..' if len(m.payload) > 16 else ''}"
        print(f"  {m.index:3} {arrow} 0x{m.command:04x} {m.name:26} {detail}")


def show_ranges(flash):
    print("== written ranges")
    for addr, size in flash.ranges():
        note = ""
        if addr == F.ROUTE_DESC:
            note = f"= 52 x {size // 52}" if size % 52 == 0 else "!! not a multiple of 52"
        elif addr == F.ROUTE_POINTS:
            note = f"= 12 x {size // 12}" if size % 12 == 0 else "!! not a multiple of 12"
        elif addr == F.ROUTE_INDEX:
            note = f"= 20 x {size // 20}" if size % 20 == 0 else "!! not a multiple of 20"
        elif addr == F.WAYPOINT_DESC:
            note = f"= 52 x {size // 52}" if size % 52 == 0 else "!! non multiple de 52"
        elif addr == F.WAYPOINT_INDEX:
            note = f"= 4 x {size // 4}"
        print(f"  0x{addr:06x}  {size:6} B   {note}")


def decode(path, sequence=False):
    msgs = messages(path)
    flash = FlashImage(write_packs(msgs))
    print(f"### {path}  ({len(msgs)} messages)")
    if sequence:
        show_sequence(msgs)
    show_ranges(flash)

    header = F.RouteHeader.parse(flash.read(F.ROUTE_BASE, 32))
    print(f"\n== route header  magic=0x{header.magic:04x} "
          f"routes={header.route_count} points={header.point_count} "
          f"crc=0x{header.checksum:04x}")
    if header.magic != F.ROUTE_HEADER_MAGIC:
        print(f"  !! unexpected magic (expected 0x{F.ROUTE_HEADER_MAGIC:04x})")

    m, p = header.route_count, header.point_count
    descriptors = [F.RouteDescriptor.parse(flash.read(F.ROUTE_DESC + 52 * i, 52))
                   for i in range(m)]
    points = [F.RoutePoint.parse(flash.read(F.ROUTE_POINTS + 12 * i, 12))
              for i in range(p)]

    desc_blob = flash.read(F.ROUTE_DESC, 52 * m)
    point_blob = flash.read(F.ROUTE_POINTS, 12 * p)
    if m == 0:
        reset = flash.read(F.ROUTE_BASE, 32) == F.ROUTE_HEADER_RESET
        print(f"  empty database -> reset header {'conforms' if reset else 'UNEXPECTED'}")
    else:
        crc = F.crc16_ccitt_false(desc_blob + point_blob)
        print(f"  crc16_ccitt_false(desc || points) = 0x{crc:04x} "
              f"-> {'OK' if crc == header.checksum else 'FAIL'}")

    expected = 0
    for i, d in enumerate(descriptors):
        print(f"\n== route[{i}] {d.name!r}")
        print(f"  points {d.point_count} from {d.start_index}   "
              f"distance {d.distance} m   ascent {d.ascent} / descent {d.descent}")
        print(f"  mid ({d.mid_lat}, {d.mid_lon}) = {d.mid_lat / 1e7:.7f}, {d.mid_lon / 1e7:.7f}")
        print(f"  max_x {d.max_x}   max_y {d.max_y}")
        if d.start_index != expected:
            print(f"  !! start_index expected {expected} (increasing running sum)")
        expected += d.point_count

        e = F.RouteIndexEntry.parse(flash.read(F.ROUTE_INDEX + 20 * i, 20))
        print(f"  index: route no {e.number}  timestamp {e.timestamp}  "
              f"waypoints {e.waypoint_count} from {e.waypoint_start}  "
              f"const {e.const}  extra {e.extra}  trailer {e.trailer}")
        for label, ok in (("index: number = i+1", e.number == i + 1),
                          ("index: constant @8 = 415", e.const == F.ROUTE_INDEX_CONST),
                          ("index: trailer @16 = 0", e.trailer == 0)):
            print(f"  {'OK   ' if ok else 'FAIL '} {label}")

        section = points[d.start_index:d.start_index + d.point_count]
        xs = [q.x for q in section]
        ys = [q.y for q in section]
        rel = [q.rel_distance for q in section]
        alt = [q.altitude for q in section]
        checks = [
            ("max(x) == max_x", max(xs) == d.max_x),
            ("max(y) == max_y", max(ys) == d.max_y),
            ("rel_distance increasing", all(a <= b for a, b in zip(rel, rel[1:]))),
            ("rel_distance 0 -> 65535", rel[0] == 0 and rel[-1] == 65535),
        ]
        if len(section) >= 2:
            checks.append(("last point duplicated",
                           section[-1].build() == section[-2].build()))
        for label, ok in checks:
            print(f"  {'OK   ' if ok else 'FAIL '} {label}")
        no_alt = all(a == F.ALTITUDE_NONE for a in alt)
        print(f"  altitude {'absent (30000 everywhere)' if no_alt else f'{min(alt)} to {max(alt)} m'}")

    if sum(d.point_count for d in descriptors) != p:
        print("\n  !! sum of point_count differs from the header counter")

    wh = F.WaypointHeader.parse(flash.read(F.WAYPOINT_BASE, 6))
    n_wpt = wh.count
    wpt_blob = flash.read(F.WAYPOINT_DESC, 52 * n_wpt)
    wpt_crc = F.crc16_ccitt_false(wpt_blob)
    print(f"\n== waypoints  magic=0x{wh.magic:04x} count={n_wpt} "
          f"crc=0x{wh.checksum:04x}")
    print(f"  crc16_ccitt_false(descriptors) = 0x{wpt_crc:04x} "
          f"-> {'OK' if wpt_crc == wh.checksum else 'FAIL'}")
    idx = flash.read(F.WAYPOINT_INDEX, 4 * n_wpt)
    tails_ok = True
    for i in range(n_wpt):
        w = F.WaypointDescriptor.parse(flash.read(F.WAYPOINT_DESC + 52 * i, 52))
        point_index, = struct.unpack("<I", idx[4 * i:4 * i + 4])
        t = F.WaypointTail.parse(w.tail)
        tails_ok &= t.plausible() and t.build() == w.tail
        print(f"  [{i}] {w.lat / 1e7:.7f}, {w.lon / 1e7:.7f}  {w.name!r} "
              f"route={w.route_name!r}  point #{point_index}")
        print(f"      tail: {t}")
    if n_wpt:
        print(f"  {'OK   ' if tails_ok else 'FAIL '} tails conform and "
              f"reserializable identically")
        ok_tails = tails_ok
    else:
        ok_tails = True

    for m in msgs:
        if m.incoming or m.command != 0x0B25:
            continue
        pois = F.parse_sbem_poi_list(m.payload)
        print(f"\n== POI via 0x0b25 (SBEM0102), {len(pois)} entries "
              f"— a store distinct from the Waypoints region")
        for p in pois:
            typed = "".join(f" {k}={p[k]}" for k in
                            ("type", "sub_type", "type_index", "flags") if p[k])
            print(f"  {p['name']!r:20} {p['stamp']}  "
                  f"{p['lat'] / 1e7:.7f}, {p['lon'] / 1e7:.7f}{typed}")
        break

    print("\n== closing hash 0x0b18")
    ok = (wpt_crc == wh.checksum) and ok_tails
    for addr, extra, want in tails(msgs):
        if addr not in F.REGIONS:
            print(f"  ?          0x{addr:06x}  unknown region")
            ok = False
            continue
        name, size, mode = F.REGIONS[addr]
        got = F.region_hash(flash, addr)
        good = got == want
        ok &= good
        print(f"  {name:10} 0x{addr:06x} {mode:7} size {size:6}  "
              f"extra=0x{extra:08x}  {'OK' if good else 'FAIL'}")
        if not good:
            print(f"     expected {want}\n     computed {got}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("captures", nargs="+")
    ap.add_argument("--sequence", action="store_true",
                    help="show the chronological sequence of messages")
    args = ap.parse_args()
    all_ok = True
    for path in args.captures:
        all_ok &= decode(path, args.sequence)
        print()
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
