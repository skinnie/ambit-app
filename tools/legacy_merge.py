#!/usr/bin/env python3
"""Merge a Suunto GPS Track Pod recording with a Suunto T6 heart-rate log - EXPERIMENTAL.

The T6 family has no GPS: back in 2004-2010 you clipped a separate Suunto GPS Track Pod to
your hip for the map track, while the wristop logged heart rate and barometric altitude. Two
halves of one workout, recorded on two devices. This tool puts them back together:

    GPS Track Pod  --(tools/gps_track_pod.py)-->  track.gpx   (lat/lon/ele/time)
    Suunto T6      --(tools/suunto_t6.py)------>  hr.json      (time/hr/altitude samples)
                        legacy_merge.py
                             |
                             v
             one GPS activity with per-point heart rate  (GPX + FIT)

Usage:

    ./tools/legacy_merge.py --pod-gpx track.gpx --t6-json hr.json --out ride.gpx
    ./tools/legacy_merge.py --pod-gpx track.gpx --t6-json hr.json --out ride.fit --format fit
    # or read the T6 live instead of a JSON sidecar:
    ./tools/legacy_merge.py --pod-gpx track.gpx --t6-index 0 --out ride.gpx

TIME ALIGNMENT - THE BLIND PART. The GPS Track Pod timestamps are real UTC; the T6 stores
only a local wall-clock with no timezone. So the two clocks do not share an origin, and the
honest default is `--auto-align`: shift the whole T6 series so its first sample lands on the
Pod track's first fix. If the two were started a few seconds apart, nudge with `--offset N`
(seconds, added to T6 times after auto-align). Nobody on this project owns either device, so
this alignment has never been checked against a real paired recording - treat the merged HR as
approximate until it has.
"""

from __future__ import annotations

import argparse
import bisect
import json
import pathlib
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))

import legacy_export  # noqa: E402


def _parse_iso(text: str) -> datetime:
    t = text.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(t)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def read_pod_gpx(path) -> list[dict]:
    """Read GPS Track Pod GPX trackpoints into points (lat/lon/ele/time, no hr yet).
    Namespace-agnostic so it accepts our own gps_track_pod.py output and generic GPX alike."""
    points = []
    for elem in ET.parse(path).getroot().iter():
        if not elem.tag.endswith("}trkpt") and elem.tag != "trkpt":
            continue
        lat = elem.get("lat"); lon = elem.get("lon")
        if lat is None or lon is None:
            continue
        ele = t = None
        for child in elem:
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "ele" and child.text:
                ele = float(child.text)
            elif tag == "time" and child.text:
                t = _parse_iso(child.text)
        if t is None:
            continue
        points.append({"time": t, "lat": float(lat), "lon": float(lon),
                       "ele": ele, "hr": None})
    points.sort(key=lambda p: p["time"])
    return points


def read_t6_json(path) -> list[dict]:
    """Read a tools/suunto_t6.py --samples-out sidecar into points."""
    doc = json.loads(pathlib.Path(path).read_text())
    out = []
    for p in doc["points"]:
        out.append({"time": _parse_iso(p["time"]), "lat": None, "lon": None,
                    "ele": p.get("ele"), "hr": p.get("hr")})
    out.sort(key=lambda p: p["time"])
    return out


def read_t6_live(index: int, device: str | None) -> list[dict]:
    sys.path.insert(0, str(HERE))
    import suunto_t6
    transport, dev = suunto_t6._open(device)
    try:
        header = dev.list_logs()[index].header
        decoded = dev.decode_log_by_index(index)
        return suunto_t6.decoded_to_points(header, decoded)
    finally:
        transport.close()


def merge(pod_points: list[dict], t6_points: list[dict], *, auto_align: bool,
          offset_s: float, tolerance_s: float, use_baro_altitude: bool) -> list[dict]:
    """Attach each GPS trackpoint the nearest-in-time T6 heart-rate sample.

    Returns the Pod points enriched with `hr` (and, when `use_baro_altitude`, the T6's
    barometric `ele` where the Pod had none or where explicitly preferred)."""
    if not pod_points or not t6_points:
        return pod_points

    shift = timedelta(seconds=offset_s)
    if auto_align:
        shift += pod_points[0]["time"] - t6_points[0]["time"]
    t6 = [{**p, "time": p["time"] + shift} for p in t6_points]
    t6_times = [p["time"] for p in t6]

    tol = timedelta(seconds=tolerance_s)
    merged = []
    for gp in pod_points:
        i = bisect.bisect_left(t6_times, gp["time"])
        best = None
        for j in (i - 1, i):
            if 0 <= j < len(t6):
                d = abs(t6[j]["time"] - gp["time"])
                if d <= tol and (best is None or d < best[0]):
                    best = (d, t6[j])
        out = dict(gp)
        if best is not None:
            sample = best[1]
            if sample.get("hr") is not None:
                out["hr"] = sample["hr"]
            if use_baro_altitude and sample.get("ele") is not None:
                out["ele"] = sample["ele"]
        merged.append(out)
    return merged


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pod-gpx", required=True, metavar="FILE", help="GPS Track Pod GPX")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--t6-json", metavar="FILE", help="T6 sample sidecar (suunto_t6 --samples-out)")
    src.add_argument("--t6-index", type=int, metavar="N", help="read T6 log N live over USB")
    ap.add_argument("--device", metavar="PORT", help="T6 serial port, with --t6-index")
    ap.add_argument("--out", required=True, metavar="FILE", help="merged output path")
    ap.add_argument("--format", choices=("gpx", "fit"), default="gpx")
    ap.add_argument("--no-auto-align", action="store_true",
                    help="do NOT shift T6 onto the Pod start (times already share an origin)")
    ap.add_argument("--offset", type=float, default=0.0, metavar="SEC",
                    help="seconds added to T6 times (after auto-align)")
    ap.add_argument("--tolerance", type=float, default=30.0, metavar="SEC",
                    help="max GPS-to-HR time gap to attach a sample (default 30)")
    ap.add_argument("--baro-altitude", action="store_true",
                    help="use the T6 barometric altitude instead of the Pod's GPS altitude")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)

    pod = read_pod_gpx(args.pod_gpx)
    if not pod:
        sys.exit(f"no timed trackpoints in {args.pod_gpx}")
    t6 = (read_t6_json(args.t6_json) if args.t6_json is not None
          else read_t6_live(args.t6_index, args.device))
    if not t6:
        sys.exit("T6 source had no samples")

    merged = merge(pod, t6, auto_align=not args.no_auto_align, offset_s=args.offset,
                   tolerance_s=args.tolerance, use_baro_altitude=args.baro_altitude)
    matched = sum(1 for p in merged if p.get("hr") is not None)
    name = f"Suunto T6 + GPS Track Pod {pod[0]['time'].strftime('%Y-%m-%d %H:%M')}"
    if args.format == "fit":
        size = legacy_export.write_fit(merged, args.out, sport="generic", name=name)
    else:
        size = legacy_export.write_gpx(merged, args.out, name=name)
    pct = 100 * matched // max(1, len(merged))
    if args.json:
        print(json.dumps({"ok": True, "path": str(args.out), "bytes": size,
                          "points": len(merged), "matched": matched, "hr_percent": pct}))
    else:
        print(f"wrote {args.out} ({size} B): {len(merged)} GPS points, "
              f"{matched} with heart rate ({pct}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
