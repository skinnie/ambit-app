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

# Data the helper reads at runtime, mapped to the same layout server.py expects under
# sys._MEIPASS when frozen (see server.py's FROZEN branch).
datas = [
    (str(REPO / "tools"), "tools"),
    (str(REPO / "data" / "suunto_apps"), "data/suunto_apps"),
]
if (BACKEND / "demo_data").is_dir():
    datas.append((str(BACKEND / "demo_data"), "backend/demo_data"))

# server.py and ble_bridge sit next to the entry script; every tool the backend can shell out
# to is imported by runpy at runtime, so name them all as hidden imports to make sure their
# code (and their own transitive deps like `hid` and `bleak`) is actually bundled.
hiddenimports = ["server", "ble_bridge"]
for _p in glob.glob(str(REPO / "tools" / "*.py")):
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
