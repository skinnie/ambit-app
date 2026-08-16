#include "intervalsservice.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QProcess>

// Baked in at configure time (CMakeLists.txt) - this is a personal dev-checkout tool tied to
// one repo layout, not something installed separately from it (same "fixed convention, not
// configurable yet" reasoning as DeviceService's own hardcoded backend address), so a real
// absolute path computed once at build time is more reliable than guessing one at runtime
// from wherever the built binary happens to be invoked.
#ifndef AMBITAPP_REPO_ROOT
#define AMBITAPP_REPO_ROOT ""
#endif

namespace {

// The Workout Builder (tools/workout_gui.py) is bundled INSIDE the frozen watch helper (it's
// just another tool), so in a packaged download the "Open Workout Builder" button needs
// nothing installed - it just asks that helper to run it. Same path convention as
// BackendProcess (the helper sits next to the app in backend/, or in Contents/Resources on mac).
QString bundledBackendPath()
{
    const QDir appDir(QCoreApplication::applicationDirPath());
#if defined(Q_OS_MACOS)
    return appDir.absoluteFilePath(QStringLiteral("../Resources/backend/ambit-backend"));
#elif defined(Q_OS_WIN)
    return appDir.absoluteFilePath(QStringLiteral("backend/ambit-backend.exe"));
#else
    return appDir.absoluteFilePath(QStringLiteral("backend/ambit-backend"));
#endif
}

}  // namespace

IntervalsService::IntervalsService(QObject *parent) : QObject(parent)
{
}

QString IntervalsService::launch()
{
    // Packaged download: the bundled helper carries the Workout Builder - just launch it.
    const QString bundled = QFileInfo(bundledBackendPath()).absoluteFilePath();
    if (QFileInfo::exists(bundled)) {
        if (QProcess::startDetached(bundled, {QStringLiteral("--workout-builder")}))
            return QString();
    }

    // Source checkout: fall back to the standalone Workout Builder (a packaged dist/ build if
    // present, otherwise run tools/workout_gui.py with the system Python).
    const QString repoRoot = QDir(QStringLiteral(AMBITAPP_REPO_ROOT)).absolutePath();
    const QString fallbackScript = repoRoot + QStringLiteral("/tools/workout_gui.py");

#if defined(Q_OS_WIN)
    const QString packaged =
        repoRoot + QStringLiteral("/dist/windows/Ambit3 Workout Builder.exe");
    const QString pythonCommand = QStringLiteral("python");
#elif defined(Q_OS_MACOS)
    const QString packaged = repoRoot + QStringLiteral("/dist/mac/Ambit3 Workout Builder.app");
    const QString pythonCommand = QStringLiteral("python3");
#else
    const QString packaged = repoRoot + QStringLiteral("/dist/linux/Ambit3 Workout Builder");
    const QString pythonCommand = QStringLiteral("python3");
#endif

    if (QFileInfo::exists(packaged)) {
#if defined(Q_OS_MACOS)
        // .app bundles need to go through `open`, not be exec'd directly.
        if (QProcess::startDetached(QStringLiteral("open"), {QStringLiteral("-a"), packaged}))
            return QString();
#else
        if (QProcess::startDetached(packaged, {}))
            return QString();
#endif
    }

    if (QFileInfo::exists(fallbackScript)) {
        if (QProcess::startDetached(pythonCommand, {fallbackScript}))
            return QString();
        return QStringLiteral("Found %1 but couldn't start %2 - is Python installed and on PATH?")
            .arg(fallbackScript, pythonCommand);
    }

    return QStringLiteral("Couldn't find the Workout Builder - expected it at %1 or %2")
        .arg(packaged, fallbackScript);
}
