#include "intervalsservice.h"

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

IntervalsService::IntervalsService(QObject *parent) : QObject(parent)
{
}

QString IntervalsService::launch()
{
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
