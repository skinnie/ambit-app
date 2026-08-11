#!/usr/bin/env python3
"""Maps SuuntoLink's row menu onto the watch's display-field ids.

Two numbering systems meet here and they are NOT the same:

  * `assets/sportmode_rows.json` carries SuuntoLink's own `DisplayRow` enum - its UI
    numbering, generated from its own module (tools/gen_sportmode_rows.js). It answers
    "what may the user choose on this row of this display for this sport?"
  * `custom_modes.FIELD_TYPES` carries the watch's field ids, verified 68/68 against
    SuuntoLink's own desktop binary (tools/verify_field_types.py). It answers "what byte
    goes on the wire?"

SuuntoLink's row 10 is BikePower3sAvg; the watch's field 10 is Distance. Anything that edits
a row has to cross that gap, and crossing it wrongly writes a plausible-looking wrong value
onto a real watch - so the mapping below is explicit, one line per row, never fuzzy-matched.
Rows with no known field id are simply absent: a row we cannot write is better left out of
the menu than guessed at.

    ./tools/row_bridge.py            # coverage report
    ./tools/row_bridge.py --check    # also replay every capture through it; 1 on failure
"""

import argparse
import glob
import json
import os
import sys

import custom_modes

ROWS_JSON = os.path.join(os.path.dirname(__file__), "..", "assets", "sportmode_rows.json")

# SuuntoLink DisplayRow name -> our FT_ symbol. Every pair is a name both sides agree on,
# or one André read off SuuntoLink against a real watch screen (2026-08-11).
ROW_TO_FIELD = {
    "AirPressure": "FT_BARO",
    "Altitude": "FT_ALTI",
    "Ascent": "FT_ASCENT",
    "AverageHeartRate": "FT_HEART_RATE_AVG",
    "AveragePace": "FT_AVG_PACE",
    "AverageSpeed": "FT_AVGSPEED",
    "Barograph": "FT_BARO_GRAPH",
    "BatteryCharge": "FT_BATTERY_CHARGE",
    "BikePower": "FT_BIKE_POWER",
    "BikePowerAvg": "FT_BIKE_POWER_AVG",
    "BikePower3sAvg": "FT_BIKE_POWER_3S",
    "BikePower10sAvg": "FT_BIKE_POWER_10S",
    "BikePower30sAvg": "FT_BIKE_POWER_30S",
    "BikePowerLap": "FT_BIKE_POWER_LAP",
    "BikePowerLapMax": "FT_BIKE_POWER_LAP_MAX",
    "Cadence": "FT_CADENCE",
    "Calories": "FT_TOTAL_CALORIES",
    "CurrentActivityDistance": "FT_SPORT_LAP_DISTANCE",
    "CurrentActivityDuration": "FT_SPORT_LAP_STOPWATCH",
    "CurrentActivityAvgSpeed": "FT_SPORT_LAP_AVGSPEED",
    "CurrentActivityAvgPace": "FT_SPORT_LAP_AVG_PACE",
    "Descent": "FT_DESCENT",
    "Distance": "FT_DISTANCE",
    "DualTime": "FT_DUAL_TIME",
    # "Empty" is deliberately NOT mapped. SuuntoLink offers it, and FT_SHORTCUT (0x00) is the
    # obvious candidate since that is the marker a multi-value row carries in its Type slot -
    # but no row with Type=0 and no shortcuts appears anywhere in the 118 captured region
    # images, so we have never seen what SuuntoLink actually writes for it. Offering it would
    # mean inventing a write shape. Settle it the way the swim rows were settled: set a row
    # to Empty in SuuntoLink, save, and read which bytes changed.
    "HeartRate": "FT_HEART_RATE_CURR",
    "Lap": "FT_LAP_NUMBER",
    "LapDistance": "FT_LAP_DISTANCE",
    "LapPace": "FT_LAP_AVG_PACE",
    "LapTime": "FT_LAP_TIME",
    "Pace": "FT_PACE",
    "PeakTrainingEffect": "FT_TE",
    "RunningPerformance": "FT_RUNNING_PERFORMANCE",
    "Speed": "FT_VELOCITY",
    # SuuntoLink calls this row "Stopwatch" and LABELS it "Chrono", with the triple
    # {Current, Duration, Move} - plain move duration, which is FT_TIMER. It is NOT
    # FT_STOPWATCH_ABC (the watch's own ABC stopwatch), which an earlier draft of this table
    # had. Confirmed by André reading a display we wrote as "distance, speed, chrono" whose
    # bottom row was FT_TIMER.
    "Stopwatch": "FT_TIMER",
    "SwimmingAvgPace": "FT_SWIM_AVG_PACE",
    "SwimmingAvgStrokeRate": "FT_SWIM_AVG_STROKE_RATE",
    "SwimmingIntervalDuration": "FT_SWIM_INT_TIME",
    "SwimmingIntervalPace": "FT_SWIM_INT_PACE",
    "SwimmingIntervalStrokeRate": "FT_SWIM_INT_STROKE_RATE",
    "SwimmingIntervalSWOLF": "FT_SWIM_INT_SWOLF",
    "SwimmingLapDistance": "FT_SWIM_LAP_DISTANCE",
    "SwimmingLapStrokeRate": "FT_SWIM_LAP_RATE",
    "SwimmingLapSWOLF": "FT_SWIM_LAP_SWOLF",
    "SwimmingLastIntervalStrokeCount": "FT_SWIM_INT_STROKES",
    "SwimmingLastStrokeType": "FT_SWIM_STYLE",
    "SwimmingPace": "FT_SWIM_PACE",
    "SwimmingRestTime": "FT_SWIM_REST_TIME",
    "SwimmingStrokeRate": "FT_SWIM_STROKES",
    "SwimmingTotalAvgSWOLF": "FT_SWIM_AVG_SWOLF",
    "SwimmingTotalDistance": "FT_SWIM_TOTAL_DISTANCE",
    "Temperature": "FT_TEMPERATURE",
    "Time": "FT_TIME",
    "VerticalSpeed": "FT_VERTICAL_SPEED",
}

_BY_NAME = {name: fid for fid, name in custom_modes.FIELD_TYPES.items()}

# Field ids that appear on real displays but are deliberately NOT rows in SuuntoLink's menu,
# so having no mapping for them is correct rather than a gap:
#
#   * FT_RULE_ENGINE_* - the five Suunto App slots. An app is picked from the app list, not
#     the row list, and lands on a row afterwards. The app picker handles these.
#   * the *_GRAPH fields - a graph display stores (value, that value's graph, bottom row) and
#     SuuntoLink's own model only holds two entries for it, so the graph field is GENERATED
#     from the chosen value rather than chosen. Offering it in a menu would be wrong.
_NOT_ROWS = {
    "FT_RULE_ENGINE_0", "FT_RULE_ENGINE_1", "FT_RULE_ENGINE_2",
    "FT_RULE_ENGINE_3", "FT_RULE_ENGINE_4",
    "FT_RULE_ENGINE_1_GRAPH", "FT_RULE_ENGINE_3_GRAPH",
    "FT_HEART_RATE_GRAPH", "FT_EXERCISE_ALTI_GRAPH", "FT_ALTI_GRAPH", "FT_BARO_GRAPH",
    "FT_RUNNING_PERFORMANCE_GRAPH",
}


def load_rows():
    with open(os.path.normpath(ROWS_JSON)) as fh:
        return json.load(fh)


def row_to_field_id(row_name):
    """The watch field id for a SuuntoLink row name, or None if we cannot write it."""
    return _BY_NAME.get(ROW_TO_FIELD.get(row_name, ""))


def field_id_to_row(catalogue):
    """{field id: row id} - the inverse, for showing a decoded display in SuuntoLink's terms."""
    out = {}
    for rid, row in catalogue["rows"].items():
        fid = row_to_field_id(row["name"])
        if fid is not None:
            out[fid] = int(rid)
    return out


TEMPLATE_TO_DISPLAY_TYPE = {262: "FIELDS_1", 261: "FIELDS_2", 260: "FIELDS_3", 257: "GRAPH"}

# Which rows accept SEVERAL values, the ones the watch cycles between on a button press.
# SuuntoLink renders checkboxes instead of radio buttons exactly when the display is a 2- or
# 3-field one AND the row is the bottom (sport_mode_display_editor.js), so a graph's bottom
# row takes a single value - which matches every graph in every capture.
def row_is_multi_value(template, row_name):
    return (TEMPLATE_TO_DISPLAY_TYPE.get(template) in ("FIELDS_2", "FIELDS_3")
            and row_name == "BOTTOM")


def allowed_field_ids(catalogue, activity_id, template, row_name):
    """The watch field ids SuuntoLink would offer for this row, or None if it has no menu.

    Keyed the way SuuntoLink keys it: by the mode's activity, the display's type and which
    row. Ids we cannot write are dropped here rather than offered and then failing."""
    per_type = catalogue["availability"].get(str(activity_id))
    if not per_type:
        return None
    per_row = per_type.get(TEMPLATE_TO_DISPLAY_TYPE.get(template, ""), {})
    index = per_row.get(row_name)
    if index is None:
        return None
    out = []
    for _category, row_ids in catalogue["menus"][index]:
        for rid in row_ids:
            fid = row_to_field_id(catalogue["rows"][str(rid)]["name"])
            if fid is not None:
                out.append(fid)
    return out


def coverage(catalogue):
    mapped, unmapped = {}, []
    for rid, row in catalogue["rows"].items():
        fid = row_to_field_id(row["name"])
        if fid is None:
            unmapped.append((int(rid), row["name"], row["label"]))
        else:
            mapped[int(rid)] = fid
    return mapped, unmapped


def replay_captures(catalogue):
    """Every field id SuuntoLink ever wrote should be one we can name AND map back.

    This is the check that matters: the bridge is only trustworthy if the ids that appear in
    real captured writes all round-trip through it. An id we cannot map is a row the editor
    would silently be unable to offer."""
    from custom_modes_roundtrip import region_images
    inverse = field_id_to_row(catalogue)
    seen, unmappable = set(), {}
    for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..",
                                              "assets", "pcap", "*"))):
        if not os.path.isfile(path):
            continue
        try:
            images = region_images(path)
        except Exception:                       # not a readable capture
            continue
        for blob in images:
            try:
                decoded = custom_modes.decode(blob)
            except Exception:
                continue
            for mode in decoded["exercise_modes"]:
                for display in mode["Displays"]:
                    if display.get("Type") != 10:
                        continue
                    for field in display.get("Fields") or []:
                        ids = [field.get("Type")] + list(field.get("Shortcuts") or [])
                        for fid in ids:
                            if not fid:
                                continue
                            seen.add(fid)
                            name = custom_modes.FIELD_TYPES.get(fid, "?")
                            if fid not in inverse and name not in _NOT_ROWS:
                                unmappable[fid] = name
    return seen, unmappable


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="also replay every capture through the bridge")
    args = ap.parse_args()

    catalogue = load_rows()
    mapped, unmapped = coverage(catalogue)
    print(f"SuuntoLink rows mapped to a watch field: {len(mapped)} / "
          f"{len(catalogue['rows'])}")
    if unmapped:
        print("\nnot writable by us yet - deliberately absent from the menu:")
        for rid, name, label in unmapped:
            print(f"    {rid:<4} {name:<34} {label}")

    if not args.check:
        return 0

    seen, unmappable = replay_captures(catalogue)
    print(f"\ndistinct field ids used across every capture: {len(seen)}")
    if unmappable:
        print("  ids SuuntoLink wrote that the bridge cannot map back:")
        for fid, name in sorted(unmappable.items()):
            print(f"    {fid:#06x} {name}")
    else:
        print("  every one maps back through the bridge")
    return 1 if unmappable else 0


if __name__ == "__main__":
    sys.exit(main())
