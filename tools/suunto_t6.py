#!/usr/bin/env python3
"""Read training logs off a real Suunto T6 / T6c / T6d wristop - EXPERIMENTAL, built blind.

The T6 family is a different, older Suunto product from everything else this project talks
to: a 2004-2010-era heart-rate training computer with NO built-in GPS. It records heart rate
(beat-to-beat), barometric altitude and lap splits; the *track* came from a separate Suunto
GPS Track Pod (already supported here, tools/gps_track_pod.py). It has no relation to the
Ambit3/Traverse/Kailash NSP/CustomModes/route work - it is its own FTDI USB-serial protocol
(0403:f680, 115200 8N1, RTS low) and its own on-device page memory.

WHY "BLIND": exactly like tools/gps_track_pod.py - this project's whole methodology elsewhere
is real hardware + real captures + byte-exact verification, and none of that is possible here
because nobody on this project owns a T6. This wraps evelbulgroz's suunto-t6-sync
(tools/vendor/suunto_t6/, MIT, see tools/vendor/README.md) - whose own author DID develop it
against two owner-verified T6d units - unmodified, on the theory that its real-hardware
development is the closest thing to verification available. Treat anything it reports as
unverified until someone with a real T6 confirms it.

Deliberately READ-ONLY. The T6 protocol here only ever issues GetVersion / ReadMemory; no
write path exists in the vendored code and none is wired up.

    ./tools/suunto_t6.py --status                       # device info (model, serial, fw)
    ./tools/suunto_t6.py --list                         # training logs on the device
    ./tools/suunto_t6.py --retrieve 0 --out move.fit    # one log -> FIT (hr + altitude)
    ./tools/suunto_t6.py --retrieve 0 --out move.xml --format xml   # native STM XML
    ./tools/suunto_t6.py --retrieve -1 --out-dir DIR    # every log, one FIT each
    ./tools/suunto_t6.py --retrieve 0 --samples-out move.json       # sidecar for legacy_merge
    ./tools/suunto_t6.py --status --json                # machine-readable, for the backend

A T6 log has no latitude/longitude, so a FIT/GPX from here is a heart-rate + barometric-
altitude time series with no map track. To get a mapped activity, pair it with a GPS Track Pod
recording of the same session and run tools/legacy_merge.py.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

# FTDI identifiers for the T6 USB-serial cable (see the vendored transport + upstream README).
FTDI_VID = 0x0403
FTDI_PID = 0xF680
BAUD = 115200

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))

import legacy_export  # noqa: E402  (sibling module, same tools/ dir)


def _autodetect_port() -> str | None:
    """First serial port matching the T6 FTDI cable, or None. Kept separate so a missing
    device / missing pyserial is a clean, expected answer rather than an exception from deep
    inside the vendored transport."""
    try:
        from serial.tools import list_ports
    except Exception:
        return None
    for p in list_ports.comports():
        if (getattr(p, "vid", None) == FTDI_VID and getattr(p, "pid", None) == FTDI_PID):
            return p.device
    return None


def _require_pyserial() -> None:
    try:
        import serial  # noqa: F401
    except Exception:
        sys.exit("pyserial is not installed - `pip install pyserial` to talk to a real T6.")


def _open(port: str | None):
    """Return an open (transport, SuuntoDevice). Caller closes the transport."""
    _require_pyserial()
    from suunto_t6_sync.transport import SerialTransport
    from suunto_t6_sync.device import SuuntoDevice
    port = port or _autodetect_port()
    if not port:
        sys.exit("no Suunto T6 FTDI cable found (0403:f680); pass --device /dev/ttyUSB0.")
    transport = SerialTransport(port, baudrate=BAUD)
    transport.open()
    return transport, SuuntoDevice(transport)


# ─── sample model shared with legacy_merge.py ─────────────────────────────────────────────

def decoded_to_points(header, decoded) -> list[dict]:
    """Turn a vendored (LogHeader, DecodedLog) pair into legacy_export points.

    The T6 samples a fixed interval (`header.sample_interval_s`) from `header.start`. HR and
    barometric altitude are parallel series; either can be shorter than the other, so we walk
    the longest and fill what exists. `header.start` is the watch's own *local* wall clock
    (the T6 stores no timezone), so these datetimes are tagged UTC only as a container - the
    merge tool is where a real UTC offset against the GPS Track Pod gets applied."""
    hr = list(getattr(decoded, "heartrate_bpm", []) or [])
    alt = list(getattr(decoded, "altitude_m", []) or [])
    n = max(len(hr), len(alt))
    interval = header.sample_interval_s or 1
    start = header.start.replace(tzinfo=timezone.utc)
    points = []
    for i in range(n):
        points.append({
            "time": start + timedelta(seconds=i * interval),
            "lat": None, "lon": None,
            "ele": float(alt[i]) if i < len(alt) else None,
            "hr": int(hr[i]) if i < len(hr) else None,
        })
    return points


def _log_summary_dict(s) -> dict:
    h = s.header
    return {
        "index": s.index,
        "start": h.start.isoformat(),
        "duration_s": round(h.duration_s) if hasattr(h, "duration_s") else None,
        "samples": h.sample_count,
        "interval_s": h.sample_interval_s,
        "laps": h.lap_count,
        "min_altitude_m": h.min_altitude_m,
        "max_altitude_m": h.max_altitude_m,
    }


# ─── commands ─────────────────────────────────────────────────────────────────────────────

def cmd_status(args) -> int:
    port = args.device or _autodetect_port()
    if not port:
        if args.json:
            print(json.dumps({"ok": True, "present": False}))
            return 0
        print("No Suunto T6 detected (0403:f680).")
        return 1
    transport, dev = _open(port)
    try:
        ident = dev.get_identity(extra_commands=False)
    finally:
        transport.close()
    info = {
        "present": True, "port": port, "manufacturer": "Suunto",
        "model": ident.model, "serial": ident.serial,
        "firmware": ident.firmware_hint, "log_count": ident.log_count,
    }
    if args.json:
        info["ok"] = True
        info["info"] = f"Suunto {info['model']}  serial {info['serial']}"
        info["status"] = (f"firmware {info['firmware']}  -  {info['log_count']} log(s)  "
                          f"on {port}")
        print(json.dumps(info))
    else:
        print(f"Suunto {info['model']}  serial {info['serial']}  fw {info['firmware']}  "
              f"{info['log_count']} log(s)  on {port}")
    return 0


def cmd_list(args) -> int:
    transport, dev = _open(args.device)
    try:
        logs = [_log_summary_dict(s) for s in dev.list_logs()]
    finally:
        transport.close()
    if args.json:
        print(json.dumps({"ok": True, "logs": logs}))
    else:
        for l in logs:
            print(f"[{l['index']}] {l['start']}  {l['samples']} samples @ "
                  f"{l['interval_s']}s  {l['laps']} laps")
    return 0


def _export_points(points, out_path, fmt, name):
    if fmt == "fit":
        return legacy_export.write_fit(points, out_path, name=name)
    if fmt == "gpx":
        return legacy_export.write_gpx(points, out_path, name=name)
    raise ValueError(f"unknown format {fmt!r} for point export")


def cmd_retrieve(args) -> int:
    written = []
    transport, dev = _open(args.device)
    try:
        logs = dev.list_logs()
        idxs = range(len(logs)) if args.retrieve == -1 else [args.retrieve]
        for i in idxs:
            if not 0 <= i < len(logs):
                sys.exit(f"log index {i} out of range 0..{len(logs) - 1}")
            header = logs[i].header
            if args.format == "xml":
                out_dir = pathlib.Path(args.out_dir or ".")
                path = dev.export_log_xml(i, out_dir)
                written.append({"index": i, "path": str(path)})
                if not args.json:
                    print(f"log {i}: wrote {path}")
                continue
            decoded = dev.decode_log_by_index(i)
            points = decoded_to_points(header, decoded)
            name = f"Suunto T6 {header.start.strftime('%Y-%m-%d %H:%M')}"
            samples_path = None
            if args.retrieve == -1:
                out_path = pathlib.Path(args.out_dir or ".") / f"suunto_t6_{i}.{args.format}"
                if args.samples_out or args.out_dir:
                    samples_path = pathlib.Path(args.out_dir or ".") / f"suunto_t6_{i}.json"
            else:
                out_path = pathlib.Path(args.out or f"suunto_t6_{i}.{args.format}")
                if args.samples_out:
                    samples_path = pathlib.Path(args.samples_out)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            if samples_path is not None:
                samples_path.write_text(json.dumps(
                    {"name": name, "start": header.start.isoformat(),
                     "interval_s": header.sample_interval_s,
                     "points": [{**p, "time": p["time"].isoformat()} for p in points]},
                    indent=2))
            size = _export_points(points, out_path, args.format, name)
            written.append({"index": i, "path": str(out_path), "bytes": size,
                            "samples": str(samples_path) if samples_path else None,
                            "sample_count": len(points)})
            if not args.json:
                print(f"log {i}: wrote {out_path} ({size} B, {len(points)} samples)")
    finally:
        transport.close()
    if args.json:
        print(json.dumps({"ok": True, "written": written}))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", metavar="PORT", help="serial port (default: autodetect FTDI)")
    ap.add_argument("--status", action="store_true", help="device info")
    ap.add_argument("--list", action="store_true", help="list training logs")
    ap.add_argument("--retrieve", type=int, metavar="N",
                    help="export log N (-1 for every log)")
    ap.add_argument("--out", metavar="FILE", help="output path, with --retrieve N")
    ap.add_argument("--out-dir", metavar="DIR", help="output dir, with --retrieve -1")
    ap.add_argument("--samples-out", metavar="FILE",
                    help="also write a JSON sample sidecar for tools/legacy_merge.py")
    ap.add_argument("--format", choices=("fit", "gpx", "xml"), default="fit",
                    help="fit (default, hr+altitude), gpx, or xml (native STM)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)

    if args.status:
        return cmd_status(args)
    if args.list:
        return cmd_list(args)
    if args.retrieve is not None:
        return cmd_retrieve(args)
    ap.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
