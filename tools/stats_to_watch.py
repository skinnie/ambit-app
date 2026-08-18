#!/usr/bin/env python3
"""Write an athlete's intervals.icu personal stats onto the connected Suunto watch.

Feature request (Andre, 2026-08-18): "get from intervals.icu the person stats that match
our watch, and write to our watch. weight, height, max hr min hr whatever."

Pipeline: intervals_stats.fetch_watch_stats() (read-only fetch + activity-class calc) ->
settings_write.py's proven, byte-exact Personal.* write path, one field at a time.

DRY-RUN BY DEFAULT: without --write it only fetches, previews the values, and asks
settings_write for its own dry-run per field (which reads the watch's CURRENT value so you
can see the before/after). Pass --write to actually send them. Always eyeball the preview
before the first real write to a watch.

  ./tools/stats_to_watch.py <athleteId> <apiKey>            # preview only
  ./tools/stats_to_watch.py <athleteId> <apiKey> --write    # write to the watch
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intervals_stats  # noqa: E402

HERE = Path(__file__).resolve().parent

# Order matters only for a tidy log; each field is an independent settings_write --set.
# gender is written as the watch's IsMale bool - ServiceAdapter.xml: Male=1, Female=0.
WRITE_ORDER = ["gender", "birth_date", "body_height", "body_weight",
               "max_hr", "rest_hr", "activity_level"]


def settings_value(field: str, info: dict) -> str:
    """The raw --set value settings_write expects (it takes display units for scaled fields
    like weight/activity_level, and an enum's integer for radios like gender)."""
    v = info["value"]
    if field == "gender":
        return "1" if v == "Male" else "0"
    return str(v)


def _settings_write_json(field: str, value: str, device: str | None, write: bool) -> dict:
    cmd = [sys.executable, str(HERE / "settings_write.py"),
           "--set", f"{field}={value}", "--json"]
    if device:
        cmd += ["--device", device]
    if write:
        cmd += ["--write"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    # settings_write prints one JSON object (possibly after non-JSON banner lines); take the
    # last line that parses as JSON.
    out = {}
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                out = json.loads(line)
            except json.JSONDecodeError:
                pass
    if not out:
        # settings_write can't open the watch etc. - keep the reason short, no traceback dump.
        err = (proc.stderr or proc.stdout or "no output").strip().splitlines()
        reason = err[-1] if err else "settings_write failed"
        out = {"ok": False, "error": reason[:200]}
    return out


def _current_display(dry: dict):
    """Pull the watch's CURRENT display value out of a settings_write dry-run result."""
    cur = dry.get("current")
    if isinstance(cur, dict):
        return cur.get("value")
    return cur


def _same(current, target: str) -> bool:
    """Best-effort equality between the watch's current value and the target we'd write -
    numeric compare when both look numeric (7.5 == 7.5, 87.2 == 87.2), else string."""
    if current is None:
        return False
    try:
        return abs(float(current) - float(target)) < 1e-6
    except (TypeError, ValueError):
        return str(current) == str(target)


def run_settings_write(field: str, value: str, device: str | None, write: bool) -> dict:
    """Always dry-run first to read the watch's current value; only send a real write when
    asked AND the value actually differs (idempotent - safe to call on every sync)."""
    dry = _settings_write_json(field, value, device, write=False)
    current = _current_display(dry)
    if dry.get("ok") is False:
        return {"ok": False, "error": dry.get("error"), "current": current, "wrote": False, "changed": False}
    changed = not _same(current, value)
    result = {"ok": True, "current": current, "wrote": False, "changed": changed}
    if write and changed:
        real = _settings_write_json(field, value, device, write=True)
        result["ok"] = real.get("ok") is not False
        result["wrote"] = result["ok"]
        if not result["ok"]:
            result["error"] = real.get("error")
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Write intervals.icu personal stats to the watch.")
    ap.add_argument("athlete_id")
    ap.add_argument("api_key")
    ap.add_argument("--write", action="store_true",
                    help="actually write to the watch (default: preview + per-field dry-run)")
    ap.add_argument("--device", help="which watch to open when more than one is connected")
    ap.add_argument("--weeks", type=int, default=4, help="weeks of activity for the class calc")
    ap.add_argument("--only", help="comma-separated fields to consider (e.g. 'activity_level' "
                                   "for the on-sync class refresh); default: all Personal fields")
    ap.add_argument("--json", action="store_true", help="machine-readable output (for the app)")
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(",")} if args.only else None
    stats = intervals_stats.fetch_watch_stats(args.athlete_id, args.api_key, args.weeks)

    fields = []
    for field in WRITE_ORDER:
        if field not in stats:
            continue
        if only and field not in only:
            continue
        fields.append({
            "field": field,
            "display": stats[field]["value"],
            "raw": settings_value(field, stats[field]),
            "source": stats[field]["source"],
        })

    if not args.json:
        print(f"Personal stats from intervals.icu (athlete {args.athlete_id}):")
        for f in fields:
            print(f"  {f['field']:14} = {str(f['display']):<10} ({f['source']})")
        print("\n--write given: sending to the watch..." if args.write
              else "\n(preview only - pass --write to send these to the watch)")

    results = []
    for f in fields:
        res = run_settings_write(f["field"], f["raw"], args.device, args.write)
        results.append({"field": f["field"], "value": f["display"], **res})
        if not args.json:
            if res.get("ok") is False:
                print(f"  ✗ {f['field']}: {res.get('error')}")
            elif not res.get("changed"):
                print(f"  = {f['field']}: already {f['display']} (no write needed)")
            elif res.get("wrote"):
                print(f"  ✓ {f['field']}: {res.get('current')} -> {f['display']}")
            else:
                print(f"  · {f['field']}: watch has {res.get('current')!s}, would write {f['display']}")

    ok = all(r.get("ok") is not False for r in results)
    if args.json:
        print(json.dumps({"ok": ok, "wrote": any(r.get("wrote") for r in results),
                          "changed": any(r.get("changed") for r in results), "fields": results}))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
