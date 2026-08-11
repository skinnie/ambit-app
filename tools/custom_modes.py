#!/usr/bin/env python3
"""Decodes the Ambit3 CustomModes flash region (sport modes), a format this project only
reverse-engineered on 2026-08-05 - see custom_modes_andre.md for the full derivation.

Unlike Waypoints/Routes/GpsSGEE (fixed-stride binary records) or DeviceSettings/POIs/
ActivityTracking (SBEM0102 [id][len][data] entries), CustomModes uses a third, distinct
on-device encoding: Suunto's own "BXml" binary-encoded tree format. Every tag is a 4-byte
header - [u16 LE tag_id][u16 LE length] - followed by that many content bytes, which may
themselves be further nested tags. The tag dictionary below (BXML_TAGS, FIELD_TYPES) is
extracted verbatim from Communist::Bluebird::BXmlTagMapping and BXmlIdMapping in the
decompiled assets/APK/movescountapp/ghidra/libkomposti-ng.so.c - not guessed.

    ./tools/custom_modes.py --from /tmp/dump_CustomModes.bin
    ./tools/custom_modes.py --save /tmp/before.bin   # live read + keep the raw bytes
"""

import argparse
import datetime
import json
import struct

CUSTOM_MODES_BASE = 0x002000
CUSTOM_MODES_SIZE = 12288  # confirmed live via 0x0b21, 2026-08-05

# BXmlTagMapping - the container/structure tags (libkomposti-ng.so.c ~846489-846913).
DEVICE_CUSTOM = 0x003
EXERCISE_MODES = 0x100
EXERCISE_MODES_MODE = 0x101
EXERCISE_MODES_SETTING = 0x102
EXERCISE_MODES_SETTING_NAME_LEN64 = 0x103
EXERCISE_MODES_DISPLAYS = 0x105
EXERCISE_MODES_DISPLAY = 0x106
EXERCISE_MODES_DISP_SETTING = 0x107
EXERCISE_MODES_DISP_FIELD = 0x108
EXERCISE_MODES_DISP_FIELD_SETTING = 0x109
EXERCISE_MODES_DISP_FIELD_SHORTCUT = 0x10A
EXERCISE_MODES_TYPE = 0x10B
EXERCISE_MODES_RULES = 0x10C
EXERCISE_MODES_RULE = 0x10D
# Not in BXmlTagMapping/BXmlIdMapping in libkomposti-ng.so.c at all - this app version predates
# Suunto Apps being wired into CustomModes. Observed live, 2026-08-05, appearing for the first
# time on a mode that just had a Suunto App assigned via SuuntoLink 4.1.15: an 8-byte leaf,
# two consecutive uint32 LE Unix timestamps, 2 seconds apart, both landing exactly on the real
# wall-clock moment of that sync. Name and exact semantics (e.g. created/modified) are inferred,
# not sourced - see custom_modes_andre.md.
EXERCISE_MODES_APP_META = 0x1FF
SPORT_MODES = 0x200
SPORT_MODE = 0x210
SPORT_MODE_SETTING_NAME = 0x212
SPORT_MODE_ACTIVITY_ID = 0x213
SPORT_MODE_EXERCISE = 0x214
SPORT_MODE_SETTING_NAME_LEN64 = 0x215
# Not in BXmlTagMapping/BXmlIdMapping either - found 2026-08-07 the same way EXERCISE_MODES_
# APP_META was, by round-tripping a real live dump through decode()->encode() and comparing
# byte for byte against custom_modes_write.py's rebuild (see V3_CHANGELOG.md). Present on
# EVERY SPORT_MODE slot on the reference watch: a 4-byte uint32 whose values (1,2,3,4,5,6,7,
# 9,10) are a persistent per-slot order/ID that survives deletion - the reference watch had
# slot 8 ("Alpine skiing") deleted via SuuntoLink, and the surviving values still skip 8
# rather than renumbering, ruling out "just flash position." Name and exact semantics
# inferred, not sourced.
SPORT_MODE_ORDER = 0x2FE
# Present only on the 3 slots whose EXERCISE_MODES_MODE has a Suunto App assigned (Cycling,
# Indoor training, Mountaineering) - a 4-byte uint32 Unix timestamp landing 2-6 seconds after
# that same mode's own EXERCISE_MODES_APP_META timestamps, every time, across all 3 - not a
# coincidence. Name and exact semantics inferred, not sourced.
SPORT_MODE_APP_META = 0x2FF

BXML_TAGS = {
    0x002: "DEVICE_DETAIL", 0x010: "FIRMWARE", 0x011: "FIRMWARE_DEVICE_INFO",
    0x020: "HW_DETAILS", 0x021: "HW_DETAILS_SUPPORTED_DEVICES", 0x022: "HW_DETAILS_DEVICE",
    DEVICE_CUSTOM: "DEVICE_CUSTOM",
    EXERCISE_MODES: "EXERCISE_MODES", EXERCISE_MODES_MODE: "EXERCISE_MODES_MODE",
    EXERCISE_MODES_SETTING: "EXERCISE_MODES_SETTING",
    EXERCISE_MODES_SETTING_NAME_LEN64: "EXERCISE_MODES_SETTING_NAME_LEN64",
    EXERCISE_MODES_DISPLAYS: "EXERCISE_MODES_DISPLAYS",
    EXERCISE_MODES_DISPLAY: "EXERCISE_MODES_DISPLAY",
    EXERCISE_MODES_DISP_SETTING: "EXERCISE_MODES_DISP_SETTING",
    EXERCISE_MODES_DISP_FIELD: "EXERCISE_MODES_DISP_FIELD",
    EXERCISE_MODES_DISP_FIELD_SETTING: "EXERCISE_MODES_DISP_FIELD_SETTING",
    EXERCISE_MODES_DISP_FIELD_SHORTCUT: "EXERCISE_MODES_DISP_FIELD_SHORTCUT",
    EXERCISE_MODES_TYPE: "EXERCISE_MODES_TYPE",
    EXERCISE_MODES_RULES: "EXERCISE_MODES_RULES", EXERCISE_MODES_RULE: "EXERCISE_MODES_RULE",
    EXERCISE_MODES_APP_META: "EXERCISE_MODES_APP_META",
    SPORT_MODES: "SPORT_MODES", SPORT_MODE: "SPORT_MODE",
    SPORT_MODE_SETTING_NAME: "SPORT_MODE_SETTING_NAME",
    SPORT_MODE_ACTIVITY_ID: "SPORT_MODE_ACTIVITY_ID", SPORT_MODE_EXERCISE: "SPORT_MODE_EXERCISE",
    SPORT_MODE_SETTING_NAME_LEN64: "SPORT_MODE_SETTING_NAME_LEN64",
    SPORT_MODE_ORDER: "SPORT_MODE_ORDER", SPORT_MODE_APP_META: "SPORT_MODE_APP_META",
}

# BXmlIdMapping - the leaf field-type / screen-template dictionary (~846916-848423).
# Reproduced in full since it is the only "what can this custom mode display" catalogue
# this project has; not all of it is wired into the decoder below yet (DISPLAYS/RULES).
FIELD_TYPES = {
    0x0001: "MT_MAIN", 0x0002: "MT_EXERCISE", 0xFFFE: "MT_NONE",
    0x0000: "FT_SHORTCUT", 0x0001: "FT_TIME", 0x0002: "FT_TIME_SEC", 0x0003: "FT_DATE",
    0x0004: "FT_WEEKDAY", 0x0005: "FT_TIMER", 0x0006: "FT_ALTI", 0x0007: "FT_BARO",
    0x0008: "FT_COMPASS", 0x0009: "FT_HEART_RATE_AVG", 0x000A: "FT_DISTANCE",
    0x000B: "FT_VELOCITY", 0x000C: "FT_AVGSPEED", 0x000D: "FT_TEMPERATURE",
    0x000E: "FT_BARO_GRAPH", 0x000F: "FT_ALTI_GRAPH", 0x0010: "FT_COMPASSCARDINAL",
    0x0011: "FT_TOTAL_CALORIES", 0x0012: "FT_REF_ALTI", 0x0013: "FT_ENERGY_SYMBOL",
    0x0014: "FT_HEART_RATE_PEAK", 0x0015: "FT_HEART_RATE_CURR", 0x0016: "FT_HEART_RATE_GRAPH",
    0x0017: "FT_CADENCE", 0x0018: "FT_NAVI_ARROW", 0x0019: "FT_NAVI_DISTANCE",
    0x001A: "FT_NAVI_DIRECTION", 0x001B: "FT_DUAL_TIME", 0x001C: "FT_PACE",
    0x001D: "FT_AVG_PACE", 0x001E: "FT_RECOVERY_TIME", 0x001F: "FT_TE",
    0x0020: "FT_EXERCISE_ALTI_GRAPH", 0x0033: "FT_RULE_ENGINE_0", 0x0034: "FT_RULE_ENGINE_1",
    0x0035: "FT_RULE_ENGINE_2", 0x0036: "FT_STOPWATCH_ABC", 0x0037: "FT_SW_ABC_LAP_TIME",
    0x0038: "FT_SW_ABC_LAP", 0x0039: "FT_SW_TIME", 0x003A: "FT_DEVELOPER_TITLE",
    0x003B: "FT_TEXT_ADJUST", 0x003C: "FT_CALIBRATED_DISTANCE", 0x003D: "FT_INTERVAL_VALUE",
    0x003E: "FT_INTERVAL_TITLE", 0x003F: "FT_SPLIT_LAP_DISTANCE", 0x0040: "FT_SWIM_STYLE_TITLE",
    0x0042: "FT_DRILL_TITLE", 0x0044: "FT_BATTERY_CHARGE", 0x0046: "FT_SPORT_LAP_STOPWATCH",
    0x0048: "FT_SPORT_LAP_AVGSPEED", 0x004A: "FT_BIKE_POWER_AVG", 0x004C: "FT_BIKE_POWER_10S",
    0x004E: "FT_BIKE_POWER_LAP", 0x0050: "FT_BIKE_POWER_LAP_MAX", 0x0052: "FT_SWIM_STYLE",
    0x0054: "FT_SWIM_STROKES", 0x0056: "FT_SWIM_PACE", 0x0058: "FT_SWIM_AVG_PACE",
    # Real, 2026-08-10, NOT from libkomposti (its 68 FT_ names are all already here -
    # these two are simply absent from it). Named from André's own side-by-side of a
    # real Openwater swim mode against SuuntoLink: the watch's display 1 decodes as
    # Top=0x47, Center=0x46, Bottom=shortcuts[0x58, 0x57], and SuuntoLink shows that
    # same screen as "current activity distance / current activity duration / average
    # swim pace + average stroke rate". 0x46 and 0x48 were already known as
    # FT_SPORT_LAP_STOPWATCH/AVGSPEED - which is what SuuntoLink labels "Current
    # activity duration"/"avg speed" in its Multisport category - so 0x47 sitting
    # between them as "current activity distance" fits both the observation and the
    # numbering. 0x57 likewise sits between FT_SWIM_PACE and FT_SWIM_AVG_PACE.
    # Rule-engine slots 3 and 4 do NOT continue the 0x33-0x35 run - they resume at 0x6B/0x6C,
    # and each slot has a companion field at 0x6D + slot used as a graph display's second
    # field. Both proven on Andre's real Running2 (5 installed apps, Rules 0..4 = the Apps
    # region order: Beers burned off / Downhills Counter / Real time EPOC / Sleep Monitor /
    # Current incline). Its graph display 1 is (0x34, 0x6E, 5) and graph display 3 is
    # (0x6B, 0x70, 5); Andre independently named those two screens as the Downhills Counter
    # (slot 1) and Sleep Monitor (slot 3) apps, so 0x6B = slot 3 and the companions are
    # 0x6D + slot (1 -> 0x6E, 3 -> 0x70). The unseen members 0x6D/0x6F/0x71 follow the same
    # rule but have not been observed on hardware yet.
    # 0x002C read straight off SuuntoLink's own UI: André opened Running2, whose display 0
    # bottom row we decode as Speed / Distance / Training Effect / 0x002C / app slot 1, and
    # SuuntoLink names that fourth value "Vertical speed" (2026-08-11). The same screen also
    # confirmed slot 1 is "Beers burned off", which is RuleIdx 0 in the Apps region - so the
    # rule-engine slot ordering above is right as well.
    0x002C: "FT_VERTICAL_SPEED",
    # All read off SuuntoLink by André, 2026-08-11 - observations, not inference.
    #
    # 0x21/0x22 come from his Cycling display 2 bottom row, which the watch stores as
    # [0x21, 0x22, 0x2C, 0x46] and SuuntoLink lists as [Ascent, Descent, Vertical speed,
    # Current activity duration]. The last two are independently known ids, so they act as
    # controls: both land exactly where the stored order puts them, which is what makes the
    # first two trustworthy rather than merely plausible. (That control matters - the same
    # question asked of a Pool swimming row showed SuuntoLink listing it in a DIFFERENT
    # order from storage, so position alone proves nothing without anchors.)
    0x0021: "FT_ASCENT", 0x0022: "FT_DESCENT",
    # Sole unknown on its row, so no ordering ambiguity is possible.
    0x002D: "FT_LAP_NUMBER",
    # His Running display 5 is a graph, and a graph stores (value, that value's graph,
    # bottom row) - one pick fills both fields. He picked Running performance.
    0x00AD: "FT_RUNNING_PERFORMANCE", 0x00B0: "FT_RUNNING_PERFORMANCE_GRAPH",
    # WITHDRAWN 2026-08-11: 0x49/0x4b/0x4d/0x4f were briefly named as the bike-power block by
    # lining our known 0x4a/0x4c/0x4e/0x50 up against SuuntoLink's own row order. The
    # interleave was tidy and the captures fitted - but André then read 0x0043 off SuuntoLink
    # as "Power", which the interleave has no room for. An observation beats a deduction, so
    # all four are unnamed again until someone reads them off the UI. The lesson is the
    # familiar one: a pattern that explains the evidence is not the same as evidence.
    0x006B: "FT_RULE_ENGINE_3", 0x006C: "FT_RULE_ENGINE_4",
    0x006E: "FT_RULE_ENGINE_1_GRAPH", 0x0070: "FT_RULE_ENGINE_3_GRAPH",
    0x0047: "FT_SPORT_LAP_DISTANCE", 0x0057: "FT_SWIM_AVG_STROKE_RATE",
    0x005A: "FT_SWIM_LAP_DISTANCE", 0x005C: "FT_SWIM_LAP_RATE", 0x005E: "FT_SWIM_LAP_SWOLF",
    0x0060: "FT_SWIM_POOL_STROKES", 0x0062: "FT_SWIM_POOL_PACE", 0x0064: "FT_SWIM_INT_TIME",
    0x0066: "FT_SWIM_INT_STROKES", 0x0068: "FT_SWIM_INT_PACE", 0x006A: "FT_SWIM_REST_TIME",
    0x0100: "PID_RUNNER_GPS_TEMPLATE_1", 0x0101: "PID_RUNNER_GPS_TEMPLATE_1G_GRAPH",
    0x0102: "PID_RUNNER_GPS_TEMPLATE_2", 0x0103: "PID_RUNNER_GPS_TEMPLATE_3",
    0x0104: "PID_RUNNER_GPS_TEMPLATE_4", 0x0105: "PID_RUNNER_GPS_TEMPLATE_5",
    0x0106: "PID_RUNNER_GPS_TEMPLATE_6", 0x0107: "PID_RUNNER_GPS_TEMPLATE_7_WAYPOINT",
    0x0108: "PID_RUNNER_GPS_TEMPLATE_8_LOCATION",
    0x0109: "PID_RUNNER_GPS_TEMPLATE_9_WAYPOINT_NAME",
    0x0110: "PID_RUNNER_GPS_TEMPLATE_10_INPUT",
    0x0111: "PID_RUNNER_GPS_TEMPLATE_11_COMPASS_NAVIGATE",
    0x0112: "PID_RUNNER_GPS_TEMPLATE_12_SETTINGS",
    0x0113: "PID_RUNNER_GPS_TEMPLATE_13_TWOWAY_CHOICE",
    0x0114: "PID_RUNNER_GPS_TEMPLATE_14_ONEWAY_CHOICE",
    0x0115: "PID_RUNNER_GPS_TEMPLATE_15_ADJUST", 0x0116: "PID_RUNNER_GPS_TEMPLATE_16_LOADING",
    0x0117: "PID_RUNNER_GPS_TEMPLATE_17_POPUP", 0x0118: "PID_RUNNER_GPS_TEMPLATE_18_MEMORY",
    0x0119: "PID_RUNNER_GPS_TEMPLATE_19_MODE_TITLE",
    0x0120: "PID_RUNNER_GPS_TEMPLATE_20_CALIBRATION",
    0x0121: "PID_RUNNER_GPS_TEMPLATE_21_UTMMGRS_LOCATION",
    0x0122: "PID_RUNNER_GPS_TEMPLATE_22_NAVIGATION",
    0x0123: "PID_RUNNER_GPS_TEMPLATE_11_MILS_COMPASS_NAVIGATE",
    0x0150: "PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW", 0x0200: "PID_RUNNER_GPS_TEMPLATE_100_DEBUG",
}

# Real, 2026-08-09 ("on custom sports it shows the variable names, can't we have the normal
# names?") - a human-readable label per real FIELD_TYPES entry, for the desktop/Android
# field-type pickers. Curated by hand for every FT_* entry (real sports-watch terminology,
# not a mechanical guess) - two are hardware-confirmed real names from this project's own
# live testing, not just plausible-sounding ones: FT_VELOCITY really does show as "Speed"
# (custom_modes_andre.md, Walk's own wrong field read back as this, matching what André
# reported seeing), and FT_HEART_RATE_CURR really does show as plain "Heart Rate" (same
# doc, the confirmed HR-display fix). FT_RULE_ENGINE_0/1/2's "Suunto App Slot N" wording
# matches this project's own real understanding of what RULEIDX selects (decode_rule()'s
# own docstring). The PID_RUNNER_GPS_TEMPLATE_* screen-template entries are deliberately
# NOT given invented descriptions here (this project has never confirmed what most of those
# numbers look like on a real screen, only that TEMPLATE_4 is the ordinary repeating data
# screen - see custom_modes_andre.md) - field_type_label()'s own fallback just cleans up
# the real enum name's own formatting for those instead of guessing new meaning.
FIELD_TYPE_LABELS = {
    "FT_SHORTCUT": "Shortcut", "FT_TIME": "Time", "FT_TIME_SEC": "Time (with seconds)",
    "FT_DATE": "Date", "FT_WEEKDAY": "Weekday", "FT_TIMER": "Timer", "FT_ALTI": "Altitude",
    "FT_BARO": "Barometric Pressure", "FT_COMPASS": "Compass Heading",
    "FT_HEART_RATE_AVG": "Heart Rate (average)", "FT_DISTANCE": "Distance",
    "FT_VELOCITY": "Speed", "FT_AVGSPEED": "Speed (average)", "FT_TEMPERATURE": "Temperature",
    "FT_BARO_GRAPH": "Barometric Pressure Graph", "FT_ALTI_GRAPH": "Altitude Graph",
    "FT_COMPASSCARDINAL": "Compass Direction", "FT_TOTAL_CALORIES": "Calories",
    "FT_REF_ALTI": "Reference Altitude", "FT_ENERGY_SYMBOL": "Energy Level",
    "FT_HEART_RATE_PEAK": "Heart Rate (peak)", "FT_HEART_RATE_CURR": "Heart Rate",
    "FT_HEART_RATE_GRAPH": "Heart Rate Graph", "FT_CADENCE": "Cadence",
    "FT_NAVI_ARROW": "Navigation Arrow", "FT_NAVI_DISTANCE": "Navigation Distance",
    "FT_NAVI_DIRECTION": "Navigation Direction", "FT_DUAL_TIME": "Dual Time",
    "FT_PACE": "Pace", "FT_AVG_PACE": "Pace (average)", "FT_RECOVERY_TIME": "Recovery Time",
    "FT_TE": "Training Effect", "FT_EXERCISE_ALTI_GRAPH": "Altitude Graph (exercise)",
    "FT_RULE_ENGINE_0": "Suunto App Slot 1", "FT_RULE_ENGINE_1": "Suunto App Slot 2",
    "FT_RULE_ENGINE_2": "Suunto App Slot 3",
    "FT_VERTICAL_SPEED": "Vertical speed", "FT_ASCENT": "Ascent", "FT_DESCENT": "Descent",
    "FT_LAP_NUMBER": "Lap number", "FT_RUNNING_PERFORMANCE": "Running performance",
    "FT_RUNNING_PERFORMANCE_GRAPH": "Running performance (graph)",
    "FT_RULE_ENGINE_3": "Suunto App Slot 4", "FT_RULE_ENGINE_4": "Suunto App Slot 5",
    "FT_RULE_ENGINE_1_GRAPH": "Suunto App Slot 2 (graph)",
    "FT_RULE_ENGINE_3_GRAPH": "Suunto App Slot 4 (graph)",
    "FT_STOPWATCH_ABC": "Stopwatch",
    "FT_SW_ABC_LAP_TIME": "Stopwatch Lap Time", "FT_SW_ABC_LAP": "Stopwatch Lap",
    "FT_SW_TIME": "Stopwatch Time", "FT_DEVELOPER_TITLE": "Developer Title",
    "FT_TEXT_ADJUST": "Text Adjust", "FT_CALIBRATED_DISTANCE": "Distance (calibrated)",
    "FT_INTERVAL_VALUE": "Interval Value", "FT_INTERVAL_TITLE": "Interval Title",
    "FT_SPLIT_LAP_DISTANCE": "Split/Lap Distance", "FT_SWIM_STYLE_TITLE": "Swim Style Title",
    "FT_DRILL_TITLE": "Drill Title", "FT_BATTERY_CHARGE": "Battery Charge",
    # Read off SuuntoLink by André, 2026-08-11. Our own wording ("Lap Stopwatch", "Lap
    # Average Speed") was a guess from the FT_ symbol and is actively misleading - these are
    # the CURRENT-ACTIVITY fields of a multisport mode, not lap fields. The ids themselves
    # were never in doubt (both verified against SuuntoLink's own binary); only our labels
    # were wrong, which is exactly the kind of error a UI shows the user every day.
    "FT_SPORT_LAP_STOPWATCH": "Current activity duration",
    "FT_SPORT_LAP_AVGSPEED": "Current activity avg speed",
    "FT_BIKE_POWER_AVG": "Bike Power (average)", "FT_BIKE_POWER_10S": "Bike Power (10s average)",
    "FT_BIKE_POWER_LAP": "Bike Power (lap average)", "FT_BIKE_POWER_LAP_MAX": "Bike Power (lap max)",
    "FT_SWIM_STYLE": "Previous pool length style",   # SuuntoLink's own wording, André 2026-08-11 "FT_SWIM_STROKES": "Swim Strokes", "FT_SWIM_PACE": "Swim Pace",
    "FT_SWIM_AVG_PACE": "Swim Pace (average)",
    "FT_SWIM_AVG_STROKE_RATE": "Stroke Rate (average)",
    # SuuntoLink groups the FT_SPORT_LAP_* family under "Multisport" and words them
    # "Current activity ..." - matched here so our UI reads the same as the app the
    # owner already knows.
    "FT_SPORT_LAP_DISTANCE": "Current Activity Distance", "FT_SWIM_LAP_DISTANCE": "Swim Lap Distance",
    "FT_SWIM_LAP_RATE": "Swim Stroke Rate", "FT_SWIM_LAP_SWOLF": "Swim SWOLF",
    "FT_SWIM_POOL_STROKES": "Pool Swim Strokes", "FT_SWIM_POOL_PACE": "Pool Swim Pace",
    "FT_SWIM_INT_TIME": "Swim Interval Time", "FT_SWIM_INT_STROKES": "Swim Interval Strokes",
    "FT_SWIM_INT_PACE": "Swim Interval Pace", "FT_SWIM_REST_TIME": "Swim Rest Time",
    "MT_NONE": "(none)",
}


def used_extent(data):
    """The number of real (used) bytes at the start of a CustomModes region image: the
    DEVICE_CUSTOM root BXML tag plus its 4-byte header. Everything after this is slack/0xFF
    padding within the fixed CUSTOM_MODES_REGION_SIZE region.

    This is the span SuuntoLink actually writes AND hashes (confirmed byte-exact against all 4
    real app-install captures in assets/ambit3 pcap/v2/, and against the watch's own reported
    0x0b21 CustomModes hash - training_program_andre.md Finding 28). Writers must write only
    data[:used_extent(data)] so the closing hash covers exactly what the firmware re-hashes on
    a cold boot; writing the full padded region instead produces a hash the watch rejects with
    'err:62' on all sport modes after a restart."""
    root_id, root_len = struct.unpack_from("<HH", data, 0)
    if root_id != DEVICE_CUSTOM:
        raise ValueError(f"not a CustomModes image: root tag 0x{root_id:x} != DEVICE_CUSTOM")
    extent = 4 + root_len
    if extent > len(data):
        raise ValueError(f"declared extent {extent} exceeds image length {len(data)}")
    return extent


def field_type_label(name):
    """Human-readable label for a real FIELD_TYPES name - the curated dict above for every
    FT_*/MT_NONE entry, or a real-but-honest fallback for the PID_RUNNER_GPS_TEMPLATE_*
    screen-template entries this project has never confirmed the visual meaning of: strips
    the common prefix and reformats the enum's own real suffix, without inventing new
    meaning. `name` not in FIELD_TYPES at all (shouldn't happen, defensive) falls back to
    itself unchanged."""
    if name in FIELD_TYPE_LABELS:
        return FIELD_TYPE_LABELS[name]
    if name.startswith("PID_RUNNER_GPS_TEMPLATE_"):
        rest = name[len("PID_RUNNER_GPS_TEMPLATE_"):]
        num, _, words = rest.partition("_")
        pretty = words.replace("_", " ").title()
        return f"Screen {num}" + (f" - {pretty}" if pretty else "")
    return name

# EXERCISE_MODES_SETTING_NAME_LEN64's content: name string (64 B on UTF8-capable devices,
# see build_settings_name_field() for the older 16/24-byte variants) then a fixed sequence of
# uint16 fields, then one full interval-timer slot, then five short repeats. Verified against
# every one of the 10 EXERCISE_MODES_MODE entries on the reference watch: sums to exactly 138
# bytes, matching every SETTING_NAME_LEN64 tag length observed live, 2026-08-05.
SETTING_FIELDS = [
    ("ActivityID", "H"), ("CustomModeIdLow", "H"), ("CustomModeIdHigh", "H"),
    ("UseHw", "H"), ("AltiBaroMode", "H"), ("GpsPowerMode", "H"),
    ("RecordingInterval", "H"), ("Autolap", "H"), ("HrHigh", "H"), ("HrLow", "H"),
    ("HrLimitsUse", "H"), ("AutoStart", "H"), ("AutoPause", "H"), ("AutoScrolling", "H"),
    ("IntTimerFlags", "H"), ("IntTimerCount", "H"),
]
INTERVAL_SLOT_FULL = [("Flags", "B"), ("Type", "B"), ("MaxLimit", "H"), ("MinLimit", "H"),
                       ("Padding", "H"), ("Len", "I")]
INTERVAL_SLOT_SHORT = [("Flags", "B"), ("Type", "B"), ("MaxLimit", "H"), ("MinLimit", "H")]
INTERVAL_SLOT_REPEATS = 5

# The *last* of the five short interval slots (index 5 of 6, absolute offset 132-137) is
# never a real interval-timer slot - real per-mode "advanced settings" are packed into its
# three sub-fields instead, confirmed byte-exact 2026-08-08 against real SuuntoLink captures
# *and* independently against SuuntoLink's own JS source enums (assets/WIndows apps/
# suuntolink_roaming/app-4.1.15/resources/app/ambit/{settings,sport_mode}.js) - see
# custom_modes_andre.md's "2026-08-08" section for the full derivation. Kept as a
# reinterpretation of IntervalSlots[5] rather than a new struct field, so a raw round-trip
# through encode/decode still works unchanged.
BACKLIGHT_MODE_NAMES = {0: "NORMAL", 1: "OFF", 2: "NIGHT", 3: "TOGGLE", 255: "DEFAULT"}
DISPLAY_MODE_NAMES = {0: "LIGHT", 1: "DARK", 255: "DEFAULT"}
QUICK_NAVIGATION_NAMES = {0: "OFF", 1: "POI", 2: "ROUTE", 255: "DEFAULT"}


def read_tag(data, offset):
    """A single BXml tag header: [u16 LE tag_id][u16 LE length], content follows.
    Matches Communist::Bluebird::BXmlConverter::parseBinaryTag exactly (4 bytes, no more)."""
    if offset + 4 > len(data):
        return None
    tag_id, length = struct.unpack_from("<HH", data, offset)
    return tag_id, length


def decode_settings(data, offset, length):
    """Decodes one EXERCISE_MODES_SETTING_NAME_LEN64 content block (name + fixed fields)."""
    name = data[offset:offset + 64].rstrip(b"\0").decode("iso-8859-15", "replace")
    cursor = offset + 64
    out = {"Name": name}
    for field, fmt in SETTING_FIELDS:
        out[field] = struct.unpack_from("<" + fmt, data, cursor)[0]
        cursor += struct.calcsize(fmt)
    out["CustomModeID"] = out.pop("CustomModeIdLow") | (out.pop("CustomModeIdHigh") << 16)
    intervals = []
    for i in range(1 + INTERVAL_SLOT_REPEATS):
        slot_fields = INTERVAL_SLOT_FULL if i == 0 else INTERVAL_SLOT_SHORT
        slot = {}
        for field, fmt in slot_fields:
            slot[field] = struct.unpack_from("<" + fmt, data, cursor)[0]
            cursor += struct.calcsize(fmt)
        intervals.append(slot)
    out["IntervalSlots"] = intervals
    advanced = intervals[5]
    out["BacklightMode"] = advanced["Flags"]
    out["BacklightModeName"] = BACKLIGHT_MODE_NAMES.get(advanced["Flags"], f"0x{advanced['Flags']:02x}")
    out["DisplayMode"] = advanced["MaxLimit"]
    out["DisplayModeName"] = DISPLAY_MODE_NAMES.get(advanced["MaxLimit"], f"0x{advanced['MaxLimit']:02x}")
    out["QuickNavigation"] = advanced["MinLimit"]
    out["QuickNavigationName"] = QUICK_NAVIGATION_NAMES.get(advanced["MinLimit"], f"0x{advanced['MinLimit']:02x}")
    consumed = cursor - offset
    if consumed != length:
        out["_warning"] = f"consumed {consumed} of {length} declared bytes"
    return out


def decode_disp_field(data, offset, length):
    """One EXERCISE_MODES_DISP_FIELD: a DISP_FIELD_SETTING leaf (4 bytes: [u16 Index][u16
    Type], both addBinaryData type=1/uint16 - Communist::Bluebird::BXmlConverter::
    convertExerciseModesDisplayFieldBinaryToTree, byte-verified 2026-08-05) followed by zero
    or more DISP_FIELD_SHORTCUT leaves (2 bytes each: a single uint16). "Index" is the field
    catalogue value - resolved against FIELD_TYPES, and confirmed to match: every Index seen
    in the live dump (0,1,2,3,9,24,25...) is a valid FT_* entry. "Type" and the shortcut
    values are confirmed-present numeric fields whose exact semantics (a format/subtype
    selector, and alternate cycle-through values shown when a button scrolls this field) are
    not pinned down further - plausibly indices into the ~200 SUUNTO_* watch variables listed
    in SuuntoAppZoneDeveloperManual.pdf, but that mapping itself isn't in any decompiled asset
    this project has found, so it's reported here as a raw number rather than guessed."""
    end = offset + length
    cursor = offset
    field = {"Index": None, "IndexName": None, "Type": None, "Shortcuts": []}
    while cursor < end:
        tag = read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == EXERCISE_MODES_DISP_FIELD_SETTING:
            idx, typ = struct.unpack_from("<HH", data, content)
            field["Index"] = idx
            field["IndexName"] = FIELD_TYPES.get(idx, f"0x{idx:04x}")
            field["Type"] = typ
        elif tag_id == EXERCISE_MODES_DISP_FIELD_SHORTCUT:
            field["Shortcuts"].append(struct.unpack_from("<H", data, content)[0])
        cursor = content + tag_len
    return field


def decode_display(data, offset, length):
    """One EXERCISE_MODES_DISPLAY (a single watch screen): a DISP_SETTING leaf (4 bytes:
    [u16 Template][u16 Type], both uint16 - convertExerciseModesDisplaySettingBinaryToTree)
    followed by 1-3 DISP_FIELD entries (the value slots shown on that screen). Template
    resolves against the same FIELD_TYPES dict (PID_RUNNER_GPS_TEMPLATE_* range) - confirmed
    to match every screen template seen live (T4, T5, T6, T11_COMPASS_NAVIGATE,
    T22_NAVIGATION, T1G_GRAPH, T50_MAP_DRAW, ...). Byte-verified against
    /tmp/dump_CustomModes.bin, 2026-08-05."""
    end = offset + length
    cursor = offset
    display = {"Template": None, "TemplateName": None, "Type": None, "Fields": []}
    while cursor < end:
        tag = read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == EXERCISE_MODES_DISP_SETTING:
            tpl, typ = struct.unpack_from("<HH", data, content)
            display["Template"] = tpl
            display["TemplateName"] = FIELD_TYPES.get(tpl, f"0x{tpl:04x}")
            display["Type"] = typ
        elif tag_id == EXERCISE_MODES_DISP_FIELD:
            display["Fields"].append(decode_disp_field(data, content, tag_len))
        cursor = content + tag_len
    return display


def decode_rule(data, offset, length):
    """One EXERCISE_MODES_RULE: NOT further BXml sub-tags (RULEIDX/USERULE/LOGRULE have no
    entry in BXmlTagMapping or BXmlIdMapping - confirmed absent from both dictionaries in
    libkomposti-ng.so.c). Instead it's a flat 6-byte struct, three consecutive uint16 fields
    written back-to-back by three addBinaryData(type=1) calls, in this exact order -
    Communist::Bluebird::BXmlConverter::convertExerciseModesRuleBinaryToTree:
        RULEIDX (which rule-engine display slot, i.e. FT_RULE_ENGINE_0/1/2, this refers to)
        USERULE (whether a Suunto App is assigned/enabled for that slot)
        LOGRULE (whether that App's result gets logged as part of the recorded Move)
    This is the link between the separate "Suunto Apps" subsystem (its own flash region, own
    binary converter - see custom_modes_andre.md) and a specific exercise mode: an app itself
    lives in the Apps region, but *which* app-slot an exercise mode uses, and whether it's
    logged, is recorded here in CustomModes.
    NOT byte-verified: this reference watch has no apps installed (its Apps flash region
    is entirely unwritten, 0xFF), and correspondingly none of its 10 EXERCISE_MODES_MODE
    entries contain an EXERCISE_MODES_RULES tag at all - there is nothing to decode on this
    watch. This function is derived from source alone and will raise if fed unexpected bytes
    rather than silently guess."""
    rule_idx, use_rule, log_rule = struct.unpack_from("<HHH", data, offset)
    out = {"RuleIdx": rule_idx, "UseRule": bool(use_rule), "LogRule": bool(log_rule)}
    if length != 6:
        out["_warning"] = f"expected 6 bytes, tag declared {length}"
    return out


def decode_exercise_mode(data, offset, length):
    """One EXERCISE_MODES_MODE entry: SETTING_NAME_LEN64 (settings), DISPLAYS (screens) and
    RULES (Suunto App rule-engine slot assignments, usually absent) sub-tags, all decoded."""
    end = offset + length
    cursor = offset
    mode = {"Displays": [], "Rules": [], "AppMeta": None, "_raw_children": []}
    while cursor < end:
        tag = read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == EXERCISE_MODES_SETTING_NAME_LEN64:
            mode["Settings"] = decode_settings(data, content, tag_len)
        elif tag_id == EXERCISE_MODES_APP_META and tag_len == 8:
            t1, t2 = struct.unpack_from("<II", data, content)
            mode["AppMeta"] = {"Timestamp1": t1, "Timestamp2": t2}
        elif tag_id == EXERCISE_MODES_DISPLAYS:
            sub_cursor = content
            sub_end = content + tag_len
            while sub_cursor < sub_end:
                sub_tag = read_tag(data, sub_cursor)
                if sub_tag is None:
                    break
                sub_id, sub_len = sub_tag
                sub_content = sub_cursor + 4
                if sub_id == EXERCISE_MODES_DISPLAY:
                    mode["Displays"].append(decode_display(data, sub_content, sub_len))
                sub_cursor = sub_content + sub_len
        elif tag_id == EXERCISE_MODES_RULES:
            sub_cursor = content
            sub_end = content + tag_len
            while sub_cursor < sub_end:
                sub_tag = read_tag(data, sub_cursor)
                if sub_tag is None:
                    break
                sub_id, sub_len = sub_tag
                sub_content = sub_cursor + 4
                if sub_id == EXERCISE_MODES_RULE:
                    mode["Rules"].append(decode_rule(data, sub_content, sub_len))
                sub_cursor = sub_content + sub_len
        else:
            mode["_raw_children"].append(
                (BXML_TAGS.get(tag_id, f"0x{tag_id:03x}"), tag_len))
        cursor = content + tag_len
    return mode


def decode_sport_mode_slot(data, offset, length):
    """One SPORT_MODE (multisport) slot: a 64-byte name, an ActivityID, and one *or more*
    SPORT_MODE_EXERCISE tags. A single-sport slot has exactly one Exercise tag, pointing at
    its own EXERCISE_MODES_MODE flash-storage index. A real multisport combo (e.g. the
    default "Triathlon") has one Exercise tag per leg, in order - confirmed on hardware
    2026-08-05: Triathlon decodes to five tags, 0/1/2/1/3, i.e. Openwater swim -> Transition
    -> Cycling -> Transition -> Running, the standard swim/T1/bike/T2/run structure. Earlier
    versions of this function kept only the last Exercise tag, silently discarding the
    sequence for any multisport entry - fixed by collecting all of them."""
    end = offset + length
    cursor = offset
    slot = {"Name": "", "ActivityID": None, "Exercises": [], "Order": None, "AppMeta": None}
    while cursor < end:
        tag = read_tag(data, cursor)
        if tag is None:
            break
        tag_id, tag_len = tag
        content = cursor + 4
        if tag_id == SPORT_MODE_SETTING_NAME_LEN64:
            slot["Name"] = data[content:content + tag_len].rstrip(b"\0").decode(
                "iso-8859-15", "replace")
        elif tag_id == SPORT_MODE_ACTIVITY_ID:
            slot["ActivityID"] = struct.unpack_from("<H", data, content)[0]
        elif tag_id == SPORT_MODE_EXERCISE:
            slot["Exercises"].append(struct.unpack_from("<H", data, content)[0])
        elif tag_id == SPORT_MODE_ORDER and tag_len == 4:
            slot["Order"] = struct.unpack_from("<I", data, content)[0]
        elif tag_id == SPORT_MODE_APP_META and tag_len == 4:
            slot["AppMeta"] = struct.unpack_from("<I", data, content)[0]
        cursor = content + tag_len
    return slot


def decode(data):
    """Decodes a raw CustomModes flash dump (12288 bytes). Returns a dict with the
    format-type marker, every configured exercise mode, and the SPORT_MODES multisport
    slots (populated ones only, by default)."""
    root = read_tag(data, 0)
    if root is None or root[0] != DEVICE_CUSTOM:
        raise ValueError(f"expected DEVICE_CUSTOM at offset 0, got {root}")
    _, root_len = root
    cursor = 4
    end = 4 + root_len
    result = {"exercise_modes": [], "sport_modes": []}
    while cursor < end:
        tag = read_tag(data, cursor)
        if tag is None:
            break
        tag_id, length = tag
        content = cursor + 4

        if tag_id == EXERCISE_MODES:
            sub_end = content + length
            sub_cursor = content
            while sub_cursor < sub_end:
                sub_tag = read_tag(data, sub_cursor)
                if sub_tag is None:
                    break
                sub_id, sub_len = sub_tag
                sub_content = sub_cursor + 4
                if sub_id == EXERCISE_MODES_TYPE:
                    result["format_type"] = struct.unpack_from("<H", data, sub_content)[0]
                elif sub_id == EXERCISE_MODES_MODE:
                    result["exercise_modes"].append(
                        decode_exercise_mode(data, sub_content, sub_len))
                sub_cursor = sub_content + sub_len

        elif tag_id == SPORT_MODES:
            sub_end = content + length
            sub_cursor = content
            while sub_cursor < sub_end:
                sub_tag = read_tag(data, sub_cursor)
                if sub_tag is None:
                    break
                sub_id, sub_len = sub_tag
                sub_content = sub_cursor + 4
                if sub_id == SPORT_MODE:
                    result["sport_modes"].append(
                        decode_sport_mode_slot(data, sub_content, sub_len))
                sub_cursor = sub_content + sub_len

        cursor = content + length
    return result


# Real, 2026-08-09 ("I see screen XX, but afaik suunto ambit can only have a max number
# of screens that is way lower than this, please identify the correct screen number that
# the user would see"). Confirmed live against this reference watch's own real Displays
# data (custom_modes.py --json), cross-checked against SuuntoLink's own real "Displays"
# screenshot counts (assets/ambit3 pcap/v2/screens sports modes/sportsmodes.JPG - "Cycling
# 8 screens", "Walk 1 screens", etc.): every one of the watch's 7 real sport modes has a
# real, fixed run of *built-in* screens (Compass, Navigation, Map, an Interval Timer
# summary, and one still-unconfirmed 0x0127) appended after the user's own configurable
# ones - "Screen 9/10/11..." was these built-in screens, not real user screens, which is
# why the numbering looked wrong. Two real shapes confirmed so far:
#   - GPS-capable activities (Cycling/Running/Run a route/Trekking/Indoor training/Walk -
#     6/6 tested): a byte-identical 7-entry tail (Compass, Compass-in-mils, Navigation, a
#     2nd Graph, Map, Interval Timer, 0x0127). Excluding it and renumbering from 1 matches
#     SuuntoLink's own reported count exactly for every one of the 6.
#   - Pool swimming (the one non-GPS activity tested): a shorter, real 3-entry tail
#     (Interval Timer, an unconfirmed swim-specific 0x0124, then the same 0x0127) - also
#     matches its own real reported count (3) exactly once excluded.
# The very last entry being the unconfirmed 0x0127 is the one invariant confirmed across
# all 7 tested modes regardless of activity type - a real, if not yet fully explained,
# anchor. A mode whose own tail doesn't match either known shape falls back to 0 excluded
# (every entry shown, numbered from 1) rather than guessing at a boundary with no real
# evidence for it.
_GPS_SYSTEM_TAIL = (
    "PID_RUNNER_GPS_TEMPLATE_11_COMPASS_NAVIGATE",
    "PID_RUNNER_GPS_TEMPLATE_11_MILS_COMPASS_NAVIGATE",
    "PID_RUNNER_GPS_TEMPLATE_22_NAVIGATION",
    "PID_RUNNER_GPS_TEMPLATE_1G_GRAPH",
    "PID_RUNNER_GPS_TEMPLATE_50_MAP_DRAW",
    "PID_RUNNER_GPS_TEMPLATE_4",
    "0x0127",
)
_NON_GPS_SYSTEM_TAIL = (
    "PID_RUNNER_GPS_TEMPLATE_4",
    "0x0124",
    "0x0127",
)

# Real, confirmed from SuuntoLink's own real JS source (getMaxDisplays() in
# suunto_apps.js/sport_mode.js - a real, live client-side product config, not guessed):
# Traverse/Traverse Alpha cap at 4 real display screens per mode; every other real variant
# in this watch family (Ambit/Ambit2/Ambit3, everything this project's own _modelNames
# table - see android/.../AmbitUsbModule.kt and desktop/.../HomeViewModel.qml - knows
# about) caps at 8. Keyed on the real engineering codename (DeviceService.model / the
# 0x0000 identity reply's own value), not a commercial name.
_MAX_DISPLAYS_BY_VARIANT = {"Jabiru": 4, "Loon": 4}
_DEFAULT_MAX_DISPLAYS = 8


def max_displays_for_variant(variant):
    return _MAX_DISPLAYS_BY_VARIANT.get(variant, _DEFAULT_MAX_DISPLAYS)


def system_tail_length(display_templates):
    """How many trailing entries in a real mode's own Displays list are built-in/system
    screens (not real user-configurable "Screen N" ones) - see this module's own
    _GPS_SYSTEM_TAIL/_NON_GPS_SYSTEM_TAIL comment for exactly what's confirmed."""
    if tuple(display_templates[-len(_GPS_SYSTEM_TAIL):]) == _GPS_SYSTEM_TAIL:
        return len(_GPS_SYSTEM_TAIL)
    if tuple(display_templates[-len(_NON_GPS_SYSTEM_TAIL):]) == _NON_GPS_SYSTEM_TAIL:
        return len(_NON_GPS_SYSTEM_TAIL)
    return 0


# Real, 2026-08-10 (André, item 11: "on ambit 3, open water swim, screen 1 I see 1 0x0047,
# 2 lap stopwatch, 3 shortcut, for the same sport on suunto link I see ... 3 I have two
# screens/datas average swim pace and average stroke rate").
#
# A row is NOT one value. Each DISP_FIELD carries a base Type plus a `Shortcuts` list, and
# when the base Type is 0 the row's real content IS that list - up to 5 values the wearer
# steps through with a button press (automatically only when the mode's own autoscroll is
# on). Confirmed two ways: across all 111 CustomModes saves in
# `assets/pcap/running2fromcreateandthen1to7` every shortcut-carrying row has base Type 0
# (29/29), and SuuntoLink's own sport_mode.js `defaultDisplay()` models exactly this - Top
# and Center carry a single value while Bottom carries a nested `Fields` LIST.
#
# This function used to emit only the base Type, so a row like Openwater swim's
# `Shortcuts=[88, 87]` (FT_SWIM_AVG_PACE + average stroke rate) rendered as one meaningless
# value and the extra content vanished. `values` below is what the row actually shows, in
# order, whichever form it takes.
_ROW_LABELS = ("Top", "Center", "Bottom")   # sport_mode.js FieldId


def _field_to_json(f):
    def label(t):
        return field_type_label(FIELD_TYPES.get(t, f"0x{t:04x}"))
    shortcuts = list(f.get("Shortcuts") or [])
    base = f["Type"]
    values = [{"type": t, "label": label(t)} for t in shortcuts] if base == 0 and shortcuts \
        else [{"type": base, "label": label(base)}]
    idx = f.get("Index")
    return {
        "indexName": f["IndexName"],
        "rowLabel": _ROW_LABELS[idx] if isinstance(idx, int) and idx < len(_ROW_LABELS) else None,
        "type": base,
        "typeLabel": label(base),
        "shortcuts": shortcuts,
        # What the row really displays: the shortcut list when the base type is 0, else the
        # single base value. A UI should render this and ignore `type` unless it needs the
        # raw encoding.
        "values": values,
        "isMultiValue": len(values) > 1,
    }


def _displays_to_json(displays):
    """One mode's own real Displays list, JSON-shaped - `index` stays the raw 0-based
    position (writeDisplayField's own addressing needs this unchanged), `screenNumber` is
    the real 1-based number the user would actually see on the watch (None for a built-in
    screen - see system_tail_length()'s own module-level comment), `isBuiltIn` flags which
    is which."""
    templates = [d["TemplateName"] for d in displays]
    tail_len = system_tail_length(templates)
    real_count = len(displays) - tail_len
    out = []
    for i, disp in enumerate(displays):
        is_built_in = i >= real_count
        out.append({
            "index": i,
            "screenNumber": None if is_built_in else i + 1,
            "isBuiltIn": is_built_in,
            "template": disp["TemplateName"],
            "templateLabel": field_type_label(disp["TemplateName"]),
            "fields": [_field_to_json(f) for f in disp["Fields"]],
        })
    return out


def to_json(result):
    """A JSON-friendly view of decode()'s own result dict, for backend/server.py - added
    2026-08-08 alongside the real CustomModes write tools (custom_modes_rename_test.py/
    custom_modes_field_write_test.py/custom_modes_display_field_write_test.py). Every field
    name here matches what those write tools themselves expect (SETTING_FIELDS' own real
    names for --set, FIELD_TYPES' own real names for --to/--type), so a UI built against
    this can round-trip without a second name-mapping layer."""
    modes = []
    for mode in result["exercise_modes"]:
        s = mode.get("Settings", {})
        modes.append({
            "name": s.get("Name"),
            "activityId": s.get("ActivityID"),
            "customModeId": s.get("CustomModeID"),
            "useHw": s.get("UseHw"),
            "altiBaroMode": s.get("AltiBaroMode"),
            "recordingInterval": s.get("RecordingInterval"),
            "autolap": s.get("Autolap"),
            "hrHigh": s.get("HrHigh"),
            "hrLow": s.get("HrLow"),
            "hrLimitsUse": s.get("HrLimitsUse"),
            "autoStart": s.get("AutoStart"),
            "autoPause": s.get("AutoPause"),
            "autoScrolling": s.get("AutoScrolling"),
            "intTimerFlags": s.get("IntTimerFlags"),
            "intTimerCount": s.get("IntTimerCount"),
            "backlightMode": s.get("BacklightModeName"),
            "displayMode": s.get("DisplayModeName"),
            "quickNavigation": s.get("QuickNavigationName"),
            "displays": _displays_to_json(mode["Displays"]),
            "rules": mode["Rules"],
        })

    sport_modes = [
        {"name": slot["Name"], "activityId": slot["ActivityID"], "legs": slot["Exercises"]}
        for slot in result["sport_modes"] if slot["Name"]
    ]

    return {"ok": True, "formatType": result.get("format_type"),
            "exerciseModes": modes, "sportModes": sport_modes}


def show(result, verbose=False):
    print(f"format_type={result.get('format_type')}")
    print(f"\n{len(result['exercise_modes'])} exercise mode(s):")
    for mode in result["exercise_modes"]:
        s = mode.get("Settings", {})
        print(f"  {s.get('Name', '?')!r:20} ActivityID=0x{s.get('ActivityID', 0):02x}"
              f"  CustomModeID={s.get('CustomModeID')}"
              f"  UseHw=0x{s.get('UseHw', 0):04x}"
              f"  AltiBaroMode={s.get('AltiBaroMode')}"
              f"  RecordingInterval={s.get('RecordingInterval')}"
              f"  Autolap={s.get('Autolap')}")
        print(f"      BacklightMode={s.get('BacklightModeName')}"
              f"  Display={s.get('DisplayModeName')}"
              f"  QuickNavigation={s.get('QuickNavigationName')}")
        print(f"      {len(mode['Displays'])} display(s)"
              + (f", {len(mode['Rules'])} rule(s)" if mode["Rules"] else ""))
        if mode["AppMeta"]:
            t1 = datetime.datetime.fromtimestamp(mode["AppMeta"]["Timestamp1"], datetime.UTC)
            print(f"      AppMeta: timestamps={mode['AppMeta']['Timestamp1']}"
                  f",{mode['AppMeta']['Timestamp2']} (~{t1} UTC)")
        if verbose:
            for i, disp in enumerate(mode["Displays"]):
                fields = "; ".join(
                    f"{f['IndexName']}(Type={f['Type']}"
                    + (f", Shortcuts={f['Shortcuts']}" if f["Shortcuts"] else "") + ")"
                    for f in disp["Fields"])
                print(f"        [{i}] {disp['TemplateName']} (Type={disp['Type']}): {fields}")
            for rule in mode["Rules"]:
                print(f"        RULE RuleIdx={rule['RuleIdx']} UseRule={rule['UseRule']}"
                      f" LogRule={rule['LogRule']}")
        if mode["_raw_children"]:
            children = ", ".join(f"{n}[{l}]" for n, l in mode["_raw_children"])
            print(f"      (not yet decoded: {children})")
        if "_warning" in s:
            print(f"      WARNING: {s['_warning']}")

    mode_names = [m.get("Settings", {}).get("Name", "?") for m in result["exercise_modes"]]

    populated = [s for s in result["sport_modes"] if s["Name"]]
    print(f"\n{len(populated)}/{len(result['sport_modes'])} SPORT_MODES (multisport) "
          "slot(s) populated:")
    for slot in populated:
        legs = slot["Exercises"]
        leg_names = " -> ".join(
            mode_names[i] if 0 <= i < len(mode_names) else f"?({i})" for i in legs)
        print(f"  {slot['Name']!r:20} ActivityID=0x{slot['ActivityID']:02x}"
              f"  legs={legs}  ({leg_names})")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="from_file", metavar="FILE",
                     help="decode a raw CustomModes dump (12288 bytes) instead of the watch")
    ap.add_argument("--displays", action="store_true",
                     help="also print each exercise mode's decoded screens/fields and rules")
    ap.add_argument("--save", metavar="FILE",
                     help="also save the raw region bytes here (only meaningful when reading"
                          " live from the watch) - for capturing a clean before/after pair")
    ap.add_argument("--json", action="store_true",
                     help="print one JSON line instead of human-readable output - for "
                          "ambitapp-v2/backend/server.py, not meant for a person to read")
    ap.add_argument("--list-field-types", action="store_true",
                     help="print the real FIELD_TYPES catalog as one JSON line and exit - "
                          "no watch touched, for a UI's own data-field picker")
    args = ap.parse_args()

    if args.list_field_types:
        print(json.dumps({"ok": True, "fieldTypes": [
            {"value": k, "name": v, "label": field_type_label(v)}
            for k, v in sorted(FIELD_TYPES.items())]}))
        return 0

    if args.from_file:
        with open(args.from_file, "rb") as f:
            data = f.read()
    else:
        from write_nav import Link, read_flash
        link = Link(dry_run=False, verbose=not args.json)
        if not args.json:
            print("read-only: 0x0b17 reads flash, nothing is written")
        link.open()
        data = read_flash(link, CUSTOM_MODES_BASE, CUSTOM_MODES_SIZE, label="CustomModes")
        if args.save:
            with open(args.save, "wb") as f:
                f.write(data)
            if not args.json:
                print(f"\nsaved raw dump to {args.save}")

    result = decode(data)
    if args.json:
        print(json.dumps(to_json(result)))
    else:
        show(result, verbose=args.displays)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
