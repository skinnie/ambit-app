#pragma once

#include <QObject>

// Phase 2 of "ship a real app to ordinary users" (see README's desktop section): the Qt UI
// is only the face of the app; the actual watch work is done by a small helper (the Python
// backend/server.py, reached over http://127.0.0.1:8766). In development that helper is
// started for you by run-desktop.sh. In a packaged download there is no run-desktop.sh, so
// the app has to start the helper itself.
//
// This class does exactly that, and ONLY when a helper has actually been bundled next to the
// app (which happens in the cloud release build, not in a local `cmake` build). That gate is
// deliberate: a normal dev build has no bundled helper, so startIfBundled() is a no-op and
// the existing run-desktop.sh flow is completely unaffected - no regression.
class BackendProcess
{
public:
    // Start the bundled helper if one exists next to this executable; otherwise do nothing.
    // The child is tied to the app's lifetime and terminated on quit, so it never lingers on
    // :8766. `parent` owns the QProcess (pass the QGuiApplication).
    static void startIfBundled(QObject *parent);
};
