# PyInstaller spec that freezes the desktop watch helper (desktop/backend/server.py) into a
# single self-contained executable named "ambit-backend" - no Python needed on the user's
# machine. The C++ app starts it automatically (see desktop/src/services/backendprocess.cpp);
# the cloud release workflow (.github/workflows/desktop-release.yml) builds it per-OS and
# drops it inside the .app / .zip.
#
# Build it:  pyinstaller tools/packaging/ambit_backend.spec --distpath dist/backend
# Result:    dist/backend/ambit-backend        (ambit-backend.exe on Windows)
#
# NOTE: this is a first cut for a build we cannot test locally on macOS/Windows; expect the
# cloud build to surface missing hidden imports / native libs (the `hid` hidapi backend in
# particular) and to need a round or two of additions here. That is normal for freezing.

import glob
from pathlib import Path

# PyInstaller injects SPECPATH (this file's directory) at exec time.
_here = Path(SPECPATH).resolve()          # tools/packaging
REPO = _here.parent.parent                # repo root
BACKEND = REPO / "desktop" / "backend"

# App Zone reverse-engineering / corpus material that the backend never calls at runtime and
# that must NOT ship inside a public download (kept out of the bundle deliberately; the offline
# compiler emitter lives only on the private appzone-compiler branch and isn't here at all).
EXCLUDE_TOOLS = {"appzone_corpus.py", "harvest_appzone.py"}
EXCLUDE_TOOL_DIRS = {"ghidra_scripts"}  # tools/ghidra_scripts/*


def _is_excluded(dest):
    # dest is the in-bundle path, e.g. "tools/appzone_corpus.py" or "tools/ghidra_scripts/x.py".
    parts = Path(dest).parts
    if len(parts) >= 2 and parts[0] == "tools":
        if parts[-1] in EXCLUDE_TOOLS:
            return True
        if len(parts) >= 3 and parts[1] in EXCLUDE_TOOL_DIRS:
            return True
    return False


# Data the helper reads at runtime, mapped to the same layout server.py expects under
# sys._MEIPASS when frozen (see server.py's FROZEN branch). The whole tools/ dir is added, then
# the excluded RE/corpus files are filtered out of a.datas after Analysis (below).
datas = [
    (str(REPO / "tools"), "tools"),
]
# The SuuntoLink app catalog (data/suunto_apps) is deliberately NOT in the repo - it's the
# not-ours-to-redistribute corpus kept out of version control (see .gitignore / assets-hygiene).
# So it's absent on a clean CI checkout; guard it the same way demo_data is, or PyInstaller
# aborts with "Unable to find .../data/suunto_apps". When present locally it's still bundled.
if (REPO / "data" / "suunto_apps").is_dir():
    datas.append((str(REPO / "data" / "suunto_apps"), "data/suunto_apps"))
if (BACKEND / "demo_data").is_dir():
    datas.append((str(BACKEND / "demo_data"), "backend/demo_data"))

# server.py and ble_bridge sit next to the entry script; every tool the backend can shell out
# to is imported by runpy at runtime, so name them all as hidden imports to make sure their
# code (and their own transitive deps like `hid` and `bleak`) is actually bundled - except the
# excluded RE/corpus tools, which the backend never runs.
hiddenimports = ["server", "ble_bridge"]
for _p in glob.glob(str(REPO / "tools" / "*.py")):
    if Path(_p).name not in EXCLUDE_TOOLS:
        hiddenimports.append(Path(_p).stem)

a = Analysis(
    [str(BACKEND / "frozen_entry.py")],
    pathex=[str(BACKEND), str(REPO / "tools")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

# Drop the excluded RE/corpus files from the bundled tools/ tree so they never ship.
a.datas = [d for d in a.datas if not _is_excluded(d[0])]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ambit-backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,          # it's a background helper; console output goes to the app's log
    disable_windowed_traceback=False,
)
