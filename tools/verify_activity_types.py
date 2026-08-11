#!/usr/bin/env python3
"""Check assets/activity_types.json against Suunto's own published activity-id table.

assets/activity_types.json drives the activity picker, the badges and the per-activity row
menus, and its ids are written into real sport modes - a wrong id names the wrong sport on
the watch. The list was built from SuuntoLink 4.1.15's assets, so it deserves a second,
independent source.

That source is Suunto's "Suunto Apps Developer Manual" (Apr 2, 2015) -
assets/manuals/SuuntoAppZoneDeveloperManual.pdf, the SUUNTO_ACTIVITY_TYPE table on p.29 -
transcribed verbatim below. It is Movescount-era and therefore OLDER than SuuntoLink 4.1.15,
so our file is expected to be a superset: the check is that every id the manual publishes is
present and does not contradict us, not that the two are identical.

    ./tools/verify_activity_types.py            # 0 if nothing contradicts the manual
    ./tools/verify_activity_types.py --names    # also list wording differences
"""

import argparse
import json
import os
import re
import sys

ACTIVITIES = os.path.join(os.path.dirname(__file__), "..", "assets", "activity_types.json")

# Verbatim from the manual, p.29 (SUUNTO_ACTIVITY_TYPE, "ID, list of activities below").
MANUAL = {
    1: "Not specified sport", 2: "Multisport", 3: "Run", 4: "Cycling", 5: "MountainBiking",
    6: "Swimming", 8: "Skating", 9: "Aerobics", 10: "YogaPilates", 11: "Trekking",
    12: "Walking", 13: "Sailing", 14: "Kayaking", 15: "Rowing", 16: "Climbing",
    17: "Indoor cycling", 18: "Circuit training", 19: "Triathlon", 20: "Alpine skiing",
    21: "Snowboarding", 22: "Crosscountry skiing", 23: "Weight training", 24: "Basketball",
    25: "Soccer", 26: "Ice Hockey", 27: "Volleyball", 28: "Football", 29: "Softball",
    30: "Cheerleading", 31: "Baseball", 33: "Tennis", 34: "Badminton", 35: "Table tennis",
    36: "Racquet ball", 37: "Squash", 38: "Combat sport", 39: "Boxing", 40: "Floorball",
    51: "Scuba diving", 52: "Free diving", 61: "Adventure Racing", 62: "Bowling",
    63: "Cricket", 64: "Cross trainer", 65: "Dancing", 66: "Golf", 67: "Gymnastics",
    68: "Handball", 69: "Horseback riding", 70: "Ice Skating", 71: "Indoor Rowing",
    72: "Canoeing", 73: "Motorsports", 74: "Mountaineering", 75: "Orienteering", 76: "Rugby",
    78: "Ski Touring", 79: "Stretching", 80: "Telemark skiing", 81: "Track and Field",
    82: "Trail Running", 83: "Open water swimming", 84: "Nordic walking", 85: "Snow shoeing",
    86: "Windsurfing/Surfing", 87: "Kettlebell", 88: "Roller skiing",
    89: "Standup paddling (SUP)", 90: "Cross fit", 91: "Kitesurfing/Kiting",
    92: "Paragliding", 93: "Treadmill", 94: "Frisbee", 95: "Indoor training",
}

# Wording SuuntoLink 4.1.15 updated after the 2015 manual. Each of these is OUR name winning
# deliberately, because SuuntoLink is the newer source and is what the user sees in it.
KNOWN_RENAMES = {
    1: "the manual's generic 'Not specified sport'",
    3: "'Run' became 'Running'",
    6: "'Swimming' became 'Pool swimming', now that 83 is Open water swimming",
    8: "'Skating' became 'Roller skating', distinct from 70 Ice Skating",
    25: "'Soccer' became 'Soccer / football'",
    28: "'Football' became 'American football', to disambiguate from 25",
    38: "'Combat sport' became 'Martial arts'",
    86: "'Windsurfing/Surfing' became 'Windsurfing', now that 54 is Surfing",
    89: "punctuation only",
    90: "'Cross fit' became 'Cross training'",
}


def normalise(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--names", action="store_true", help="list wording differences too")
    args = ap.parse_args()

    with open(os.path.normpath(ACTIVITIES)) as fh:
        ours = {a["id"]: a["name"] for a in json.load(fh)}

    missing = sorted(set(MANUAL) - set(ours))
    extra = sorted(set(ours) - set(MANUAL))
    renamed = [i for i in sorted(set(MANUAL) & set(ours))
               if normalise(MANUAL[i]) != normalise(ours[i])]

    print(f"manual publishes {len(MANUAL)} ids; assets/activity_types.json carries {len(ours)}")
    print(f"  present in ours          : {len(MANUAL) - len(missing)}/{len(MANUAL)}")
    print(f"  newer than the manual    : {len(extra)}  "
          f"({', '.join(f'{i} {ours[i]}' for i in extra) if extra else 'none'})")
    print(f"  wording differences      : {len(renamed)}")

    if args.names:
        for i in renamed:
            note = KNOWN_RENAMES.get(i, "NOT a known rename - check this")
            print(f"      {i:<4} manual={MANUAL[i]:<24} ours={ours[i]:<22} {note}")

    unexplained = [i for i in renamed if i not in KNOWN_RENAMES]
    if missing:
        print(f"\n  MISSING - the manual publishes these and we do not have them: {missing}")
    if unexplained:
        print(f"\n  UNEXPLAINED renames, worth checking: {unexplained}")
    if not missing and not unexplained:
        print("\nnothing contradicts the manual")
    return 1 if (missing or unexplained) else 0


if __name__ == "__main__":
    sys.exit(main())
