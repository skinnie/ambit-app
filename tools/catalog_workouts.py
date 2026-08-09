#!/usr/bin/env python3
"""Browse and export pre-compiled Suunto App / workout apps from the official SuuntoLink catalog
for installation on a real watch.

Why this exists (training_program_andre.md Finding 41, hardware-proven): this project's
Apps/CustomModes installer is correct, and OFFICIAL catalog binaries EXECUTE on the watch - but
binaries from the live community App-Zone compiler do NOT run on Ambit3. So the real, working way
to put interval/HR/workout guidance on the watch today is to install a *pre-compiled* app from
the official catalog (thousands of them, incl. ~1300+ interval/workout apps), via
`workout_install.py`. This tool finds/filters the catalog and exports a chosen app as the
compiled-JSON (`{name, activityId, binary}`) that `workout_install.py` already consumes.

    ./tools/catalog_workouts.py --workouts --device "Ambit3 Peak"      # list installable workouts
    ./tools/catalog_workouts.py --search "tabata"
    ./tools/catalog_workouts.py --show 10013044
    ./tools/catalog_workouts.py --export 10013044 --out /tmp/tabata.json
    #   then: ./tools/workout_install.py /tmp/tabata.json --mode 6 --display 0 --field 0 --write

No compiler, no network, no account - the catalog is a local file (SuuntoLink's own bundle).
"""

import argparse
import glob
import json
import os
import re
import sys

# history.md's confirmed product codename table (compatibleVariants uses codenames).
CODENAMES = {
    "Ambit": "Bluebird", "Ambit2": "Duck", "Ambit2 S": "Colibri", "Ambit2 R": "Greentit",
    "Ambit3 Peak": "Emu", "Ambit3 Sport": "Finch", "Ambit3 Run": "Ibisbill",
    "Ambit3 Vertical": "Kaka", "Traverse": "Jabiru",
}
# App Zone category ids (from the catalog's own grouping; interval/HR workouts cluster in a few).
WORKOUT_RX = re.compile(
    r"interval|workout|tabata|pyramid|fartlek|\bhr\b|heart\s*rate|zone|pacer|pace|tempo|"
    r"sprint|recovery|threshold|vo2|repeat|10-20-30|30-20-10", re.I)


def find_catalog(explicit=None):
    if explicit:
        return explicit
    # 1) a real local SuuntoLink install (reuse suuntolink_catalog's own locator)
    try:
        import suuntolink_catalog
        hits = suuntolink_catalog.find_index_json()
        if hits:
            return hits[0]
    except Exception:
        pass
    # 2) this repo's bundled asset copies (for dev / when SuuntoLink isn't installed)
    here = os.path.dirname(__file__)
    for pat in ("../assets/**/suunto-apps/index.json",
                "../assets/issue_workout_builder_windows/index.json"):
        found = sorted(glob.glob(os.path.join(here, pat), recursive=True))
        if found:
            return found[0]
    return None


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--catalog", help="index.json path (default: auto - SuuntoLink install or"
                                       " bundled asset)")
    ap.add_argument("--device", default="Ambit3 Peak",
                     help="device name or codename to filter compatibleVariants (default"
                          " 'Ambit3 Peak'); use 'any' to skip the compatibility filter")
    ap.add_argument("--search", metavar="TEXT", help="name/description substring")
    ap.add_argument("--activity", type=int, help="filter by activityId")
    ap.add_argument("--category", type=int, help="filter by categoryId")
    ap.add_argument("--workouts", action="store_true",
                     help="only interval/HR/workout-type apps (name heuristic)")
    ap.add_argument("--show", type=int, metavar="RULEID", help="print one app's full details")
    ap.add_argument("--export", type=int, metavar="RULEID",
                     help="write the app as a workout_install-ready compiled JSON")
    ap.add_argument("--out", metavar="FILE", help="output path for --export")
    ap.add_argument("--limit", type=int, default=40, help="max rows to list")
    args = ap.parse_args()

    path = find_catalog(args.catalog)
    if not path:
        sys.exit("no catalog found - pass --catalog PATH (SuuntoLink's suunto-apps/index.json)")
    catalog = load(path)
    print(f"catalog: {path}  ({len(catalog)} apps)", file=sys.stderr)

    by_id = {e.get("ruleId"): e for e in catalog}

    if args.show is not None or args.export is not None:
        rid = args.show if args.show is not None else args.export
        e = by_id.get(rid)
        if not e:
            sys.exit(f"ruleId {rid} not in catalog")
        if args.export is not None:
            rec = {"name": e["name"], "activityId": e.get("activityId", 0),
                   "binary": e["binary"]}
            out = args.out or f"catalog_{rid}.json"
            with open(out, "w") as f:
                json.dump(rec, f)
            print(f"exported ruleId {rid} ({e['name']!r}) -> {out}\n"
                  f"install with: ./tools/workout_install.py {out} --mode M --display D"
                  f" --field F --write")
            return 0
        print(f"ruleId {rid}: {e['name']!r}")
        print(f"  activityId={e.get('activityId')} categoryId={e.get('categoryId')}"
              f" userCount={e.get('userCount')} binary_bytes={len(e.get('binary', []))}")
        print(f"  compatibleVariants={e.get('compatibleVariants')}")
        if e.get("description"):
            print(f"  {e['description']}")
        return 0

    codename = CODENAMES.get(args.device, args.device)
    sel = catalog
    if args.device.lower() != "any":
        sel = [e for e in sel if codename in e.get("compatibleVariants", [])]
    if args.activity is not None:
        sel = [e for e in sel if e.get("activityId") == args.activity]
    if args.category is not None:
        sel = [e for e in sel if e.get("categoryId") == args.category]
    if args.workouts:
        sel = [e for e in sel if WORKOUT_RX.search(
            (e.get("name", "") + " " + (e.get("description") or "")))]
    if args.search:
        q = args.search.lower()
        sel = [e for e in sel if q in (e.get("name", "") + " " + (e.get("description") or "")).lower()]

    sel.sort(key=lambda e: -(e.get("userCount") or 0))  # most-used first
    for e in sel[:args.limit]:
        print(f"{e.get('ruleId'):>10}  act{e.get('activityId'):<3} cat{e.get('categoryId')}"
              f"  users{(e.get('userCount') or 0):<7} {e.get('name', '')[:52]}")
    print(f"\n{len(sel)} app(s) for {args.device} ({codename})"
          + (f", showing top {args.limit}" if len(sel) > args.limit else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
