#!/usr/bin/env python3
"""Confronts the C sport-modes serializer with the Python reference: runs
csrc/build/sport_modes_harness (which builds one hardcoded mode + two sport-mode slots,
the same values tools/custom_modes_write.py's _selftest() uses), and demands the region
bytes be byte-for-byte identical to what custom_modes_write.py produces for the same input.
Same cross-check convention as tools/c_reference.py, for the new BXml-format encoder.

    make -C csrc test
"""

import pathlib
import struct
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
HARNESS = ROOT / "csrc" / "build" / "sport_modes_harness"

sys.path.insert(0, str(HERE))
from custom_modes_write import build_custom_modes_body  # noqa: E402


def python_region():
    settings = {
        "Name": "Openwater swim", "ActivityID": 0x53, "CustomModeID": 60596,
        "UseHw": 0x0003, "AltiBaroMode": 1, "GpsPowerMode": 0, "RecordingInterval": 0,
        "Autolap": 0, "HrHigh": 0, "HrLow": 0, "HrLimitsUse": 0, "AutoStart": 0,
        "AutoPause": 0, "AutoScrolling": 0, "IntTimerFlags": 0, "IntTimerCount": 0,
        "IntervalSlots": [{"Flags": 0, "Type": 0, "MaxLimit": 0, "MinLimit": 0, "Padding": 0,
                            "Len": 0}] + [{"Flags": 0, "Type": 0, "MaxLimit": 0, "MinLimit": 0}
                                          for _ in range(5)],
    }
    mode = {
        "Settings": settings,
        "Displays": [{
            "Template": 0x0107, "Type": 0,
            "Fields": [{"Index": 0x18, "Type": 8, "Shortcuts": [0, 8]},
                       {"Index": 0x19, "Type": 4, "Shortcuts": []}],
        }],
        "Rules": [{"RuleIdx": 0, "UseRule": True, "LogRule": False}],
        "AppMeta": {"Timestamp1": 1785000000, "Timestamp2": 1785000002},
    }
    cycling = {"Name": "Cycling", "ActivityID": 4, "Exercises": [2], "Order": 2,
               "AppMeta": 1786034231}
    triathlon = {"Name": "Triathlon", "ActivityID": 0x13, "Exercises": [0, 1, 2, 1, 3],
                 "Order": 10, "AppMeta": None}
    full = {"format_type": 2, "exercise_modes": [mode], "sport_modes": [cycling, triathlon]}
    body = build_custom_modes_body(full)
    return body.ljust(12288, b"\xff"), len(body)


def run_harness():
    proc = subprocess.run([str(HARNESS)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"harness failed: {proc.stderr.strip()}")
    body_len = None
    region = None
    for line in proc.stdout.splitlines():
        if line.startswith("BODY_LEN "):
            body_len = int(line.split()[1])
        elif line.startswith("REGION "):
            region = bytes.fromhex(line.split()[1])
    if region is None or body_len is None:
        raise RuntimeError("harness produced no output")
    return region, body_len


def main():
    if not HARNESS.exists():
        print(f"SKIP sport_modes_c_reference: {HARNESS} not built (make -C csrc)")
        return 0

    py_region, py_len = python_region()
    c_region, c_len = run_harness()

    if py_len != c_len:
        print(f"FAIL body length: python={py_len} c={c_len}")
        return 1
    if py_region != c_region:
        for i in range(len(py_region)):
            if py_region[i] != c_region[i]:
                print(f"FAIL byte {i}: python={py_region[i]:02x} c={c_region[i]:02x}")
                print(f"  python context: {py_region[max(0,i-8):i+8].hex()}")
                print(f"  c      context: {c_region[max(0,i-8):i+8].hex()}")
                break
        return 1

    print(f"OK sport_modes_c_reference: {py_len}-byte body, C and Python byte-identical "
          f"({len(py_region)}-byte region)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
