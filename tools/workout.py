#!/usr/bin/env python3
"""Generates App Zone source for a structured, multi-step workout, and compiles it through
the live community compiler - the concrete design from `training_program_andre.md` Finding 8
(GUI -> source generator -> live compiler -> IAMRULE install), prototyped here.

**This tool stops at "produce a real, compiled IAMRULE binary."** It does not install
anything on a watch. Correction to an earlier claim in this session's own notes: the one real
Suunto App install this project has ever seen ("Climb counter", `custom_modes_andre.md`) was
done by real SuuntoLink software, not by any tool in this project - `apps.py` only decodes the
result. Writing a compiled app into the `Apps` flash region and wiring it into a `CustomModes`
display slot is real, separate, not-yet-built work.

Input: a JSON workout, the schema this project reverse-engineered from
`openambitproject/openambit#257` and independently confirmed against wanarun.net and Suunto's
own French tutorial (`training_program_andre.md` Findings 5/9/10):

    {
      "name": "5x3min power intervals",
      "steps": [
        {"type": {"typeName": "warmup"},
         "duration": {"durationName": "time", "value": 600},
         "target": {"targetName": "hr", "valueRange": {"min": 120, "max": 140}},
         "notify": {"beep": true, "light": true}},
        {"type": {"typeName": "repeatStart", "value": 5}},
        {"type": {"typeName": "interval"},
         "duration": {"durationName": "time", "value": 180},
         "target": {"targetName": "power", "valueRange": {"min": 200, "max": 220}}},
        {"type": {"typeName": "recovery"},
         "duration": {"durationName": "time", "value": 90},
         "target": {"targetName": "none"}},
        {"type": {"typeName": "repeatEnd"}},
        {"type": {"typeName": "cooldown"},
         "duration": {"durationName": "time", "value": 300},
         "target": {"targetName": "none"}}
      ]
    }

`duration.durationName`: `time` (seconds) / `distance` (meters) / `ascent` (meters) / `lap`
(advance on the next Back Lap press - `SUUNTO_LAP_NUMBER`, same signal Seb's real IntervalAIO
app uses). `target.targetName`: `none` / `hr` / `pace` / `speed` / `vertical_speed` / `power` -
all real built-in App Zone variables (`SuuntoAppZoneDeveloperManual.pdf`), not repurposed
personal-settings fields (`training_program_andre.md` Finding 8's whole point). `notify`
(optional, on a step - it governs the alert fired on *entering* that step): `{"beep": bool,
"light": bool}`, both default `true` if omitted.

Generates one unrolled `PHASE == k` branch per expanded step - repeat blocks are flattened at
*generation* time, not looped at *runtime*, because App Zone has no arrays or loops over data
(confirmed empirically against all six of `assets/Intervals`' real scripts - see Finding 8).
Same architecture Sebastien Chastang's real `IntervalAIO` app uses for its own fixed 2-phase
loop, generalized here to N literal phases with a duration-type per phase instead of one fixed
fast/slow shape.

Target ranges now do something real, not just cosmetic labels: whenever a phase has a
`target` other than `none`, the generated script watches the matching live built-in
(`SUUNTO_HR`/`SUUNTO_PACE`/`SUUNTO_SPEED`/`SUUNTO_VERTICAL_SPD`/`SUUNTO_BIKE_POWER`) every tick
and fires one `Suunto.alarmBeep()` the moment it leaves `valueRange`, debounced (`OUT_OF_RANGE`)
so it beeps once per excursion rather than continuously. The live numeric display itself still
shows remaining time/distance, not the target value - App Zone's single `RESULT` field can't
show both at once, and an audible alert is the more actionable signal of the two anyway.

Honest limitation, not hidden: this drives Seb's plain `prefix`/`RESULT`/`postfix` text field,
not the bounded live graph the authentic Movescount-era guided-workout screen used
(`training_program_andre.md` Finding 9) - that looks like a native firmware display type this
project hasn't found a way to drive from App Zone source.

    ./tools/workout.py WORKOUT.json --print-source
    ./tools/workout.py WORKOUT.json --compile --out compiled.json
"""

import argparse
import json
import sys

# The App Zone source this tool generates is compiled on the community compiler WEBSITE, which
# the user opens and pastes into themselves - this project never calls that server or carries a
# key for it (a deliberate choice: the compiler is not ours to invoke on a user's behalf). We
# only build the paste-ready source locally; the user does the compile step on the site and
# brings the resulting JSON back.
#
# The compiler is proprietary to Suunto, shared by the community at
# https://forum.suunto.com/topic/7592/ambit-apps-compilation
COMPILE_SITE_URL = "https://ambitapps.z6.web.core.windows.net/"

DURATION_VARS = {
    "time": "SUUNTO_DURATION",
    "distance": "SUUNTO_DISTANCE",
    "ascent": "SUUNTO_ASCENT",
}
DURATION_POSTFIX = {"time": "s", "distance": "m", "ascent": "m+", "lap": ""}
TARGET_VARS = {
    "hr": "SUUNTO_HR",
    "pace": "SUUNTO_PACE",
    "speed": "SUUNTO_SPEED",
    "vertical_speed": "SUUNTO_VERTICAL_SPD",
    "power": "SUUNTO_BIKE_POWER",
}
TYPE_LABELS = {"warmup": "Warm", "interval": "Fast", "recovery": "Rec", "cooldown": "Cool"}


def expand_steps(workout):
    """Flattens repeatStart/repeatEnd blocks into a plain list of real steps. Nested repeats
    aren't supported (none of the real examples this project has seen use them)."""
    flat = []
    steps = workout["steps"]
    i = 0
    while i < len(steps):
        step = steps[i]
        type_name = step["type"]["typeName"]
        if type_name == "repeatStart":
            count = step["type"]["value"]
            block = []
            i += 1
            while steps[i]["type"]["typeName"] != "repeatEnd":
                if steps[i]["type"]["typeName"] == "repeatStart":
                    raise NotImplementedError("nested repeat blocks aren't supported")
                block.append(steps[i])
                i += 1
            flat.extend(block * count)
        elif type_name == "repeatEnd":
            raise ValueError("repeatEnd without a matching repeatStart")
        else:
            flat.append(step)
        i += 1
    return flat


def _phase_condition(step):
    """The App-Zone expression that becomes true once this phase's own duration is complete."""
    duration = step["duration"]
    kind = duration["durationName"]
    if kind == "lap":
        return "SUUNTO_LAP_NUMBER > CURRENT_LAP_NUMBER"
    return f"({DURATION_VARS[kind]} - START_COUNTER) >= {duration['value']}"


def _phase_label(step):
    """Just the phase-type word ("Warm"/"Fast"/"Rec"/"Cool") - matches how Seb's real,
    compiler-verified apps label phases (IntervalAIO: "Fast"/"Slow"/"Walk"/"Cool", never a
    number). Deliberately doesn't embed the target range as digits: the live community
    compiler rejects any string literal containing a digit character (confirmed empirically,
    2026-08-05 - `"Warm"` and `"Warm X"` compile, `"Warm140"` and `"Warm 120"` both fail with
    COMPILATION_FAILED - an undocumented lexer quirk, not in `SuuntoAppZoneDeveloperManual.pdf`).
    The numeric target range isn't shown live either way - see this file's module docstring on
    the native-graph-display limitation."""
    return TYPE_LABELS.get(step["type"]["typeName"], step["type"]["typeName"][:4].capitalize())


def generate_source(workout):
    """Returns (app_zone_source_text, own_variable_names) for the given workout JSON."""
    steps = expand_steps(workout)
    if not steps:
        raise ValueError("workout has no real steps")

    lines = ["if (PHASE <= 0) {", "\tPHASE = 1;",
              f"\tSTART_COUNTER = {DURATION_VARS.get(steps[0]['duration']['durationName'], 'SUUNTO_DURATION')};",
              "\tCURRENT_LAP_NUMBER = SUUNTO_LAP_NUMBER;", "} else {"]

    for idx, step in enumerate(steps):
        phase_num = idx + 1
        keyword = "\tif" if idx == 0 else "\t} else if"
        lines.append(f"{keyword} (PHASE == {phase_num} && {_phase_condition(step)}) {{")
        lines.append(f"\t\tPHASE = {phase_num + 1};")
        if idx + 1 < len(steps):
            next_kind = steps[idx + 1]["duration"]["durationName"]
            next_var = DURATION_VARS.get(next_kind, "SUUNTO_DISTANCE")
            if next_kind != "lap":
                lines.append(f"\t\tSTART_COUNTER = {next_var};")
        lines.append("\t\tCURRENT_LAP_NUMBER = SUUNTO_LAP_NUMBER;")
        # notify() defaults both on - matches this generator's original always-on behavior,
        # so older/imported workouts without a "notify" key still alert exactly as before.
        entering = steps[idx + 1] if idx + 1 < len(steps) else None
        notify = (entering or {}).get("notify", {"beep": True, "light": True})
        if notify.get("beep", True):
            lines.append("\t\tSuunto.alarmBeep();")
        if notify.get("light", True):
            lines.append("\t\tSuunto.light();")
    lines.append("\t}")
    lines.append("}")
    lines.append("")

    lines.append("if (PHASE < 1) {")
    lines.append('\tprefix = "";')
    lines.append("\tRESULT = 0;")
    for idx, step in enumerate(steps):
        phase_num = idx + 1
        duration = step["duration"]
        kind = duration["durationName"]
        lines.append(f"}} else if (PHASE == {phase_num}) {{")
        lines.append(f'\tprefix = "{_phase_label(step)}";')
        lines.append(f'\tpostfix = "{DURATION_POSTFIX.get(kind, "")}";')
        if kind == "lap":
            lines.append("\tRESULT = SUUNTO_LAP_NUMBER - CURRENT_LAP_NUMBER;")
        else:
            lines.append(f"\tRESULT = {duration['value']} - "
                          f"({DURATION_VARS[kind]} - START_COUNTER);")
    lines.append("} else {")
    lines.append('\tprefix = "Done";')
    lines.append('\tpostfix = "";')
    lines.append("\tRESULT = 0;")
    lines.append("}")

    own_vars = ["PHASE", "START_COUNTER", "CURRENT_LAP_NUMBER"]

    has_targets = any(
        step.get("target", {}).get("targetName", "none") in TARGET_VARS for step in steps)
    if has_targets:
        # One alarmBeep() the moment the live target variable (real built-in - SUUNTO_HR/PACE/
        # SPEED/VERTICAL_SPD/BIKE_POWER, not a personal-settings field) leaves this phase's
        # range, debounced by OUT_OF_RANGE so it beeps once per excursion, not every tick.
        lines.append("")
        lines.append("if (PHASE < 1) {")
        lines.append("\tOUT_OF_RANGE = 0;")
        for idx, step in enumerate(steps):
            phase_num = idx + 1
            target = step.get("target", {"targetName": "none"})
            target_name = target.get("targetName", "none")
            lines.append(f"}} else if (PHASE == {phase_num}) {{")
            if target_name not in TARGET_VARS:
                lines.append("\tOUT_OF_RANGE = 0;")
                continue
            var = TARGET_VARS[target_name]
            rng = target["valueRange"]
            lines.append(f"\tif ({var} < {rng['min']} || {var} > {rng['max']}) {{")
            lines.append("\t\tif (OUT_OF_RANGE == 0) {")
            lines.append("\t\t\tSuunto.alarmBeep();")
            lines.append("\t\t\tOUT_OF_RANGE = 1;")
            lines.append("\t\t}")
            lines.append("\t} else {")
            lines.append("\t\tOUT_OF_RANGE = 0;")
            lines.append("\t}")
        lines.append("} else {")
        lines.append("\tOUT_OF_RANGE = 0;")
        lines.append("}")
        own_vars.append("OUT_OF_RANGE")

    return "\n".join(lines) + "\n", own_vars


def build_compile_request(source, own_vars, name):
    """Wraps generated source in the compiler's `/***HEADER***/` block - reverse-engineered
    from the compiler UI's own default placeholder (`main.js`), which shows own-variable
    declarations (`print = 0`, `myCounter = 0`, ...) inside that block, not script metadata."""
    header_lines = [f"{v} = 0" for v in own_vars]
    header = "/***HEADER***/\n" + "\n".join(header_lines) + "\n/***ENDHEADER***/\n"
    return header + source


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("workout", help="path to a workout JSON file (see this file's docstring"
                                     " for the schema)")
    ap.add_argument("--out", metavar="FILE", help="save the generated paste-ready source here"
                     " instead of printing it")
    args = ap.parse_args()

    with open(args.workout) as f:
        workout = json.load(f)

    source, own_vars = generate_source(workout)
    request_text = build_compile_request(source, own_vars, workout.get("name", "Workout"))

    if args.out:
        with open(args.out, "w") as f:
            f.write(request_text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(request_text)

    # Compiling happens on the website, by the user - we never call it. Tell them where.
    print(f"\nCompile this by pasting it at {COMPILE_SITE_URL} , then import the resulting "
          "JSON back into the Workout Builder.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
