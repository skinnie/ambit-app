"""Finds and safely appends to SuuntoLink's own bundled `suunto-apps/index.json` catalog -
the real, community-documented way to get a compiled Suunto App into SuuntoLink's own "Add
Suunto App" picker, confirmed straight from the source (forum.suunto.com/topic/7592's first
post, 2026-08-06): "Add the response to ambit-apps index file in SuuntoLink" - a plain JSON
array, one object per app, exactly the shape `workout.py`'s `compile_source()` already returns.

Deliberately its own file, not folded into `workout_gui.py`: this is desktop-OS-specific local
file surgery (locating and editing a real file inside the user's own SuuntoLink install), a
completely different concern from `workout.py`'s portable workout-to-bytecode logic - which has
no OS dependency at all and is the part worth keeping portable toward a future Android/React
Native integration. This file never would be.

Known install paths (from the same forum post):

    macOS:   /Applications/Suuntolink.app/Contents/Resources/app/suunto-apps/index.json
    Windows: %LOCALAPPDATA%\\Suuntolink\\app-<version>\\resources\\app\\suunto-apps\\index.json
"""

import glob
import json
import os
import platform
import shutil
import subprocess

CUSTOM_RULE_ID_BASE = 90000000  # comfortably above the real catalog's own max (~13.7M,
                                 # confirmed 2026-08-05) so a custom entry is never mistaken
                                 # for, or collides with, an official one


def find_index_json():
    """Returns the likely path(s) to the local suunto-apps/index.json, based on the OS this
    is actually running on - a packaged desktop app always runs on the machine it should
    search, so there's no cross-platform ambiguity to resolve here."""
    system = platform.system()
    if system == "Darwin":
        path = "/Applications/Suuntolink.app/Contents/Resources/app/suunto-apps/index.json"
        return [path] if os.path.isfile(path) else []
    if system == "Windows":
        pattern = os.path.expandvars(
            r"%LOCALAPPDATA%\Suuntolink\app-*\resources\app\suunto-apps\index.json")
        return sorted(glob.glob(pattern))
    return []  # Linux: SuuntoLink has no native build; nothing to find


def _safe_rule_id(existing):
    used = {e.get("ruleId") for e in existing}
    candidate = CUSTOM_RULE_ID_BASE
    while candidate in used:
        candidate += 1
    return candidate


def _backup_path(index_path):
    """`index.json` -> `index_old.json`, same folder. One generation, overwritten on every
    call by design (asked for by name, 2026-08-06) - it always holds whatever was in the real
    catalog immediately before the *most recent* write, not the original-ever state. Simple
    and predictable; if deeper history is ever needed, that's a real, separate ask."""
    root, ext = os.path.splitext(index_path)
    return f"{root}_old{ext}"


# The real catalog's own entry schema, confirmed empirically against a real
# suunto-apps/index.json (13,105 entries, 2026-08-08): every entry has exactly these six
# fields plus ruleId, always - `description` is the one truly optional field (missing on
# ~38% of real entries; never fabricated here if compiled doesn't have one either).
_CATALOG_FIELDS = ("name", "categoryId", "activityId", "userCount", "binary", "compatibleVariants")
_OPTIONAL_CATALOG_FIELDS = ("description",)


def add_entry(index_path, compiled):
    """Appends `compiled` (a `compile_source()`-shaped dict) to the real catalog at
    `index_path`, backing up the original file first (see `_backup_path`). Returns
    (backup_path, new_rule_id). Assigns a fresh, collision-free ruleId - `compile_source()`
    always returns the same placeholder (11000001) regardless of what was compiled, which
    would collide the second time this is used.

    Real bug, found 2026-08-08 (broke SuuntoLink on Windows after a real "Add to
    SuuntoLink" - see assets/issue_workout_builder_windows/): this used to do
    `entry = dict(compiled)`, copying `compiled` wholesale into the shared catalog file -
    including `savedTo`, a field workout_gui.py's own /api/compile response adds purely for
    its own "Saved to <path>" UI message (a real local Windows file path, entirely
    meaningless to SuuntoLink itself). Confirmed against a real 13,105-entry catalog: not one
    legitimate entry has ever had a `savedTo` key, and both of this tool's own two prior
    catalog writes did - real, reproducible pollution, not a one-off. Filtered explicitly to
    the real catalog's own known schema now, so any future extra field workout_gui.py's
    response happens to carry (savedTo or otherwise) can't leak into SuuntoLink's file again."""
    with open(index_path, encoding="utf-8") as f:
        catalog = json.load(f)
    if not isinstance(catalog, list):
        raise ValueError(f"{index_path} doesn't look like a JSON array - refusing to touch it")

    backup_path = _backup_path(index_path)
    shutil.copy2(index_path, backup_path)

    entry = {field: compiled[field] for field in _CATALOG_FIELDS if field in compiled}
    entry.update({field: compiled[field] for field in _OPTIONAL_CATALOG_FIELDS if field in compiled})
    entry["ruleId"] = _safe_rule_id(catalog)
    catalog.append(entry)

    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f)

    return backup_path, entry["ruleId"]


def open_suuntolink():
    """Best-effort: launches SuuntoLink after a successful add, so the new app shows up
    without a manual relaunch. Never raises - failing to open SuuntoLink shouldn't make the
    add itself look like it failed. If SuuntoLink is already running, this most likely just
    focuses the existing window rather than making it reload the catalog it already read at
    startup - a full quit/reopen is the only way to guarantee a refresh either way."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", "-a", "Suuntolink"], check=True)
        elif system == "Windows":
            exe = os.path.expandvars(r"%LOCALAPPDATA%\Suuntolink\Suuntolink.exe")
            if os.path.isfile(exe):
                subprocess.Popen([exe])
    except (OSError, subprocess.SubprocessError):
        pass
