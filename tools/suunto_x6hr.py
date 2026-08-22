#!/usr/bin/env python3
"""Read logs off a real Suunto X6HR wristop - EXPERIMENTAL, built blind.

The X6HR is an early-2000s Suunto X-series wristop (altimeter / barometer / compass + heart
rate), a different, older product than everything else this project talks to - NO GPS, and it
predates the Ambit/Traverse/Kailash NSP work entirely. It connects over the old Suunto "PC
interface": an infrared pod on an RS-232 serial cable, reached on a modern machine through a
USB-serial adapter (so it appears as a plain serial port - unlike the T6's FTDI-USB cradle).

Its rich log is the CHRONO log: (barometric-altitude, heart-rate) samples at a fixed interval -
a HR + baro-altitude time series with no map track, exactly like the T6. To get a mapped
activity, pair it with a Suunto GPS Track Pod recording of the same session and run
tools/legacy_merge.py (this tool's --samples-out sidecar is the same shape as suunto_t6.py's).

WHY "BLIND": same as tools/suunto_t6.py and tools/gps_track_pod.py - nobody on this project owns
an X6HR, so none of this project's usual real-hardware + byte-exact verification is possible.
The serial protocol and log decoding here are a Python-3 PORT of tomoya kamata (T.Kamata)'s
`x6hr.py` (github.com/nabeka/x6hr-python, GPLv3), whose author DID develop it against a real
X6HR - the closest thing to verification available. Cross-referenced with larshesel/
suunto_x6hr_erl and the terre-adelie SuuntoX6HR wiki. Treat anything it reports as unverified
until someone with a real X6HR confirms it. Credit: see docs/credits.

Deliberately READ-ONLY. Only register reads are issued; no write path exists.

    ./tools/suunto_x6hr.py --status                      # serial number + unit settings
    ./tools/suunto_x6hr.py --list                        # chrono + hiking logs on the device
    ./tools/suunto_x6hr.py --retrieve 0 --out move.fit   # one chrono log -> FIT (hr + altitude)
    ./tools/suunto_x6hr.py --retrieve 0 --samples-out move.json   # sidecar for legacy_merge
    ./tools/suunto_x6hr.py --status --json               # machine-readable, for the backend
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

BAUD = 9600  # nabeka's reader opens the port at pyserial's default (9600 8N1); kept the same.


def _require_pyserial():
    try:
        import serial  # noqa: F401
    except ImportError:
        sys.exit("pyserial is not installed - `pip install pyserial` to talk to a real X6HR.")


def _autodetect_port() -> str | None:
    """First plausible serial port, or None. The X6HR's USB-serial adapter has no unique
    Suunto VID (it's whatever FTDI/CP210x/CH340 cable the owner used), so unlike the T6 we
    can't match a VID - we just return the first serial port and let the handshake in
    probe()/read_serial_number() confirm it's really an X6HR."""
    try:
        from serial.tools import list_ports
    except ImportError:
        return None
    ports = list(list_ports.comports())
    return ports[0].device if ports else None


class X6HR:
    """Suunto X6HR serial protocol - a Python-3 port of nabeka/x6hr-python (T.Kamata, GPLv3).

    Framing (request): [0x05, 0x00, len] + payload + [XOR of payload]. A register read sends
    the 16-bit address little-endian + the byte count as payload; the reply is the payload
    wrapped in a 6-byte header + 1-byte trailer, so the content is bytes[6:-1]."""

    def __init__(self, port):
        self._port = port

    def _write_cmd(self, payload):
        checksum = 0
        for b in payload:
            checksum ^= b
        self._port.write(bytes([0x05, 0x00, len(payload)] + list(payload) + [checksum]))

    def read_register(self, addr, length):
        self._write_cmd([addr & 0xFF, (addr >> 8) & 0xFF, length])
        data = list(self._port.read(length + 7))
        return data[6:-1]

    def read_serial_number(self):
        d = self.read_register(0x005D, 4)
        if len(d) < 4:
            return None
        return d[0] * 1000000 + d[1] * 10000 + d[2] * 100 + d[3]

    def read_units(self):
        d = self.read_register(0x0064, 0x0B)
        if len(d) < 9:
            return {}
        return {
            "tone": d[0] == 1,
            "icon": d[1] == 1,
            "light": ["Night", "OFF", "Normal"][d[2]] if d[2] < 3 else d[2],
            "time": ["12h", "24h"][d[3]] if d[3] < 2 else d[3],
            "date": ["MM.DD", "DD.MM", "Day"][d[4]] if d[4] < 3 else d[4],
            "altitude": ["ft", "m"][d[5]] if d[5] < 2 else d[5],
            "pressure": ["inHg", "hPa"][d[7]] if d[7] < 2 else d[7],
            "temperature": ["F", "C"][d[8]] if d[8] < 2 else d[8],
        }

    def read_chrono_index(self):
        return [b for b in self.read_register(0x19C9, 0x1E) if b != 0]

    def read_chrono_log(self, index):
        """One chrono log's summary + its decoded (altitude, hr) sample series."""
        p = self.read_register(0x19FA + (index - 1) * 0x32, 0x32)
        first_chunk = p[0]
        return {
            "index": index,
            "start": _wristop_dt(p[1], p[2], p[3], p[4], p[5]),
            "interval_s": p[6],
            "hr": p[7] == 1,
            "total_ascent_m": p[8] * 256 + p[9],
            "total_descent_m": p[10] * 256 + p[11],
            "laps": p[13],
            "duration_s": p[14] * 3600 + p[15] * 60 + p[16],
            "hr_min": p[34], "hr_max": p[35], "hr_avg": p[36],
            "samples": self._read_chrono_data(first_chunk),
        }

    def _read_chrono_data(self, index):
        """Follow the on-device linked list of 128-byte sample chunks (each read as
        0x32+0x32+0x1c, next-chunk index is the last byte) and decode the concatenated stream
        into (altitude_m, hr_bpm) samples: 0x82 = an 11-byte lap/marker record (skipped),
        0x80 = end, otherwise a 3-byte [alt_hi alt_lo hr] sample."""
        raw, nxt = [], index
        seen = set()
        while nxt != 0 and nxt not in seen:
            seen.add(nxt)
            base = 0x2000 + (nxt - 1) * 128
            chunk = (self.read_register(base, 0x32)
                     + self.read_register(base + 0x32, 0x32)
                     + self.read_register(base + 0x32 * 2, 0x1C))
            if not chunk:
                break
            nxt = chunk[-1]
            raw += chunk[1:-1]
        samples, i = [], 0
        while i < len(raw):
            if raw[i] == 130:      # 0x82: lap/marker, 11-byte record
                i += 11
            elif raw[i] == 128:    # 0x80: end
                break
            elif i + 2 < len(raw):
                samples.append((raw[i] * 256 + raw[i + 1], raw[i + 2]))
                i += 3
            else:
                break
        return samples

    def read_hiking_index(self):
        return [b for b in self.read_register(0x0FB4, 0x14) if b != 0]

    def read_hiking_log(self, index):
        """Hiking log SUMMARY only (this protocol exposes stats, not a sample stream, for
        hiking logs - the chrono log is the one with retrievable samples)."""
        p = self.read_register(0x0FC8 + (index - 1) * 128, 0x30)
        return {
            "index": index, "kind": "hiking",
            "start": _wristop_dt(p[1], p[2], p[3], p[4], p[5]),
            "interval_s": p[6], "hr": p[7] == 1,
            "total_ascent_m": p[8] * 256 + p[9],
            "total_descent_m": p[10] * 256 + p[11],
            "laps": p[13],
            "hr_min": p[34], "hr_max": p[35], "hr_avg": p[36],
            "samples": [],
        }


def _wristop_dt(yy, mm, dd, hh, mi):
    """The wristop stores a 2-digit year and its own LOCAL wall clock (no timezone). Tag UTC
    only as a container - legacy_merge is where a real offset vs the GPS Track Pod is applied."""
    try:
        return datetime(2000 + yy, mm or 1, dd or 1, hh, mi, tzinfo=timezone.utc)
    except ValueError:
        return datetime(2000, 1, 1, tzinfo=timezone.utc)


def chrono_to_points(log) -> list[dict]:
    """Chrono log -> legacy_merge points: one (altitude, hr) sample per `interval_s`, from the
    log's start. Same {time, lat, lon, ele, hr} shape suunto_t6.py emits."""
    interval = log.get("interval_s") or 1
    start = log["start"]
    points = []
    for i, (alt, hr) in enumerate(log.get("samples", [])):
        points.append({
            "time": start + timedelta(seconds=i * interval),
            "lat": None, "lon": None,
            "ele": float(alt), "hr": int(hr) if hr else None,
        })
    return points


# ─── serial open ────────────────────────────────────────────────────────────────────────────

def _open(port_name):
    _require_pyserial()
    import serial
    port_name = port_name or _autodetect_port()
    if not port_name:
        return None
    return X6HR(serial.Serial(port=port_name, baudrate=BAUD, timeout=3))


# ─── commands ───────────────────────────────────────────────────────────────────────────────

def cmd_status(args) -> int:
    dev = _open(args.device)
    if dev is None:
        info = {"ok": False, "error": "No serial port found. Connect the X6HR with its "
                "IR/serial PC interface (via a USB-serial adapter)."}
        print(json.dumps(info) if args.json else info["error"])
        return 1
    serial_no = dev.read_serial_number()
    if not serial_no:
        info = {"ok": False, "error": "No Suunto X6HR responded on the serial port - check the "
                "IR pod alignment and the cable."}
        print(json.dumps(info) if args.json else info["error"])
        return 1
    info = {"ok": True, "model": "Suunto X6HR", "serial": serial_no, "units": dev.read_units()}
    print(json.dumps(info) if args.json else
          f"Suunto X6HR  serial {serial_no}  units {info['units']}")
    return 0


def _all_logs(dev):
    """Chrono logs (with samples) then hiking logs (summary only), as a flat list."""
    logs = [dev.read_chrono_log(i) for i in dev.read_chrono_index()]
    for i in dev.read_hiking_index():
        logs.append(dev.read_hiking_log(i))
    for n, lg in enumerate(logs):
        lg["kind"] = lg.get("kind", "chrono")
    return logs


def _log_summary(lg) -> dict:
    return {"start": lg["start"].isoformat(), "kind": lg.get("kind", "chrono"),
            "duration_s": lg.get("duration_s"), "interval_s": lg.get("interval_s"),
            "laps": lg.get("laps"), "sample_count": len(lg.get("samples", [])),
            "hr_avg": lg.get("hr_avg")}


def cmd_list(args) -> int:
    dev = _open(args.device)
    if dev is None:
        print(json.dumps({"ok": False, "error": "no serial port"}) if args.json
              else "No serial port found.")
        return 1
    logs = _all_logs(dev)
    if args.json:
        print(json.dumps({"ok": True, "logs": [_log_summary(l) for l in logs]}))
    else:
        for i, l in enumerate(logs):
            s = _log_summary(l)
            print(f"[{i}] {s['kind']:7} {s['start']}  {s['sample_count']} samples")
    return 0


def cmd_retrieve(args) -> int:
    dev = _open(args.device)
    if dev is None:
        print(json.dumps({"ok": False, "error": "no serial port"}) if args.json
              else "No serial port found.")
        return 1
    logs = _all_logs(dev)
    idxs = range(len(logs)) if args.retrieve == -1 else [args.retrieve]
    written = []
    for i in idxs:
        if i < 0 or i >= len(logs):
            print(json.dumps({"ok": False, "error": f"log {i} out of range 0..{len(logs)-1}"})
                  if args.json else f"log {i} out of range")
            return 1
        points = chrono_to_points(logs[i])
        name = f"suunto_x6hr_{i}"
        out_path = pathlib.Path(args.out or f"{name}.{args.format}") if args.retrieve != -1 \
            else pathlib.Path(args.out_dir or ".") / f"{name}.{args.format}"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        size = _export_points(points, out_path, args.format, name)
        samples_path = None
        if args.samples_out and args.retrieve != -1:
            samples_path = pathlib.Path(args.samples_out)
        elif args.out_dir:
            samples_path = pathlib.Path(args.out_dir) / f"{name}.json"
        if samples_path is not None:
            samples_path.write_text(json.dumps(
                {"model": "Suunto X6HR", "index": i,
                 "points": [{**p, "time": p["time"].isoformat()} for p in points]}, indent=2))
        written.append({"index": i, "path": str(out_path), "bytes": size,
                        "samples": str(samples_path) if samples_path else None,
                        "sample_count": len(points)})
        if not args.json:
            print(f"log {i}: wrote {out_path} ({size} B, {len(points)} samples)")
    if args.json:
        print(json.dumps({"ok": True, "written": written}))
    return 0


def _export_points(points, out_path, fmt, name) -> int:
    """Minimal GPX/CSV/JSON writer - a HR + baro-altitude time series (no lat/lon). FIT falls
    back to JSON here; the mapped FIT is produced by legacy_merge once a Pod track is paired."""
    if fmt == "csv":
        lines = ["time,altitude_m,hr"]
        for p in points:
            lines.append(f"{p['time'].isoformat()},{p['ele'] if p['ele'] is not None else ''},"
                         f"{p['hr'] if p['hr'] is not None else ''}")
        text = "\n".join(lines) + "\n"
    elif fmt == "gpx":
        pts = "".join(
            f'<trkpt><time>{p["time"].isoformat()}</time>'
            f'{f"<ele>{p["ele"]}</ele>" if p["ele"] is not None else ""}'
            f'{f"<extensions><hr>{p["hr"]}</hr></extensions>" if p["hr"] is not None else ""}'
            f'</trkpt>' for p in points)
        text = ('<?xml version="1.0"?><gpx version="1.1" creator="suunto_x6hr.py">'
                f'<trk><name>{name}</name><trkseg>{pts}</trkseg></trk></gpx>\n')
    else:  # json / fit-fallback
        text = json.dumps({"name": name,
                           "points": [{**p, "time": p["time"].isoformat()} for p in points]},
                          indent=2)
    out_path.write_text(text)
    return len(text.encode("utf-8"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--device", metavar="PORT", help="serial port (default: autodetect)")
    ap.add_argument("--status", action="store_true", help="serial number + unit settings")
    ap.add_argument("--list", action="store_true", help="list logs on the device")
    ap.add_argument("--retrieve", type=int, metavar="N",
                    help="export log N (or -1 for all) - chrono logs carry samples")
    ap.add_argument("--out", metavar="FILE", help="output file for a single --retrieve")
    ap.add_argument("--out-dir", metavar="DIR", help="output dir for --retrieve -1")
    ap.add_argument("--format", default="gpx", choices=["gpx", "csv", "json", "fit"])
    ap.add_argument("--samples-out", metavar="FILE",
                    help="also write a legacy_merge sidecar (time/hr/altitude points)")
    ap.add_argument("--json", action="store_true", help="machine-readable output (for the backend)")
    args = ap.parse_args(argv)

    if args.status:
        return cmd_status(args)
    if args.list:
        return cmd_list(args)
    if args.retrieve is not None:
        return cmd_retrieve(args)
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
