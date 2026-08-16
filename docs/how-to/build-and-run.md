# Build and run

Kept in sync with the "Build / run / test quick reference" section of `CLAUDE.md` (repo root).

- **Desktop**: `./build-desktop.sh` → binary at `desktop/build/ambitapp`; run with `./run-desktop.sh`
  (it also starts the Python backend on `:8766`).
- **Android**: `./build-android.sh` (debug) or `./build-android.sh release` (standalone, bundle baked in).
  - Android is React Native: a **debug** APK needs Metro (`cd android && npm start` + `adb reverse tcp:8081 tcp:8081`);
    a **release** APK is standalone.
  - Tablet over network ADB: `adb connect <ip:port>`, then `adb install -r <apk>`.
- **Python sanity check**: `python -m compileall tools desktop/backend`.

See also the [Runbook](../tutorials/runbook.md) for the full watch-in-hand task list, and
[Packaging](../tutorials/packaging.md) for building the standalone Workout Builder binaries.

## Build the docs site

```
pip install -r docs-requirements.txt
mkdocs serve   # local preview at http://127.0.0.1:8000
mkdocs build --strict   # verifies nav/links, fails on any warning
```
