#!/usr/bin/env python3
"""Read tracks off a real Suunto GPS Track Pod - EXPERIMENTAL, built blind (André, 2026-08-12:
"just blind, as experimental").

The GPS Track Pod is a different, older Suunto product from everything else this project
talks to: a standalone, hip-mounted GPS logger from the pre-GPS-watch Ambit1 era (idVendor
0x1493, same Suunto vendor as the watches, idProduct 0x0020 - its own, distinct product id).
It has no relation to the Ambit3/Traverse/Kailash CustomModes/route/settings work elsewhere in
this project; it is its own USB HID protocol and its own on-device filesystem.

WHY "BLIND": this project's whole methodology elsewhere is real hardware, real captures,
byte-exact verification before trusting a write - see tools/README.md and every *_roundtrip.py
self-test. None of that is possible here: nobody on this project owns a GPS Track Pod. This
wraps Ivor Wanders' gps_track_pod (tools/vendor/gpspod/, MIT, see tools/vendor/README.md),
unmodified, on the theory that its own 2016-2025 real-hardware development is the closest
thing to verification available - but it has never been exercised against a real device by
this project, on this Python version, through this project's own USB stack setup. Treat
anything it reports as unverified until someone with a real Track Pod confirms it.

Deliberately READ-ONLY. gpspod itself can also write settings/time/SGEE data to the device;
none of that is wired up here. A write path this project cannot test is exactly the kind of
risk PROJECT_RULES.md rule 5 (stay simple, match the hardware) and the "bounds-check before
write" habit exist to catch - there is no bound to check here, since nothing here has ever
touched a real device. If read-only proves out, writing is a deliberate, separate step.

    ./tools/gps_track_pod.py --status                          # device info + status
    ./tools/gps_track_pod.py --list                            # tracks on the device
    ./tools/gps_track_pod.py --retrieve 2 --out track.gpx       # one track as GPX
    ./tools/gps_track_pod.py --retrieve -1 --out-dir DIR        # every track as GPX
    ./tools/gps_track_pod.py --send-logs report.json.gz         # diagnostic bundle, see below
    ./tools/gps_track_pod.py --status --json                    # machine-readable, for the backend

SEND LOGS. gpspod's own interact.RecordingCommunicator already records every raw USB packet
exchanged: --send-logs runs --status, --list and (if the device offers one) its own internal
debug log through that recorder and writes the result to the given path (gzip-compressed JSON
if it ends in .gz). This is a real, complete diagnostic dump of one session - the closest
thing to giving a developer without the hardware something to debug against. Nothing is sent
anywhere automatically: this only writes a local file, the same "save it, then the user
decides where it goes" shape as LogService::revealLog() elsewhere in this project. No personal
activity data is in it - only protocol-level bytes, not decoded GPX content.
"""

import argparse
import json
import pathlib
import sys

VENDOR_ID = 0x1493
PRODUCT_ID = 0x0020

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))


def _device_present():
    """True if a GPS Track Pod is enumerable on USB right now - checked before opening so a
    missing device is a clean, expected answer rather than an exception from deep inside
    gpspod's own connect()."""
    import hid
    return bool(hid.enumerate(VENDOR_ID, PRODUCT_ID))


def _communicator(record_path=None):
    """A ready-to-use gpspod communicator. `hid` is the only backend this project has
    installed (see tools/write_nav.py) - gpspod prefers it automatically when pyusb is
    absent, same as everywhere else in this project."""
    from gpspod import interact
    if record_path is not None:
        return interact.RecordingCommunicator(path=str(record_path))
    return interact.Communicator()


def _open_device(communicator):
    from gpspod import device
    gps = device.GpsPod(communicator)
    gps.mount()
    return gps


def _header_to_dict(metadata):
    """A track's header, JSON-shaped - the same fields __main__.py's own CLI already prints
    (year/month/day/hour/minute/second/samples/distance), read defensively since this has
    never been checked against a real device's actual reply."""
    out = {}
    for key in ("year", "month", "day", "hour", "minute", "second", "samples", "distance"):
        try:
            out[key] = getattr(metadata, key)
        except AttributeError:
            pass
    return out


def cmd_status(args):
    if not _device_present():
        return {"ok": False, "error": f"no GPS Track Pod on USB "
                                       f"(idVendor={VENDOR_ID:#06x}, idProduct={PRODUCT_ID:#06x})"}
    from gpspod import protocol
    com = _communicator()
    try:
        with com:
            com.write_msg(protocol.DeviceInfoRequest())
            info_reply = com.read_msg()
            com.write_msg(protocol.DeviceStatusRequest())
            status_reply = com.read_msg()
    except Exception as exc:                                    # noqa: BLE001 - report, never mask
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return {
        "ok": True,
        "info": str(info_reply.body) if info_reply else None,
        "status": str(status_reply.body) if status_reply else None,
    }


def cmd_list(args):
    if not _device_present():
        return {"ok": False, "error": f"no GPS Track Pod on USB "
                                       f"(idVendor={VENDOR_ID:#06x}, idProduct={PRODUCT_ID:#06x})"}
    com = _communicator()
    try:
        with com:
            gps = _open_device(com)
            gps.load_tracks()
            tracks = gps.get_tracks()
            return {"ok": True, "tracks": [
                {"index": i, **_header_to_dict(t.get_header())}
                for i, t in enumerate(tracks)
            ]}
    except Exception as exc:                                    # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _write_gpx(track, index, out_path):
    from gpspod import output
    metadata = track.get_header()
    track.load_entries()
    samples = track.get_entries()
    writer = output.GPSWriter(samples, metadata=metadata, lap_splits_segment=True,
                              lap_adds_wpt=True, write_points=True, time_local=False)
    text = writer.create_xml()
    out_path.write_bytes(text)
    return len(text)


def cmd_retrieve(args):
    if not _device_present():
        return {"ok": False, "error": f"no GPS Track Pod on USB "
                                       f"(idVendor={VENDOR_ID:#06x}, idProduct={PRODUCT_ID:#06x})"}
    com = _communicator()
    try:
        with com:
            gps = _open_device(com)
            gps.load_tracks()
            tracks = gps.get_tracks()
            if args.retrieve != -1 and not (0 <= args.retrieve < len(tracks)):
                return {"ok": False, "error": f"track index {args.retrieve} out of range "
                                               f"(0..{len(tracks) - 1})"}
            targets = list(enumerate(tracks)) if args.retrieve == -1 else \
                [(args.retrieve, tracks[args.retrieve])]

            written = []
            for i, track in targets:
                if args.out_dir:
                    out_path = pathlib.Path(args.out_dir) / f"gpstrackpod_{i}.gpx"
                elif args.out:
                    out_path = pathlib.Path(args.out)
                else:
                    out_path = pathlib.Path(f"gpstrackpod_{i}.gpx")
                out_path.parent.mkdir(parents=True, exist_ok=True)
                size = _write_gpx(track, i, out_path)
                written.append({"index": i, "path": str(out_path), "bytes": size})
            return {"ok": True, "written": written}
    except Exception as exc:                                    # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def cmd_send_logs(args):
    if not _device_present():
        return {"ok": False, "error": f"no GPS Track Pod on USB "
                                       f"(idVendor={VENDOR_ID:#06x}, idProduct={PRODUCT_ID:#06x})"}
    out_path = pathlib.Path(args.send_logs)
    com = _communicator(record_path=out_path)
    report = {"ok": True, "steps": []}
    try:
        with com:
            from gpspod import protocol
            com.write_msg(protocol.DeviceInfoRequest())
            info_reply = com.read_msg()
            report["steps"].append({"step": "info", "ok": info_reply is not None})

            com.write_msg(protocol.DeviceStatusRequest())
            status_reply = com.read_msg()
            report["steps"].append({"step": "status", "ok": status_reply is not None})

            try:
                gps = _open_device(com)
                gps.load_tracks()
                report["steps"].append({"step": "tracks",
                                        "ok": True, "count": len(gps.get_tracks())})
            except Exception as exc:                              # noqa: BLE001
                report["steps"].append({"step": "tracks", "ok": False,
                                        "error": f"{type(exc).__name__}: {exc}"})

            try:
                gps.load_debug_logs()
                report["steps"].append({"step": "device_debug_log",
                                        "ok": True, "count": len(gps.get_debug_logs())})
            except Exception as exc:                              # noqa: BLE001
                report["steps"].append({"step": "device_debug_log", "ok": False,
                                        "error": f"{type(exc).__name__}: {exc}"})
    except Exception as exc:                                      # noqa: BLE001
        report = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "steps": report["steps"]}
    # RecordingCommunicator writes the raw-packet transcript on __exit__ (its own
    # write_json()), already saved to out_path by the time the `with` block above ends.
    report["log_path"] = str(out_path)
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="device info + status")
    ap.add_argument("--list", action="store_true", help="tracks on the device")
    ap.add_argument("--retrieve", type=int, metavar="INDEX",
                    help="retrieve one track (-1 for every track) as GPX")
    ap.add_argument("--out", metavar="FILE", help="GPX output path, with --retrieve")
    ap.add_argument("--out-dir", metavar="DIR",
                    help="GPX output directory (one file per track), with --retrieve -1")
    ap.add_argument("--send-logs", metavar="FILE",
                    help="diagnostic bundle path (.json or .json.gz) - see this file's own "
                         "module docstring")
    ap.add_argument("--json", action="store_true", help="machine-readable result")
    args = ap.parse_args()

    if args.retrieve is not None:
        result = cmd_retrieve(args)
    elif args.send_logs:
        result = cmd_send_logs(args)
    elif args.list:
        result = cmd_list(args)
    elif args.status:
        result = cmd_status(args)
    else:
        ap.print_help()
        return 1

    if args.json:
        print(json.dumps(result))
    else:
        print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
