#!/usr/bin/env python3
"""Pull an athlete's personal stats from intervals.icu and map them to the values the
Suunto watch stores in its Personal.* settings (see settings_write.py). Feature request
(Andre, 2026-08-18): "get from intervals.icu the person stats that match our watch, and
write to our watch. weight, height, max hr min hr whatever."

Read-only here: this module only FETCHES + COMPUTES. Writing to the watch is done by
settings_write.py's existing (proven byte-exact) Personal.* path, fed the dict this returns.

Fields mapped (intervals.icu -> watch Personal.*):
  icu_weight (kg)              -> Weight        (settings_write takes kg, scale x100 on wire)
  height (m)                   -> Height        (cm)
  sex ("M"/"F")                -> Gender
  sportSettings[].max_hr       -> MaxHR         (bpm; highest across sports)
  wellness restingHR (if any)  -> RestHR        (bpm; latest non-null in the window)
  date_of_birth                -> BirthDay      (year)
  computed from activities     -> ActivityLevel (Suunto activity class, see below)

Activity class: Suunto's own scale is a self-reported "hours of exercise per week" bucket
(SuuntoLink ui/activity_level.js, mirrored in settings_write.AMBIT3_NUMERIC_CHOICES). We
derive it instead from the athlete's REAL training volume: the average weekly moving-time
over the last 4 weeks, mapped to the same buckets. Andre's idea, 2026-08-18.
"""
from __future__ import annotations
import base64
import datetime as _dt
import json
import urllib.request
import urllib.error

API_BASE = "https://intervals.icu/api/v1"

# Suunto activity class, verified against SuuntoLink's own Ambit3 Personal-settings screens
# (assets/pcap/screens/ambit3 Personal setttings). The full scale is 1..10:
#   1  no regular exercise                       6  heavy: 1-3 h/week
#   2  recreational: < 1 h/week                  7  heavy: over 3 h/week (3-5)
#   3  recreational: > 1 h/week                  7.5 5-7 h   8 7-9 h   8.5 9-11 h
#   4  heavy exercise: < 30 min/week             9 11-13 h   9.5 13-15 h   10 over 15 h
#   5  heavy: 30-60 min/week
# Classes 4-10 are the "you exercise heavily" ladder keyed on hours/week; 2-3 are LIGHT
# recreational activity and 1 is none. An intervals.icu user logging structured workouts is
# by definition in the "heavy" band, so we map their real training hours onto 4-10 and only
# drop to class 1 when the window has NO activities. (2-3 are left for manual selection - we
# can't tell "heavy" from "light recreational" out of total hours alone.)
# (upper_bound_hours_exclusive, activity_class):
_ACTIVITY_CLASS_LADDER = [
    (0.5, 4.0), (1.0, 5.0), (3.0, 6.0), (5.0, 7.0), (7.0, 7.5),
    (9.0, 8.0), (11.0, 8.5), (13.0, 9.0), (15.0, 9.5), (float("inf"), 10.0),
]


def activity_class_from_weekly_hours(avg_hours_per_week: float) -> float:
    """Map an average weekly training-hours figure to a Suunto activity class (4.0..10.0)."""
    for upper, cls in _ACTIVITY_CLASS_LADDER:
        if avg_hours_per_week < upper:
            return cls
    return 10.0


def _get(path: str, athlete_id: str, api_key: str, query: str = "") -> object:
    url = f"{API_BASE}/athlete/{athlete_id}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url)
    token = base64.b64encode(f"API_KEY:{api_key}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")
    # intervals.icu 403s the default "Python-urllib" UA; any real UA is accepted (curl works).
    req.add_header("User-Agent", "Sommet/1.0 (+intervals.icu sync)")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _avg_weekly_hours(activities: list, weeks: int = 4) -> float:
    """Sum moving_time (fallback elapsed_time) over the last `weeks` weeks, / weeks -> h/wk."""
    total_s = 0.0
    for a in activities:
        secs = a.get("moving_time") or a.get("elapsed_time") or 0
        total_s += float(secs or 0)
    return (total_s / 3600.0) / max(1, weeks)


def fetch_watch_stats(athlete_id: str, api_key: str, weeks: int = 4) -> dict:
    """Return {field: {value, source}} for every Personal.* field we can fill, plus a
    human summary. Only keys with a real value are included; the caller writes those and
    leaves the rest of the watch untouched."""
    prof = _get("", athlete_id, api_key)
    if isinstance(prof, list):
        prof = prof[0]

    out: dict[str, dict] = {}

    weight = prof.get("icu_weight") or prof.get("weight")
    if weight:
        out["body_weight"] = {"value": round(float(weight), 1), "unit": "kg", "source": "profile"}
    height_m = prof.get("height")
    if height_m:
        out["body_height"] = {"value": int(round(float(height_m) * 100)), "unit": "cm", "source": "profile"}
    sex = prof.get("sex")
    if sex in ("M", "F"):
        out["gender"] = {"value": "Male" if sex == "M" else "Female", "source": "profile"}
    dob = prof.get("date_of_birth")
    if dob:
        out["birth_date"] = {"value": int(str(dob)[:4]), "source": "profile"}

    # Max HR: highest across the per-sport settings (a real athlete value, same on all here).
    max_hr = None
    for ss in prof.get("sportSettings", []) or []:
        if ss.get("max_hr"):
            max_hr = max(max_hr or 0, int(ss["max_hr"]))
    if max_hr:
        out["max_hr"] = {"value": max_hr, "unit": "bpm", "source": "sportSettings"}

    # Rest HR: the profile's own icu_resting_hr is what intervals.icu shows (it's fed from the
    # watch/wellness) - use it first; fall back to the latest non-null wellness restingHR if the
    # profile field is blank (the wellness window is widened since it can lag a few weeks).
    rest = prof.get("icu_resting_hr")
    if rest:
        out["rest_hr"] = {"value": int(rest), "unit": "bpm", "source": "profile"}
    else:
        newest = _dt.date.today()
        oldest = newest - _dt.timedelta(days=120)
        try:
            wellness = _get("/wellness", athlete_id, api_key,
                            f"oldest={oldest}&newest={newest}")
            w_rest = next((w["restingHR"] for w in reversed(wellness or [])
                           if w.get("restingHR")), None)
            if w_rest:
                out["rest_hr"] = {"value": int(w_rest), "unit": "bpm", "source": "wellness"}
        except urllib.error.URLError:
            pass

    # Activity class from real 4-week training volume.
    newest = _dt.date.today()
    oldest = newest - _dt.timedelta(weeks=weeks)
    acts = _get("/activities", athlete_id, api_key, f"oldest={oldest}&newest={newest}")
    acts_list = acts if isinstance(acts, list) else []
    avg_h = _avg_weekly_hours(acts_list, weeks)
    # No logged training in the window -> "no regular exercise" (class 1). Any training maps
    # onto the heavy ladder (4-10) by hours.
    cls = activity_class_from_weekly_hours(avg_h) if acts_list else 1.0
    out["activity_level"] = {
        "value": cls,
        "source": f"{avg_h:.1f} h/week avg over {weeks} wk ({len(acts_list)} activities)",
    }
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Fetch intervals.icu personal stats for the watch.")
    ap.add_argument("athlete_id")
    ap.add_argument("api_key")
    ap.add_argument("--weeks", type=int, default=4)
    ap.add_argument("--activity-class", action="store_true",
                    help="print ONLY the computed Suunto activity class (for the on-sync "
                         "refresh) - no watch and no other fields needed")
    args = ap.parse_args()

    if args.activity_class:
        # Cheap path: just the activities -> avg weekly hours -> class. No profile/wellness.
        import datetime as __dt
        newest = __dt.date.today()
        oldest = newest - __dt.timedelta(weeks=args.weeks)
        acts = _get("/activities", args.athlete_id, args.api_key, f"oldest={oldest}&newest={newest}")
        acts = acts if isinstance(acts, list) else []
        cls = activity_class_from_weekly_hours(_avg_weekly_hours(acts, args.weeks)) if acts else 1.0
        print(cls)
    else:
        stats = fetch_watch_stats(args.athlete_id, args.api_key, args.weeks)
        print("Personal stats to write to the watch:")
        for k, v in stats.items():
            print(f"  {k:14} = {v['value']!s:<10} ({v['source']})")
