#!/usr/bin/env python3
"""Generate the fixtures behind the app's Testing mode.

Real request, 2026-08-11 (André): "add on feature on settings: testing mode, where it
simulates that an ambit 3 is connected, so people can test it without the watch."

WHAT IT IS. Testing mode makes the backend answer from these files instead of talking to USB,
so the whole app - sport modes, displays, the row editor, settings - can be explored with no
watch attached. It is for trying the app out, and for us to reproduce a UI bug without
occupying the real device.

WHY THE FIXTURE IS A REAL REGION. The CustomModes fixture is a genuine flash image lifted
from a capture, not something hand-built: that way Testing mode exercises the SAME decoder,
encoder and round-trip check the real watch does. A synthetic blob would prove nothing and
would drift from the format the moment either changed.

WHAT IS SCRUBBED. Two things never leave this machine in a fixture:

  * the settings blob, which carries the paired phone's BLE bond keys (IdentityResolvingKey,
    EncodingKey) and a Movescount UserKey. The settings fixture is therefore built from the
    DECODED, curated field list with plain values, never from a raw payload.
  * anything identifying. The serial is a visible fake, and the one non-stock sport-mode name
    in the capture ("Running2", André's own) is renamed to a neutral one.

    ./tools/gen_demo_data.py            # writes desktop/backend/demo_data/
    ./tools/gen_demo_data.py --check    # exit 1 if the files are missing or stale
"""

import argparse
import json
import os
import sys

import custom_modes
import custom_modes_write
import settings_write
from custom_modes_roundtrip import region_images

HERE = os.path.dirname(__file__)
CAPTURE = os.path.join(HERE, "..", "assets", "pcap", "running2fromcreateandthen1to7")
OUT_DIR = os.path.join(HERE, "..", "desktop", "backend", "demo_data")

# The one non-stock name in the capture is André's own; everything else is a Suunto default.
RENAME = {"Running2": "Trail running"}

DEVICE = {
    "ok": True,
    "model": "Emu",                       # AMBIT3_P, the codename our tools already use
    "name": "Suunto Ambit3 Peak",
    "serial": "DEMO000000000",            # visibly not a real serial
    "fw_version": "2.4.17",
    "hw_version": "70.2.17414",
    "battery_percent": 76,
    "demo": True,
}


def build_custom_modes():
    """A real CustomModes region, with the one personal mode name replaced."""
    images = region_images(os.path.normpath(CAPTURE))
    if not images:
        raise SystemExit("no CustomModes region images in the capture")
    decoded = custom_modes.decode(images[0])

    for mode in decoded["exercise_modes"]:
        name = mode.get("Settings", {}).get("Name")
        if name in RENAME:
            mode["Settings"]["Name"] = RENAME[name]
    for slot in decoded["sport_modes"]:
        if slot.get("Name") in RENAME:
            slot["Name"] = RENAME[slot["Name"]]

    body = custom_modes_write.build_custom_modes_body(
        decoded, format_type=decoded.get("format_type", 2))

    # The same standard every real write is held to: the bytes we ship must decode back to
    # what we meant. A fixture that cannot round-trip would send anyone using Testing mode
    # chasing a bug that only exists in the fixture.
    check = custom_modes.decode(body)
    names = [m["Settings"].get("Name") for m in check["exercise_modes"]]
    if any(n in RENAME for n in names):
        raise SystemExit("rename did not take")
    return body, names


def build_settings():
    """Plain values for the curated Ambit3 fields - built from names, never from a payload.

    Deliberately NOT a captured 0x1100 reply: that carries the paired phone's bond keys.
    """
    return {
        "ok": True,
        "demo": True,
        "settings": {
            "language":            {"ok": True, "value": 0, "label": "Language",
                                    "kind": "enum", "control": "dropdown", "writable": True,
                                    "screen": "general", "path": "sml.DeviceSettings.Units.Language",
                                    "choices": [[0, "English"], [1, "Français"]]},
            "units_mode":          {"ok": True, "value": 0, "label": "Units", "kind": "enum",
                                    "control": "radio", "writable": True, "screen": "units",
                                    "path": "sml.DeviceSettings.Units.Mode",
                                    "choices": [[0, "Metric"], [1, "Imperial"], [2, "Advanced"]]},
            "date_format":         {"ok": True, "value": 0, "label": "Date", "kind": "enum",
                                    "control": "radio", "writable": True, "screen": "units",
                                    "path": "sml.DeviceSettings.Date.Format",
                                    "choices": [[0, "DD.MM."], [1, "MM/DD"]]},
            "time_format":         {"ok": True, "value": 0, "label": "Time", "kind": "enum",
                                    "control": "radio", "writable": True, "screen": "units",
                                    "path": "sml.DeviceSettings.Time.Format",
                                    "choices": [[0, "24 hours"], [1, "12 hours"]]},
            "body_weight":         {"ok": True, "value": 74.0, "label": "Weight",
                                    "kind": "number", "control": "slider", "writable": True,
                                    "screen": "personal", "unit": "kg", "min": 30.0, "max": 250.0,
                                    "path": "sml.DeviceSettings.Personal.Weight"},
            "body_height":         {"ok": True, "value": 178, "label": "Height",
                                    "kind": "number", "control": "slider", "writable": True,
                                    "screen": "personal", "unit": "cm", "min": 89, "max": 241,
                                    "path": "sml.DeviceSettings.Personal.Height"},
            "max_hr":              {"ok": True, "value": 186, "label": "Max heart rate",
                                    "kind": "number", "control": "slider", "writable": True,
                                    "screen": "personal", "unit": "bpm", "min": 30, "max": 240,
                                    "path": "sml.DeviceSettings.Personal.MaxHR"},
            "rest_hr":             {"ok": True, "value": 52, "label": "Rest heart rate",
                                    "kind": "number", "control": "slider", "writable": True,
                                    "screen": "personal", "unit": "bpm", "min": 30, "max": 240,
                                    "path": "sml.DeviceSettings.Personal.RestHR"},
            # Choices come from settings_write's own table, not retyped: a fixture that
            # disagrees with the real path would have someone debugging the app over a
            # difference that only exists in Testing mode. Found exactly that way - the
            # dropdown came up empty here while working fine against the watch.
            "activity_level":      {"ok": True, "value": 6.0, "label": "Activity class",
                                    "kind": "number", "control": "dropdown", "writable": True,
                                    "screen": "personal", "min": 1.0, "max": 10.0,
                                    "path": "sml.DeviceSettings.Personal.ActivityLevel",
                                    "choices": [[v, lbl] for v, lbl in
                                                settings_write.AMBIT3_NUMERIC_CHOICES[
                                                    "Personal.ActivityLevel"]]},
            "display_contrast":    {"ok": True, "value": 50, "label": "Display contrast",
                                    "kind": "number", "control": "readonly", "writable": False,
                                    "path": "sml.DeviceSettings.Display.Contrast",
                                    "note": "Changed on the watch itself: Settings > General > "
                                            "Display > Contrast. No app can write it."},
            "display_dark":        {"ok": True, "value": 1, "label": "Display", "kind": "enum",
                                    "control": "radio", "writable": True, "screen": "general",
                                    "path": "sml.DeviceSettings.Display.Invert",
                                    "choices": [[0, "Light"], [1, "Dark"]]},
            "backlight_brightness": {"ok": True, "value": 50, "label": "Backlight brightness",
                                     "kind": "number", "control": "slider", "writable": True,
                                     "screen": "general", "unit": "%", "min": 5, "max": 100,
                                     "path": "sml.DeviceSettings.Display.Backlight.Brightness"},
            "tones":               {"ok": True, "value": 1, "label": "Tones", "kind": "bool",
                                    "control": "checkbox", "writable": True, "screen": "general",
                                    "path": "sml.DeviceSettings.Audio.Mode"},
            "storm_alarm":         {"ok": True, "value": 0, "label": "Storm alarm",
                                    "kind": "bool", "control": "checkbox", "writable": True,
                                    "screen": "general", "path": "sml.DeviceSettings.AltiBaro.StormAlarm"},
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the fixtures are stale")
    args = ap.parse_args()

    out = os.path.normpath(OUT_DIR)
    body, names = build_custom_modes()
    settings = build_settings()

    files = {
        "custommodes.bin": body,
        "device.json": (json.dumps(DEVICE, indent=2) + "\n").encode(),
        "settings.json": (json.dumps(settings, indent=2) + "\n").encode(),
    }

    if args.check:
        stale = []
        for name, data in files.items():
            path = os.path.join(out, name)
            if not os.path.exists(path) or open(path, "rb").read() != data:
                stale.append(name)
        print("demo fixtures are up to date" if not stale
              else f"STALE: {', '.join(stale)} - re-run without --check")
        return 1 if stale else 0

    os.makedirs(out, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(out, name), "wb") as fh:
            fh.write(data)
    print(f"wrote {os.path.relpath(out)}: {len(body)} B CustomModes "
          f"({len(names)} modes), device.json, settings.json")
    print(f"  modes: {', '.join(str(n) for n in names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
